import { assertSyncPayloadSafe } from './payload-safety'
import { validateSyncEnvelope } from './envelope'
import type {
    SyncCheckpoint,
    SyncEnvelope,
} from './types'

export const SYNC_TRANSPORT_PROTOCOL_VERSION = 1 as const
export const SYNC_TRANSPORT_MAX_JSON_BYTES = 2 * 1024 * 1024
export const SYNC_TRANSPORT_MAX_OPERATIONS = 100
export const SYNC_BLOB_CHUNK_BYTES = 1024 * 1024
export const SYNC_BLOB_MAX_BYTES = 2 * 1024 * 1024 * 1024

export type SyncTransportErrorCode =
    | 'E_SYNC_UNPAIRED'
    | 'E_SYNC_PAIRING_EXPIRED'
    | 'E_SYNC_REPLAY'
    | 'E_SYNC_TAMPERED'
    | 'E_SYNC_REVOKED'
    | 'E_SYNC_PAYLOAD_TOO_LARGE'
    | 'E_SYNC_PROTOCOL_INVALID'
    | 'E_SYNC_TIMEOUT'
    | 'E_SYNC_CANCELLED'
    | 'E_SYNC_R2_OBJECT_MISSING'
    | 'E_SYNC_TRANSPORT'

/**
 * Stable, redaction-safe transport failure. It links native TLS/worker errors
 * to retry scheduling without carrying certificates, endpoints, or payloads.
 */
export class SyncTransportError extends Error {
    constructor(
        readonly code: SyncTransportErrorCode,
        message: string,
        readonly retryable: boolean,
    ) {
        super(message)
        this.name = 'SyncTransportError'
    }
}

export interface SyncTransportManifest {
    readonly protocolVersion: typeof SYNC_TRANSPORT_PROTOCOL_VERSION
    readonly peerId: string
    readonly pendingOperations: number
    readonly maxJsonBytes: typeof SYNC_TRANSPORT_MAX_JSON_BYTES
    readonly maxOperations: typeof SYNC_TRANSPORT_MAX_OPERATIONS
    /** Image bytes never appear in a JSON batch; R2 references are the default. */
    readonly imageMode: 'r2-reference' | 'lan-blob-optional'
}

export interface SyncTransportPullResult {
    readonly envelopes: readonly SyncEnvelope[]
    readonly checkpoint: SyncCheckpoint
    readonly hasMore: boolean
}

export interface SyncTransportPushReceipt {
    readonly acceptedOpIds: readonly string[]
    readonly checkpoint: SyncCheckpoint
}

export interface SyncTransportRequestOptions {
    readonly requestId?: string
    readonly timeoutMs?: number
    readonly signal?: AbortSignal
}

/**
 * Provider-neutral exchange boundary. Native LAN mTLS and a future relay both
 * connect here; the Phase 11 repository remains the durable operation owner.
 */
export interface SyncTransport {
    readonly kind: 'lan' | 'relay-test'
    readonly peerId: string
    manifest(options?: SyncTransportRequestOptions): Promise<SyncTransportManifest>
    pull(input: SyncTransportRequestOptions & {
        readonly after: SyncCheckpoint | null
        readonly limit: number
    }): Promise<SyncTransportPullResult>
    acknowledgePull(input: SyncTransportRequestOptions & {
        readonly opIds: readonly string[]
        readonly checkpoint: SyncCheckpoint
    }): Promise<void>
    push(input: SyncTransportRequestOptions & {
        readonly envelopes: readonly SyncEnvelope[]
    }): Promise<SyncTransportPushReceipt>
    cancel(requestId: string): Promise<void>
}

/** Relay remains a provider-free test contract; no production endpoint exists. */
export interface RelayTransport extends SyncTransport {
    readonly kind: 'relay-test'
    readonly provider: 'contract-test'
}

export interface RelayTestRequestContext {
    readonly peerId: string
    readonly requestId: string
    readonly sequence: number
    readonly nonce: string
    readonly authenticated: true
}

export interface RelayTestDeniedResponse {
    readonly status: 401
    /** An unauthenticated response deliberately carries no manifest/entity metadata. */
    readonly body: null
}

/**
 * Local/fake server seam used to verify relay semantics without selecting a
 * provider, URL, auth system, or production dependency in this phase.
 */
export interface RelayTestServerContract {
    denyUnpaired(): Promise<RelayTestDeniedResponse>
    manifest(context: RelayTestRequestContext): Promise<SyncTransportManifest>
    pull(context: RelayTestRequestContext, after: SyncCheckpoint | null, limit: number): Promise<SyncTransportPullResult>
    acknowledge(
        context: RelayTestRequestContext,
        opIds: readonly string[],
        checkpoint: SyncCheckpoint,
    ): Promise<void>
    push(context: RelayTestRequestContext, envelopes: readonly SyncEnvelope[]): Promise<SyncTransportPushReceipt>
}

export type SyncBlobPolicy = 'original' | 'distribution'

export interface SyncBlobTransferDescriptor {
    readonly transferId: string
    readonly artifactId: string
    readonly variantId: string
    readonly size: number
    readonly sha256: string
    readonly policy: SyncBlobPolicy
}

export interface SyncBlobResumeState {
    readonly transferId: string
    readonly committedBytes: number
    readonly nextChunkIndex: number
}

/**
 * Optional byte channel linked to native temp-file/checksum handling. Keeping
 * it separate makes JSON stop-gate validation independent from image transfer.
 */
export interface SyncBlobTransport {
    begin(descriptor: SyncBlobTransferDescriptor, options?: SyncTransportRequestOptions): Promise<SyncBlobResumeState>
    append(input: SyncTransportRequestOptions & {
        readonly transferId: string
        readonly chunkIndex: number
        readonly offset: number
        readonly bytes: Uint8Array
    }): Promise<SyncBlobResumeState>
    complete(input: SyncTransportRequestOptions & {
        readonly transferId: string
        readonly sha256: string
    }): Promise<{ readonly committed: true }>
}

function protocolError(message: string): never {
    throw new SyncTransportError('E_SYNC_PROTOCOL_INVALID', message, false)
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
        || value.length === 0
        || value.length > 512
        || /[\0\r\n]/.test(value)
        || /[a-z]:[\\/]|\\\\|\/(?:home|users|data|storage|sdcard|tmp)(?:\/|$)/i.test(value)) {
        protocolError(`${field} is not a bounded portable identifier.`)
    }
}

function assertPortableBlobIdentifier(value: unknown, field: string): asserts value is string {
    assertIdentifier(value, field)
    if (!/^[a-z0-9:._-]+$/i.test(value)) protocolError(`${field} is not a portable blob identifier.`)
}

function encodedSize(value: unknown): number {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength
    } catch {
        protocolError('Sync transport body must be canonical JSON.')
    }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        protocolError(`${label} must be an object.`)
    }
    return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
    if (Object.keys(record).length !== keys.length || Object.keys(record).some(key => !keys.includes(key))) {
        protocolError(`${label} contains an unknown or missing field.`)
    }
}

export function validateSyncTransportCheckpoint(value: unknown): SyncCheckpoint {
    const record = asRecord(value, 'Transport checkpoint')
    assertExactKeys(record, ['sequence', 'cursor'], 'Transport checkpoint')
    if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 0) {
        protocolError('Transport checkpoint sequence is invalid.')
    }
    assertIdentifier(record.cursor, 'checkpoint.cursor')
    return { sequence: Number(record.sequence), cursor: record.cursor }
}

export function validateSyncTransportManifest(
    value: unknown,
    expectedPeerId: string,
): SyncTransportManifest {
    const record = asRecord(value, 'Transport manifest')
    assertExactKeys(record, [
        'protocolVersion', 'peerId', 'pendingOperations', 'maxJsonBytes', 'maxOperations', 'imageMode',
    ], 'Transport manifest')
    assertIdentifier(record.peerId, 'manifest.peerId')
    if (record.protocolVersion !== SYNC_TRANSPORT_PROTOCOL_VERSION
        || record.peerId !== expectedPeerId
        || !Number.isSafeInteger(record.pendingOperations)
        || Number(record.pendingOperations) < 0
        || Number(record.pendingOperations) > 512
        || record.maxJsonBytes !== SYNC_TRANSPORT_MAX_JSON_BYTES
        || record.maxOperations !== SYNC_TRANSPORT_MAX_OPERATIONS
        || (record.imageMode !== 'r2-reference' && record.imageMode !== 'lan-blob-optional')) {
        protocolError('Authenticated peer manifest is inconsistent.')
    }
    return {
        protocolVersion: SYNC_TRANSPORT_PROTOCOL_VERSION,
        peerId: record.peerId,
        pendingOperations: Number(record.pendingOperations),
        maxJsonBytes: SYNC_TRANSPORT_MAX_JSON_BYTES,
        maxOperations: SYNC_TRANSPORT_MAX_OPERATIONS,
        imageMode: record.imageMode,
    }
}

export function validateSyncTransportPullResult(value: unknown): SyncTransportPullResult {
    const record = asRecord(value, 'Transport pull result')
    assertExactKeys(record, ['envelopes', 'checkpoint', 'hasMore'], 'Transport pull result')
    if (typeof record.hasMore !== 'boolean') protocolError('Transport pull continuation marker is invalid.')
    return {
        envelopes: assertSyncTransportBatch(record.envelopes),
        checkpoint: validateSyncTransportCheckpoint(record.checkpoint),
        hasMore: record.hasMore,
    }
}

export function validateSyncTransportPushReceipt(value: unknown): SyncTransportPushReceipt {
    const record = asRecord(value, 'Transport push receipt')
    assertExactKeys(record, ['acceptedOpIds', 'checkpoint'], 'Transport push receipt')
    if (!Array.isArray(record.acceptedOpIds) || record.acceptedOpIds.length > SYNC_TRANSPORT_MAX_OPERATIONS) {
        protocolError('Transport push receipt operation list is invalid.')
    }
    record.acceptedOpIds.forEach(opId => assertIdentifier(opId, 'acceptedOpId'))
    return {
        acceptedOpIds: [...record.acceptedOpIds] as string[],
        checkpoint: validateSyncTransportCheckpoint(record.checkpoint),
    }
}

/**
 * Re-validates Phase 11 envelopes at the network edge, then applies the tighter
 * LAN batch bound so native and renderer parsers share the same admission rule.
 */
export function assertSyncTransportBatch(value: unknown): SyncEnvelope[] {
    if (!Array.isArray(value) || value.length > SYNC_TRANSPORT_MAX_OPERATIONS) {
        throw new SyncTransportError('E_SYNC_PAYLOAD_TOO_LARGE', 'Sync operation batch exceeded its bound.', false)
    }
    if (encodedSize(value) > SYNC_TRANSPORT_MAX_JSON_BYTES) {
        throw new SyncTransportError('E_SYNC_PAYLOAD_TOO_LARGE', 'Sync JSON body exceeded its byte bound.', false)
    }
    try {
        return value.map(item => {
            const envelope = validateSyncEnvelope(item)
            assertSyncPayloadSafe(envelope)
            return envelope
        })
    } catch (error) {
        if (error instanceof SyncTransportError) throw error
        throw new SyncTransportError('E_SYNC_PROTOCOL_INVALID', 'Sync batch failed envelope safety validation.', false)
    }
}

export function validateBlobTransferDescriptor(value: unknown): SyncBlobTransferDescriptor {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        protocolError('Blob descriptor must be an object.')
    }
    const record = value as Record<string, unknown>
    if (Object.keys(record).some(key => ![
        'transferId', 'artifactId', 'variantId', 'size', 'sha256', 'policy',
    ].includes(key))) protocolError('Blob descriptor contains an unknown field.')
    assertPortableBlobIdentifier(record.transferId, 'transferId')
    assertPortableBlobIdentifier(record.artifactId, 'artifactId')
    assertPortableBlobIdentifier(record.variantId, 'variantId')
    if (!Number.isSafeInteger(record.size)
        || Number(record.size) <= 0
        || Number(record.size) > SYNC_BLOB_MAX_BYTES) {
        protocolError('Blob size must be positive and within the transport bound.')
    }
    if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256)) {
        protocolError('Blob checksum must be SHA-256 hex.')
    }
    if (record.policy !== 'original' && record.policy !== 'distribution') {
        protocolError('Blob policy must identify original or distribution bytes.')
    }
    return {
        transferId: record.transferId,
        artifactId: record.artifactId,
        variantId: record.variantId,
        size: Number(record.size),
        sha256: record.sha256.toLowerCase(),
        policy: record.policy,
    }
}
