import type {
    SyncCheckpoint,
    SyncCheckpointRecord,
    SyncEnvelope,
    SyncOutboxRecord,
} from '@/domain/sync'
import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import { SyncTransportError } from '@/domain/sync'
import type { NativeOutboundSyncReceipt } from './native-lan-transport-adapter'

export interface NativeLanOutboundQueue {
    enqueueOutbound(input: {
        readonly peerFingerprint: string
        readonly deliveryId: string
        readonly opIds: readonly string[]
        readonly payload: readonly SyncEnvelope[]
    }): Promise<void>
    peekOutboundReceipts(limit: number): Promise<readonly NativeOutboundSyncReceipt[]>
    acknowledgeOutboundReceipt(receipt: NativeOutboundSyncReceipt): Promise<void>
}

export interface SyncEgressRepository {
    listReadyOutbox(input: { readonly now: string; readonly limit: number }): Promise<readonly SyncOutboxRecord[]>
    getOutbox(opId: string): Promise<SyncOutboxRecord | null>
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
}

export interface NativeLanEgressPublishResult {
    readonly enqueued: boolean
    readonly waitingForRemoteAck: boolean
    readonly deliveryId: string | null
}

function canonicalTimestamp(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        || !Number.isFinite(Date.parse(value))
        || new Date(value).toISOString() !== value) {
        throw new TypeError('Egress time must be a canonical UTC timestamp.')
    }
}

function fingerprint(value: string): string {
    if (!/^sha256:[a-f0-9]{64}$/i.test(value)) throw new TypeError('Peer fingerprint is invalid.')
    return value.toLowerCase()
}

function checkpointKey(peerFingerprint: string): string {
    return `lan-egress:${peerFingerprint}`
}

function deliveryId(envelope: SyncEnvelope): string {
    return `op:${hashCanonicalValue(envelope)}`
}

function retryFailureCode(error: unknown): string {
    return error instanceof SyncTransportError ? error.code : 'E_SYNC_TRANSPORT'
}

/**
 * Server egress keeps Phase 11 as the operation authority while using native
 * durability only as a transport journal. Stable op IDs make re-enqueue
 * idempotent, and the source outbox is acked only after the remote device
 * creates a durable native receipt.
 */
export class NativeLanEgressCoordinator {
    private readonly peerFingerprint: string

    constructor(
        private readonly repository: SyncEgressRepository,
        private readonly nativeQueue: NativeLanOutboundQueue,
        peerFingerprint: string,
        private readonly retryDelayMs = 5_000,
    ) {
        this.peerFingerprint = fingerprint(peerFingerprint)
        if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 86_400_000) {
            throw new TypeError('Egress retry delay must be between zero and one day.')
        }
    }

    async publishNext(now: string): Promise<NativeLanEgressPublishResult> {
        canonicalTimestamp(now)
        const selected: SyncOutboxRecord | null = (
            await this.repository.listReadyOutbox({ now, limit: 1 })
        )[0] ?? null
        if (selected === null) {
            return { enqueued: false, waitingForRemoteAck: false, deliveryId: null }
        }
        const claimed = await this.repository.markAttempt({ opId: selected.opId, attemptedAt: now })
        const selectedDeliveryId = deliveryId(claimed.envelope)
        try {
            await this.nativeQueue.enqueueOutbound({
                peerFingerprint: this.peerFingerprint,
                deliveryId: selectedDeliveryId,
                opIds: [claimed.opId],
                payload: [claimed.envelope],
            })
        } catch (error) {
            if (claimed.inFlightUntil !== null) {
                await this.repository.scheduleRetry({
                    opId: claimed.opId,
                    nextAttemptAt: new Date(Date.parse(now) + this.retryDelayMs).toISOString(),
                    failureCode: retryFailureCode(error),
                    expectedAttemptCount: claimed.attemptCount,
                    expectedInFlightUntil: claimed.inFlightUntil,
                })
            }
            throw error
        }
        return {
            enqueued: true,
            waitingForRemoteAck: true,
            deliveryId: selectedDeliveryId,
        }
    }

    async applyRemoteReceipts(input: {
        readonly ackedAt: string
        readonly limit?: number
    }): Promise<number> {
        canonicalTimestamp(input.ackedAt)
        const limit = input.limit ?? 32
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) {
            throw new TypeError('Outbound receipt limit must be between 1 and 128.')
        }
        const receipts = await this.nativeQueue.peekOutboundReceipts(limit)
        if (receipts.length > limit) throw new TypeError('Native receipt result exceeded its bound.')
        const peerId = checkpointKey(this.peerFingerprint)
        let applied = 0
        for (const receipt of receipts) {
            if (fingerprint(receipt.peerFingerprint) !== fingerprint(this.peerFingerprint)) {
                throw new TypeError('Outbound receipt belongs to a different paired device.')
            }
            if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1 || receipt.opIds.length !== 1) {
                throw new Error('Outbound receipt batch or sequence is not deterministic.')
            }
            const record = await this.repository.getOutbox(receipt.opIds[0])
            if (record === null || deliveryId(record.envelope) !== receipt.deliveryId) {
                throw new Error('Outbound receipt has no matching Phase 11 operation.')
            }
            await this.repository.acknowledge({
                opIds: receipt.opIds,
                peerId,
                checkpoint: { sequence: receipt.sequence, cursor: receipt.deliveryId },
                ackedAt: input.ackedAt,
            })
            await this.nativeQueue.acknowledgeOutboundReceipt(receipt)
            applied += 1
        }
        return applied
    }

    /** Receipts are always reconciled before another source operation is leased. */
    async synchronizeOnce(now: string): Promise<{
        readonly receiptsApplied: number
        readonly publish: NativeLanEgressPublishResult
    }> {
        const receiptsApplied = await this.applyRemoteReceipts({ ackedAt: now })
        const publish = await this.publishNext(now)
        return { receiptsApplied, publish }
    }
}
