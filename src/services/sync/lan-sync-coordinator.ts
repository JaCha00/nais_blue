import type {
    ActiveSyncEntityType,
    SyncCheckpoint,
    SyncCheckpointRecord,
    SyncEntityRecord,
    SyncOutboxRecord,
    SyncRemoteApplyReceipt,
} from '@/domain/sync'
import {
    SYNC_TRANSPORT_MAX_OPERATIONS,
    SyncTransportError,
    assertSyncTransportBatch,
    validateSyncTransportManifest,
    validateSyncTransportPullResult,
    validateSyncTransportPushReceipt,
    type SyncTransport,
    type SyncTransportRequestOptions,
} from '@/domain/sync/transport'

const DEFAULT_RETRY_DELAY_MS = 5_000

/** Existing repository seam; no network or source-of-truth responsibility moves into this coordinator. */
export interface SyncRepositoryPort {
    listReadyOutbox(input: { readonly now: string; readonly limit?: number }): Promise<SyncOutboxRecord[]>
    markAttempt(input: { readonly opId: string; readonly attemptedAt: string }): Promise<SyncOutboxRecord>
    scheduleRetry(input: {
        readonly opId: string
        readonly nextAttemptAt: string
        readonly failureCode: string
        readonly expectedAttemptCount: number
        readonly expectedInFlightUntil: string
    }): Promise<SyncOutboxRecord>
    acknowledge(input: {
        readonly opIds: readonly string[]
        readonly peerId: string
        readonly checkpoint: SyncCheckpoint
        readonly ackedAt: string
    }): Promise<SyncCheckpointRecord>
    getCheckpoint(peerId: string): Promise<SyncCheckpointRecord | null>
    receiveRemote(value: unknown, receivedAt?: string): Promise<SyncRemoteApplyReceipt>
    getEntity(entityType: ActiveSyncEntityType, entityId: string): Promise<SyncEntityRecord | null>
}

export interface LanSyncRunResult {
    readonly pulled: number
    readonly pushed: number
    readonly duplicates: number
    readonly moreInbound: boolean
    readonly inboundCheckpoint: SyncCheckpoint | null
    readonly outboundCheckpoint: SyncCheckpoint | null
}

/** Pull cursors and push receipts are independent streams and must never share a repository key. */
export function inboundCheckpointPeerId(peerId: string): string {
    return `${peerId}:pull`
}

export function outboundCheckpointPeerId(peerId: string): string {
    return `${peerId}:push`
}

function abortError(): SyncTransportError {
    return new SyncTransportError('E_SYNC_CANCELLED', 'Sync was cancelled.', true)
}

function assertActive(signal?: AbortSignal): void {
    if (signal?.aborted === true) throw abortError()
}

function retryFailureCode(error: unknown): string {
    if (error instanceof SyncTransportError) return error.code
    return 'E_SYNC_TRANSPORT'
}

function retryAt(now: string, delayMs: number): string {
    const epoch = Date.parse(now)
    if (!Number.isFinite(epoch)) throw new TypeError('now must be a canonical timestamp.')
    return new Date(epoch + delayMs).toISOString()
}

function plainCheckpoint(value: SyncCheckpoint | null): SyncCheckpoint | null {
    return value === null ? null : { sequence: value.sequence, cursor: value.cursor }
}

function assertAcceptedIds(
    accepted: readonly string[],
    claimed: readonly SyncOutboxRecord[],
): Set<string> {
    const allowed = new Set(claimed.map(record => record.opId))
    const result = new Set<string>()
    for (const opId of accepted) {
        if (!allowed.has(opId) || result.has(opId)) {
            throw new SyncTransportError('E_SYNC_PROTOCOL_INVALID', 'Push receipt contained an invalid operation identity.', false)
        }
        result.add(opId)
    }
    return result
}

/**
 * One bounded reconnect pass. It composes authenticated native transport with
 * Phase 11 leases/inbox/checkpoints so crashes re-deliver safely and tombstone
 * resolution continues to be owned by the existing repository.
 */
export class LanSyncCoordinator {
    constructor(
        private readonly repository: SyncRepositoryPort,
        private readonly transport: SyncTransport,
        private readonly retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        private readonly timeoutMs = 30_000,
        private readonly createRequestId: () => string = () => `sync-${crypto.randomUUID()}`,
    ) {}

    async synchronizeOnce(input: {
        readonly now: string
        readonly limit?: number
        readonly signal?: AbortSignal
    }): Promise<LanSyncRunResult> {
        assertActive(input.signal)
        const limit = Math.max(1, Math.min(SYNC_TRANSPORT_MAX_OPERATIONS, Math.trunc(input.limit ?? 100)))
        if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) {
            throw new TypeError('Sync timeout must be between 1 and 120 seconds.')
        }
        validateSyncTransportManifest(
            await this.runRequest(input.signal, options => this.transport.manifest(options)),
            this.transport.peerId,
        )

        const inboundPeerId = inboundCheckpointPeerId(this.transport.peerId)
        const outboundPeerId = outboundCheckpointPeerId(this.transport.peerId)
        let inboundCheckpoint = plainCheckpoint(await this.repository.getCheckpoint(inboundPeerId))
        let outboundCheckpoint = plainCheckpoint(await this.repository.getCheckpoint(outboundPeerId))
        const pull = validateSyncTransportPullResult(await this.runRequest(
            input.signal,
            options => this.transport.pull({
                ...options,
                after: inboundCheckpoint,
                limit,
            }),
        ))
        const incoming = pull.envelopes
        let duplicates = 0
        for (const envelope of incoming) {
            assertActive(input.signal)
            const receipt = await this.repository.receiveRemote(envelope, input.now)
            if (receipt.duplicateDelivery) duplicates += 1
        }
        if (incoming.length > 0 || pull.checkpoint.sequence > (inboundCheckpoint?.sequence ?? -1)) {
            await this.runRequest(input.signal, options => this.transport.acknowledgePull({
                ...options,
                opIds: incoming.map(envelope => envelope.opId),
                checkpoint: pull.checkpoint,
            }))
            inboundCheckpoint = plainCheckpoint(await this.repository.acknowledge({
                opIds: [],
                peerId: inboundPeerId,
                checkpoint: pull.checkpoint,
                ackedAt: input.now,
            }))
        }

        const ready = await this.repository.listReadyOutbox({ now: input.now, limit })
        const claimed: SyncOutboxRecord[] = []
        try {
            for (const record of ready) {
                assertActive(input.signal)
                claimed.push(await this.repository.markAttempt({ opId: record.opId, attemptedAt: input.now }))
            }
            if (claimed.length === 0) {
                return {
                    pulled: incoming.length,
                    pushed: 0,
                    duplicates,
                    moreInbound: pull.hasMore,
                    inboundCheckpoint,
                    outboundCheckpoint,
                }
            }
            const envelopes = assertSyncTransportBatch(claimed.map(record => record.envelope))
            const receipt = validateSyncTransportPushReceipt(await this.runRequest(
                input.signal,
                options => this.transport.push({
                    ...options,
                    envelopes,
                }),
            ))
            const accepted = assertAcceptedIds(receipt.acceptedOpIds, claimed)
            if (accepted.size > 0) {
                outboundCheckpoint = plainCheckpoint(await this.repository.acknowledge({
                    opIds: [...accepted],
                    peerId: outboundPeerId,
                    checkpoint: receipt.checkpoint,
                    ackedAt: input.now,
                }))
            }
            const unaccepted = claimed.filter(record => !accepted.has(record.opId))
            await this.scheduleRetries(unaccepted, input.now, 'E_SYNC_TRANSPORT')
            return {
                pulled: incoming.length,
                pushed: accepted.size,
                duplicates,
                moreInbound: pull.hasMore,
                inboundCheckpoint,
                outboundCheckpoint,
            }
        } catch (error) {
            await this.scheduleRetries(claimed, input.now, retryFailureCode(error))
            throw error
        }
    }

    private async scheduleRetries(
        records: readonly SyncOutboxRecord[],
        now: string,
        failureCode: string,
    ): Promise<void> {
        for (const record of records) {
            if (record.inFlightUntil === null) continue
            await this.repository.scheduleRetry({
                opId: record.opId,
                nextAttemptAt: retryAt(now, this.retryDelayMs),
                failureCode,
                expectedAttemptCount: record.attemptCount,
                expectedInFlightUntil: record.inFlightUntil,
            })
        }
    }

    private async runRequest<T>(
        signal: AbortSignal | undefined,
        execute: (options: SyncTransportRequestOptions) => Promise<T>,
    ): Promise<T> {
        assertActive(signal)
        const requestId = this.createRequestId()
        if (!/^[a-z0-9:_-]{4,160}$/i.test(requestId)) throw new TypeError('Sync request ID is invalid.')
        const cancel = () => {
            void this.transport.cancel(requestId).catch(() => undefined)
        }
        signal?.addEventListener('abort', cancel, { once: true })
        try {
            if (signal?.aborted === true) {
                cancel()
                throw abortError()
            }
            return await execute({ requestId, timeoutMs: this.timeoutMs, signal })
        } finally {
            signal?.removeEventListener('abort', cancel)
        }
    }
}
