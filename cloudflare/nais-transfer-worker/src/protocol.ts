export const MAX_JSON_BYTES = 2 * 1024 * 1024
export const PART_BYTES = 5 * 1024 * 1024
export const MAX_TRANSFER_BYTES = 8 * 1024 * 1024 * 1024
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

const IDENTIFIER = /^[A-Za-z0-9:_.-]{1,96}$/
const DEVICE_IDENTIFIER = /^[A-Za-z0-9_.-]{8,96}$/
const SHA256 = /^sha256:[0-9a-f]{64}$/
const NONCE = /^[A-Za-z0-9_-]{22,64}$/
const FORBIDDEN_KEY = /token|authorization|secret|password|signed.?url|prompt|image|thumbnail|base64|bytes|path/i
const FORBIDDEN_VALUE = /(?:authorization|bearer\s|x-amz-|data:image|file:|:\/\/)/i

export interface StartTransferRequest {
    readonly transferId: string
    readonly kind: 'r2-upload'
    readonly contentSha256: string
    readonly sizeBytes: number
}

export interface SignedRequestMetadata {
    readonly deviceId: string
    readonly sequence: number
    readonly nonce: string
    readonly timestampMs: number
    readonly idempotencyKey: string
    readonly bodySha256: string
    readonly signature: string
}

export function canonicalRequest(
    method: string,
    pathname: string,
    metadata: Omit<SignedRequestMetadata, 'deviceId' | 'signature'>,
): string {
    return [
        method.toUpperCase(),
        pathname,
        String(metadata.sequence),
        metadata.nonce,
        String(metadata.timestampMs),
        metadata.idempotencyKey,
        metadata.bodySha256,
    ].join('\n')
}

export function parseSignedMetadata(headers: Headers): SignedRequestMetadata {
    const deviceId = headers.get('x-nais-device') ?? ''
    const sequence = Number(headers.get('x-nais-sequence'))
    const nonce = headers.get('x-nais-nonce') ?? ''
    const timestampMs = Number(headers.get('x-nais-timestamp'))
    const idempotencyKey = headers.get('x-nais-idempotency') ?? ''
    const bodySha256 = headers.get('x-nais-content-sha256') ?? ''
    const signature = headers.get('x-nais-signature') ?? ''
    if (!DEVICE_IDENTIFIER.test(deviceId)
        || !Number.isSafeInteger(sequence) || sequence < 1
        || !NONCE.test(nonce)
        || !Number.isSafeInteger(timestampMs) || timestampMs < 1
        || !IDENTIFIER.test(idempotencyKey)
        || !SHA256.test(bodySha256)
        || !/^[A-Za-z0-9_-]{80,96}$/.test(signature)) {
        throw new Error('E_TRANSFER_AUTH_INVALID')
    }
    return { deviceId, sequence, nonce, timestampMs, idempotencyKey, bodySha256, signature }
}

export function validateStartTransfer(value: unknown): StartTransferRequest {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('E_TRANSFER_REQUEST_INVALID')
    }
    rejectForbiddenJson(value)
    const record = value as Record<string, unknown>
    if (Object.keys(record).sort().join(',') !== 'contentSha256,kind,sizeBytes,transferId'
        || typeof record.transferId !== 'string' || !IDENTIFIER.test(record.transferId)
        || record.kind !== 'r2-upload'
        || typeof record.contentSha256 !== 'string' || !SHA256.test(record.contentSha256)
        || typeof record.sizeBytes !== 'number' || !Number.isSafeInteger(record.sizeBytes)
        || record.sizeBytes < 1 || record.sizeBytes > MAX_TRANSFER_BYTES) {
        throw new Error('E_TRANSFER_REQUEST_INVALID')
    }
    return record as unknown as StartTransferRequest
}

export function rejectForbiddenJson(value: unknown, key = ''): void {
    if (key && FORBIDDEN_KEY.test(key) && !/^(?:contentSha256|bodySha256|sizeBytes|checkpointBytes)$/.test(key)) {
        throw new Error('E_TRANSFER_FORBIDDEN_MATERIAL')
    }
    if (typeof value === 'string' && FORBIDDEN_VALUE.test(value)) {
        throw new Error('E_TRANSFER_FORBIDDEN_MATERIAL')
    }
    if (Array.isArray(value)) {
        for (const item of value) rejectForbiddenJson(item)
    } else if (typeof value === 'object' && value !== null) {
        for (const [childKey, child] of Object.entries(value)) rejectForbiddenJson(child, childKey)
    }
}

export function validDeviceId(value: string): boolean {
    return DEVICE_IDENTIFIER.test(value)
}

export function validTransferId(value: string): boolean {
    return IDENTIFIER.test(value)
}

export function validSha256(value: string): boolean {
    return SHA256.test(value)
}
