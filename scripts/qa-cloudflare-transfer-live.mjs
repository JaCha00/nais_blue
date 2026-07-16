import { createHash, randomBytes, webcrypto } from 'node:crypto'

const endpoint = process.env.NAIS_WORKER_URL?.replace(/\/$/, '')
const capability = process.env.NAIS_PAIRING_CAPABILITY
if (!endpoint || !capability) throw new Error('Live Cloudflare QA environment is unavailable.')
if (new URL(endpoint).protocol !== 'https:') throw new Error('Live Cloudflare QA requires HTTPS.')

const encoder = new TextEncoder()
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const base64Url = bytes => Buffer.from(bytes).toString('base64url')
const unique = prefix => `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
const expectStatus = async (response, status, label) => {
    if (response.status !== status) throw new Error(`${label} returned ${response.status}.`)
    return response.json()
}

async function device(deviceId) {
    const keys = await webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    )
    const spki = await webcrypto.subtle.exportKey('spki', keys.publicKey)
    let sequence = 0
    return {
        deviceId,
        publicKeySpki: Buffer.from(spki).toString('base64'),
        async signed(method, path, body = new Uint8Array(), operation = unique('op'), extra = {}, forcedSequence) {
            const requestSequence = forcedSequence ?? ++sequence
            const nonce = base64Url(randomBytes(18))
            const timestamp = Date.now()
            const bodyHash = sha256(body)
            const canonical = [method, path, requestSequence, nonce, timestamp, operation, bodyHash].join('\n')
            const signature = await webcrypto.subtle.sign(
                { name: 'ECDSA', hash: 'SHA-256' },
                keys.privateKey,
                encoder.encode(canonical),
            )
            return {
                method,
                headers: {
                    'content-type': 'application/json',
                    'x-nais-device': deviceId,
                    'x-nais-sequence': String(requestSequence),
                    'x-nais-nonce': nonce,
                    'x-nais-timestamp': String(timestamp),
                    'x-nais-idempotency': operation,
                    'x-nais-content-sha256': bodyHash,
                    'x-nais-signature': base64Url(signature),
                    ...extra,
                },
                body: method === 'GET' ? undefined : body,
            }
        },
    }
}

async function pair(subject, pairingCapability) {
    return fetch(`${endpoint}/v1/pair`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-nais-pairing-capability': pairingCapability,
        },
        body: JSON.stringify({ deviceId: subject.deviceId, publicKeySpki: subject.publicKeySpki }),
    })
}

const primary = await device(unique('nais-live'))
const stranger = await device(unique('nais-unpaired'))
const unknownTransfer = unique('unknown')
await expectStatus(
    await fetch(`${endpoint}/v1/transfers/${unknownTransfer}/status`, await stranger.signed('GET', `/v1/transfers/${unknownTransfer}/status`)),
    403,
    'unpaired request',
)
await expectStatus(await pair(primary, capability), 201, 'pairing')
await expectStatus(await pair(stranger, capability), 403, 'one-use pairing capability')

const transferId = unique('live')
const payload = randomBytes(1024 * 1024)
const startPath = `/v1/transfers/${transferId}/start`
const startBody = encoder.encode(JSON.stringify({
    transferId,
    kind: 'r2-upload',
    contentSha256: sha256(payload),
    sizeBytes: payload.byteLength,
}))
const startOperation = unique('start')
const startRequest = await primary.signed('POST', startPath, startBody, startOperation)
await expectStatus(await fetch(`${endpoint}${startPath}`, startRequest), 201, 'start')
const duplicate = await expectStatus(await fetch(`${endpoint}${startPath}`, startRequest), 201, 'exact duplicate')
if (duplicate.duplicate !== true) throw new Error('Exact duplicate was not characterized.')

const stalePath = `/v1/transfers/${transferId}/status`
await expectStatus(
    await fetch(`${endpoint}${stalePath}`, await primary.signed('GET', stalePath, undefined, unique('stale'), {}, 1)),
    403,
    'stale sequence',
)
await expectStatus(
    await fetch(`${endpoint}${stalePath}`, await primary.signed('GET', stalePath, undefined, startOperation)),
    409,
    'duplicate operation conflict',
)

const partPath = `/v1/transfers/${transferId}/parts/1`
const part = await expectStatus(
    await fetch(`${endpoint}${partPath}`, await primary.signed(
        'PUT',
        partPath,
        payload,
        unique('part'),
        { 'content-type': 'application/octet-stream', 'x-nais-part-sha256': sha256(payload) },
    )),
    200,
    'part upload',
)
if (part.checkpointBytes !== payload.byteLength) throw new Error('Remote checkpoint did not advance.')
const checkpoint = await expectStatus(
    await fetch(`${endpoint}${stalePath}`, await primary.signed('GET', stalePath)),
    200,
    'checkpoint status',
)
if (checkpoint.checkpointBytes !== payload.byteLength || checkpoint.state !== 'running') {
    throw new Error('Checkpoint recovery contract failed.')
}
const completePath = `/v1/transfers/${transferId}/complete`
const completed = await expectStatus(
    await fetch(`${endpoint}${completePath}`, await primary.signed('POST', completePath)),
    200,
    'complete',
)
if (completed.state !== 'succeeded' || !completed.r2Reference?.key?.startsWith('nais/')) {
    throw new Error('R2 reference contract failed.')
}

const cancelledId = unique('cancel')
const cancelledStartPath = `/v1/transfers/${cancelledId}/start`
const cancelledStart = encoder.encode(JSON.stringify({
    transferId: cancelledId,
    kind: 'r2-upload',
    contentSha256: sha256(payload),
    sizeBytes: payload.byteLength,
}))
await expectStatus(
    await fetch(`${endpoint}${cancelledStartPath}`, await primary.signed('POST', cancelledStartPath, cancelledStart)),
    201,
    'cancel candidate start',
)
const cancelPath = `/v1/transfers/${cancelledId}/cancel`
const cancelled = await expectStatus(
    await fetch(`${endpoint}${cancelPath}`, await primary.signed('POST', cancelPath)),
    200,
    'cancel tombstone',
)
if (!cancelled.tombstoned || cancelled.state !== 'cancelled') throw new Error('Tombstone contract failed.')
const latePartPath = `/v1/transfers/${cancelledId}/parts/1`
await expectStatus(
    await fetch(`${endpoint}${latePartPath}`, await primary.signed(
        'PUT',
        latePartPath,
        payload,
        unique('late'),
        { 'content-type': 'application/octet-stream', 'x-nais-part-sha256': sha256(payload) },
    )),
    409,
    'late part after cancel',
)

await expectStatus(
    await fetch(`${endpoint}/v1/revoke`, await primary.signed('POST', '/v1/revoke')),
    200,
    'revoke',
)
await expectStatus(
    await fetch(`${endpoint}${stalePath}`, await primary.signed('GET', stalePath)),
    403,
    'request after revoke',
)

console.log('LIVE_CLOUDFLARE_QA_OK unpaired=denied pairing=one-use replay=denied duplicate=stable checkpoint=acknowledged r2=nais tombstone=preserved revoke=denied')
