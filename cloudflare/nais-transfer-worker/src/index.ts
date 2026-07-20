import {
    MAX_CLOCK_SKEW_MS,
    MAX_JSON_BYTES,
    PART_BYTES,
    canonicalRequest,
    parseSignedMetadata,
    validDeviceId,
    validSha256,
    validTransferId,
    validateStartTransfer,
    type SignedRequestMetadata,
    type StartTransferRequest,
} from './protocol'
import { notFoundImage, wrapImageWithCleanSvg } from './image-metadata-cleaner'

interface Env {
    TRANSFER_STATE: DurableObjectNamespace<TransferStateObject>
    PRIME: R2Bucket
    KV: KVNamespace
    R2_PREFIX: string
    PAIRING_CAPABILITY_SHA256: string
    PAIRING_EXPIRES_AT_MS: string
    CF_VERSION_METADATA: WorkerVersionMetadata
}

interface DeviceRecord {
    readonly deviceId: string
    readonly publicKeySpki: string
    readonly pairedAtMs: number
    readonly highWaterSequence: number
    readonly recentNonces: readonly string[]
    readonly revokedAtMs: number | null
}

interface JobRecord {
    readonly transferId: string
    readonly kind: 'r2-upload'
    readonly contentSha256: string
    readonly sizeBytes: number
    readonly checkpointBytes: number
    readonly state: 'running' | 'committing' | 'succeeded' | 'cancelled' | 'failed'
    readonly objectKey: string
    readonly uploadId: string
    readonly completedParts: readonly R2UploadedPart[]
    readonly tombstonedAtMs: number | null
    readonly etag: string | null
}

interface OperationRecord {
    readonly fingerprint: string
    readonly status: number
    readonly response: Record<string, unknown>
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const FIXED_DENIAL = JSON.stringify({ code: 'E_TRANSFER_DENIED' })

function json(value: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

function denial(status = 403): Response {
    return new Response(FIXED_DENIAL, { status, headers: JSON_HEADERS })
}

/**
 * Cloudflare logs receive only a fixed verifier stage, while callers keep the same generic denial.
 * This makes production 403 failures actionable without exposing capability, key, device, or
 * request material; operators must inspect real-time logs only while pairing is expired or disabled.
 */
function pairingDenial(stage: 'request' | 'capability' | 'expiry' | 'body' | 'consume' | 'install'): Response {
    console.warn(`NAIS_PAIRING_DENIED stage=${stage}`)
    return denial()
}

/**
 * Version metadata is supplied by Cloudflare and consumed by the rotation script before pairing.
 * Returning only the public version ID proves which code-and-binding version served the request,
 * so no pairing capability, verifier, expiry, device, or request material crosses this boundary.
 */
function readiness(env: Env): Response {
    return json({ versionId: env.CF_VERSION_METADATA.id })
}

function assetMime(url: URL, key: string, image: R2ObjectBody): 'image/png' | 'image/jpeg' | 'image/webp' {
    const declared = image.httpMetadata?.contentType ?? url.searchParams.get('mime') ?? ''
    if (declared === 'image/jpeg' || declared === 'image/webp' || declared === 'image/png') return declared
    if (/\.jpe?g$/i.test(key)) return 'image/jpeg'
    if (/\.webp$/i.test(key)) return 'image/webp'
    return 'image/png'
}

/** Public image delivery is intentionally read-only and limited to this Worker's R2 prefix. */
async function serveCleanAsset(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
    if (request.method !== 'GET') return notFoundImage()
    const encodedKey = url.pathname.slice('/v1/assets/'.length)
    if (!encodedKey) return notFoundImage()
    const key = decodeURIComponent(encodedKey)
    if (!key.startsWith(`${env.R2_PREFIX}/`) || key.includes('\\')) return notFoundImage()
    const image = await env.PRIME.get(key)
    if (!image) return notFoundImage()
    return wrapImageWithCleanSvg(env, key, image, assetMime(url, key, image), ctx)
}

async function sha256(bytes: ArrayBuffer | Uint8Array | string): Promise<string> {
    const source = typeof bytes === 'string'
        ? new TextEncoder().encode(bytes).buffer
        : bytes instanceof Uint8Array
            ? new Uint8Array(bytes).buffer
            : bytes
    const digest = await crypto.subtle.digest('SHA-256', source)
    return `sha256:${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function base64UrlBytes(value: string): ArrayBuffer {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0)).buffer
}

function base64Bytes(value: string): ArrayBuffer {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0)).buffer
}

function constantTimeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false
    let different = 0
    for (let index = 0; index < left.length; index += 1) {
        different |= left.charCodeAt(index) ^ right.charCodeAt(index)
    }
    return different === 0
}

async function boundedJson(request: Request): Promise<unknown> {
    const bytes = await boundedBody(request, MAX_JSON_BYTES)
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

/** Stream limits are enforced before concatenation so oversized uploads never become Worker memory authority. */
async function boundedBody(request: Request, maximumBytes: number): Promise<ArrayBuffer> {
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (!Number.isFinite(declared) || declared < 0 || declared > maximumBytes) {
        throw new Error('E_TRANSFER_BODY_TOO_LARGE')
    }
    if (request.body === null) return new ArrayBuffer(0)
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maximumBytes) {
            await reader.cancel()
            throw new Error('E_TRANSFER_BODY_TOO_LARGE')
        }
        chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }
    return bytes.buffer
}

async function pair(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST' || request.headers.get('origin') !== null) return pairingDenial('request')
    const capability = request.headers.get('x-nais-pairing-capability') ?? ''
    const capabilityHash = await sha256(capability)
    if (!constantTimeEqual(capabilityHash.slice(7), env.PAIRING_CAPABILITY_SHA256.trim().toLowerCase())) {
        return pairingDenial('capability')
    }
    if (Date.now() > Number(env.PAIRING_EXPIRES_AT_MS.trim())) return pairingDenial('expiry')
    const body = await boundedJson(request) as Record<string, unknown>
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
    const publicKeySpki = typeof body.publicKeySpki === 'string' ? body.publicKeySpki : ''
    if (!validDeviceId(deviceId) || !/^[A-Za-z0-9+/=]{120,256}$/.test(publicKeySpki)) {
        return pairingDenial('body')
    }

    const pairingStub = env.TRANSFER_STATE.get(env.TRANSFER_STATE.idFromName('__pairing__'))
    const consume = await pairingStub.fetch('https://state.internal/consume-pairing', {
        method: 'POST',
        body: JSON.stringify({ capabilityHash, deviceId }),
    })
    if (!consume.ok) return pairingDenial('consume')
    const deviceStub = env.TRANSFER_STATE.get(env.TRANSFER_STATE.idFromName(`device:${deviceId}`))
    const installed = await deviceStub.fetch('https://state.internal/install-device', {
        method: 'POST',
        body: JSON.stringify({ deviceId, publicKeySpki }),
    })
    return installed.ok ? json({ paired: true, deviceId }, 201) : pairingDenial('install')
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        try {
            const url = new URL(request.url)
            if (url.pathname.startsWith('/v1/assets/')) return await serveCleanAsset(request, env, ctx, url)
            if (url.pathname === '/v1/ready' && request.method === 'GET'
                && request.headers.get('origin') === null) return readiness(env)
            if (url.pathname === '/v1/pair') return await pair(request, env)
            if (request.headers.get('origin') !== null) return denial()
            const deviceId = request.headers.get('x-nais-device') ?? ''
            if (!validDeviceId(deviceId)) return denial()
            return env.TRANSFER_STATE
                .get(env.TRANSFER_STATE.idFromName(`device:${deviceId}`))
                .fetch(request)
        } catch {
            return denial()
        }
    },
} satisfies ExportedHandler<Env>

/**
 * A SQLite-backed Durable Object serializes each paired device's replay fence,
 * idempotency results, tombstones, multipart metadata, and checkpoints. R2 is
 * the only byte authority; no prompt, credential, local path, or image body is
 * written to Durable Object storage.
 */
export class TransferStateObject extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)
        if (url.pathname === '/consume-pairing') return this.consumePairing(request)
        if (url.pathname === '/install-device') return this.installDevice(request)
        return this.authenticated(request, url)
    }

    private async consumePairing(request: Request): Promise<Response> {
        if (request.method !== 'POST') return denial()
        const body = await boundedJson(request) as { capabilityHash?: unknown; deviceId?: unknown }
        if (typeof body.capabilityHash !== 'string' || typeof body.deviceId !== 'string') return denial()
        const key = `pairing:${body.capabilityHash}`
        if (await this.ctx.storage.get(key) !== undefined) return denial()
        await this.ctx.storage.put(key, { deviceId: body.deviceId, consumedAtMs: Date.now() })
        return json({ consumed: true })
    }

    private async installDevice(request: Request): Promise<Response> {
        if (request.method !== 'POST') return denial()
        const body = await boundedJson(request) as { deviceId?: unknown; publicKeySpki?: unknown }
        if (typeof body.deviceId !== 'string' || typeof body.publicKeySpki !== 'string') return denial()
        const existing = await this.ctx.storage.get<DeviceRecord>('device')
        if (existing !== undefined) {
            return existing.deviceId === body.deviceId && existing.publicKeySpki === body.publicKeySpki
                ? json({ paired: true })
                : denial()
        }
        const device: DeviceRecord = {
            deviceId: body.deviceId,
            publicKeySpki: body.publicKeySpki,
            pairedAtMs: Date.now(),
            highWaterSequence: 0,
            recentNonces: [],
            revokedAtMs: null,
        }
        await this.ctx.storage.put('device', device)
        return json({ paired: true }, 201)
    }

    private async authenticated(request: Request, url: URL): Promise<Response> {
        const device = await this.ctx.storage.get<DeviceRecord>('device')
        if (device === undefined || device.revokedAtMs !== null) return denial()
        let metadata: SignedRequestMetadata
        try {
            metadata = parseSignedMetadata(request.headers)
        } catch {
            return denial()
        }
        if (metadata.deviceId !== device.deviceId) return denial()
        const isPart = request.method === 'PUT' && /\/parts\/\d{1,4}$/.test(url.pathname)
        const body = await boundedBody(request, isPart ? PART_BYTES : MAX_JSON_BYTES)
        const bodyHash = await sha256(body)
        if (bodyHash !== metadata.bodySha256) return denial()
        const fingerprint = await sha256(`${request.method}\n${url.pathname}\n${bodyHash}`)
        const operationKey = `operation:${metadata.idempotencyKey}`
        const existingOperation = await this.ctx.storage.get<OperationRecord>(operationKey)
        if (Math.abs(Date.now() - metadata.timestampMs) > MAX_CLOCK_SKEW_MS
            || !await this.verify(device.publicKeySpki, request.method, url.pathname, metadata)) return denial()
        if (existingOperation !== undefined) {
            if (existingOperation.fingerprint !== fingerprint) {
                return json({ code: 'E_TRANSFER_DUPLICATE_CONFLICT' }, 409)
            }
            // An exact signed retry may replay its sequence; a newer retry still advances the fence.
            if (metadata.sequence > device.highWaterSequence
                && !device.recentNonces.includes(metadata.nonce)) {
                await this.ctx.storage.put('device', {
                    ...device,
                    highWaterSequence: metadata.sequence,
                    recentNonces: [...device.recentNonces.slice(-127), metadata.nonce],
                } satisfies DeviceRecord)
            }
            return json({ ...existingOperation.response, duplicate: true }, existingOperation.status)
        }
        if (metadata.sequence <= device.highWaterSequence
            || device.recentNonces.includes(metadata.nonce)) return denial()

        const nextDevice: DeviceRecord = {
            ...device,
            highWaterSequence: metadata.sequence,
            recentNonces: [...device.recentNonces.slice(-127), metadata.nonce],
        }
        await this.ctx.storage.put('device', nextDevice)
        const response = await this.route(request, url, body)
        const responseBody = await response.clone().json<Record<string, unknown>>()
        await this.ctx.storage.put(operationKey, {
            fingerprint,
            status: response.status,
            response: responseBody,
        } satisfies OperationRecord)
        return response
    }

    private async verify(
        publicKeySpki: string,
        method: string,
        pathname: string,
        metadata: SignedRequestMetadata,
    ): Promise<boolean> {
        try {
            const key = await crypto.subtle.importKey(
                'spki',
                base64Bytes(publicKeySpki),
                { name: 'ECDSA', namedCurve: 'P-256' },
                false,
                ['verify'],
            )
            const canonical = canonicalRequest(method, pathname, metadata)
            return crypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' },
                key,
                base64UrlBytes(metadata.signature),
                new TextEncoder().encode(canonical),
            )
        } catch {
            return false
        }
    }

    private async route(request: Request, url: URL, body: ArrayBuffer): Promise<Response> {
        if (url.pathname === '/v1/revoke' && request.method === 'POST') {
            const device = await this.ctx.storage.get<DeviceRecord>('device')
            if (device === undefined) return denial()
            await this.ctx.storage.put('device', { ...device, revokedAtMs: Date.now() } satisfies DeviceRecord)
            return json({ revoked: true })
        }
        const match = /^\/v1\/transfers\/([A-Za-z0-9:_.-]{1,96})(?:\/(start|parts|complete|cancel|status)(?:\/(\d{1,4}))?)?$/.exec(url.pathname)
        if (match === null || !validTransferId(match[1])) return json({ code: 'E_TRANSFER_ROUTE' }, 404)
        const [, transferId, action, partText] = match
        if (action === 'start' && request.method === 'POST') return this.start(body)
        if (action === 'parts' && request.method === 'PUT' && partText !== undefined) {
            return this.uploadPart(transferId, Number(partText), request, body)
        }
        if (action === 'complete' && request.method === 'POST') return this.complete(transferId)
        if (action === 'cancel' && request.method === 'POST') return this.cancel(transferId)
        if (action === 'status' && request.method === 'GET') return this.status(transferId)
        return json({ code: 'E_TRANSFER_METHOD' }, 405)
    }

    private async start(body: ArrayBuffer): Promise<Response> {
        if (body.byteLength > MAX_JSON_BYTES) return json({ code: 'E_TRANSFER_BODY_TOO_LARGE' }, 413)
        let request: StartTransferRequest
        try {
            request = validateStartTransfer(JSON.parse(new TextDecoder().decode(body)) as unknown)
        } catch (error) {
            return json({ code: error instanceof Error ? error.message : 'E_TRANSFER_REQUEST_INVALID' }, 400)
        }
        const key = `job:${request.transferId}`
        const existing = await this.ctx.storage.get<JobRecord>(key)
        if (existing !== undefined) {
            const same = existing.contentSha256 === request.contentSha256 && existing.sizeBytes === request.sizeBytes
            return same ? this.jobResponse(existing) : json({ code: 'E_TRANSFER_ID_COLLISION' }, 409)
        }
        const device = await this.ctx.storage.get<DeviceRecord>('device')
        if (device === undefined) return denial()
        const deviceHash = (await sha256(device.deviceId)).slice(7, 23)
        const objectKey = `${this.env.R2_PREFIX}/${deviceHash}/${request.transferId}`
        const upload = await this.env.PRIME.createMultipartUpload(objectKey, {
            customMetadata: { sha256: request.contentSha256.slice(7) },
        })
        const job: JobRecord = {
            ...request,
            checkpointBytes: 0,
            state: 'running',
            objectKey,
            uploadId: upload.uploadId,
            completedParts: [],
            tombstonedAtMs: null,
            etag: null,
        }
        await this.ctx.storage.put(key, job)
        return this.jobResponse(job, 201)
    }

    private async uploadPart(
        transferId: string,
        partNumber: number,
        request: Request,
        body: ArrayBuffer,
    ): Promise<Response> {
        const key = `job:${transferId}`
        const job = await this.ctx.storage.get<JobRecord>(key)
        if (job === undefined) return json({ code: 'E_TRANSFER_NOT_FOUND' }, 404)
        if (job.tombstonedAtMs !== null || job.state === 'cancelled') return json({ code: 'E_TRANSFER_TOMBSTONED' }, 409)
        if (job.state !== 'running') return json({ code: 'E_TRANSFER_STALE_STATE' }, 409)
        const offset = (partNumber - 1) * PART_BYTES
        const isLast = offset + body.byteLength === job.sizeBytes
        if (!Number.isSafeInteger(partNumber) || partNumber < 1
            || offset !== job.checkpointBytes
            || body.byteLength < 1 || body.byteLength > PART_BYTES
            || (!isLast && body.byteLength !== PART_BYTES)) return json({ code: 'E_TRANSFER_PART_INVALID' }, 400)
        const declaredPartHash = request.headers.get('x-nais-part-sha256') ?? ''
        if (!validSha256(declaredPartHash) || await sha256(body) !== declaredPartHash) {
            return json({ code: 'E_TRANSFER_PART_DIGEST' }, 400)
        }
        const upload = this.env.PRIME.resumeMultipartUpload(job.objectKey, job.uploadId)
        const part = await upload.uploadPart(partNumber, body)
        const current = await this.ctx.storage.get<JobRecord>(key)
        if (current === undefined || current.tombstonedAtMs !== null || current.state !== 'running') {
            return json({ code: 'E_TRANSFER_TOMBSTONED' }, 409)
        }
        const next: JobRecord = {
            ...current,
            checkpointBytes: offset + body.byteLength,
            completedParts: [...current.completedParts, part],
        }
        await this.ctx.storage.put(key, next)
        return this.jobResponse(next)
    }

    private async complete(transferId: string): Promise<Response> {
        const key = `job:${transferId}`
        const job = await this.ctx.storage.get<JobRecord>(key)
        if (job === undefined) return json({ code: 'E_TRANSFER_NOT_FOUND' }, 404)
        if (job.tombstonedAtMs !== null || job.state === 'cancelled') return json({ code: 'E_TRANSFER_TOMBSTONED' }, 409)
        if (job.state === 'succeeded') return this.jobResponse(job)
        if (job.state !== 'running' || job.checkpointBytes !== job.sizeBytes) {
            return json({ code: 'E_TRANSFER_CHECKPOINT_INCOMPLETE' }, 409)
        }
        const committing: JobRecord = { ...job, state: 'committing' }
        await this.ctx.storage.put(key, committing)
        const completed = await this.env.PRIME
            .resumeMultipartUpload(job.objectKey, job.uploadId)
            .complete([...job.completedParts])
        const current = await this.ctx.storage.get<JobRecord>(key)
        if (current === undefined || current.tombstonedAtMs !== null || current.state === 'cancelled') {
            await this.env.PRIME.delete(job.objectKey)
            return json({ code: 'E_TRANSFER_TOMBSTONED' }, 409)
        }
        const succeeded: JobRecord = { ...current, state: 'succeeded', etag: completed.etag }
        await this.ctx.storage.put(key, succeeded)
        return this.jobResponse(succeeded)
    }

    private async cancel(transferId: string): Promise<Response> {
        const key = `job:${transferId}`
        const job = await this.ctx.storage.get<JobRecord>(key)
        if (job === undefined) return json({ code: 'E_TRANSFER_NOT_FOUND' }, 404)
        if (job.state === 'succeeded') return json({ code: 'E_TRANSFER_TERMINAL' }, 409)
        if (job.tombstonedAtMs !== null) return this.jobResponse(job)
        const cancelled: JobRecord = { ...job, state: 'cancelled', tombstonedAtMs: Date.now() }
        await this.ctx.storage.put(key, cancelled)
        try {
            await this.env.PRIME.resumeMultipartUpload(job.objectKey, job.uploadId).abort()
        } catch {
            // The tombstone is authoritative even when R2 already aborted the upload.
        }
        return this.jobResponse(cancelled)
    }

    private async status(transferId: string): Promise<Response> {
        const job = await this.ctx.storage.get<JobRecord>(`job:${transferId}`)
        return job === undefined ? json({ code: 'E_TRANSFER_NOT_FOUND' }, 404) : this.jobResponse(job)
    }

    private jobResponse(job: JobRecord, status = 200): Response {
        return json({
            transferId: job.transferId,
            state: job.state,
            checkpointBytes: job.checkpointBytes,
            sizeBytes: job.sizeBytes,
            tombstoned: job.tombstonedAtMs !== null,
            ...(job.state === 'succeeded' ? {
                r2Reference: {
                    bucket: 'prime',
                    key: job.objectKey,
                    etag: job.etag,
                    sizeBytes: job.sizeBytes,
                    contentSha256: job.contentSha256,
                },
            } : {}),
        }, status)
    }
}
import { DurableObject } from 'cloudflare:workers'
