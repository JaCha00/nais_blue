import type {
    SyncEnvelope,
    SyncRemoteApplyReceipt,
} from '@/domain/sync'
import {
    validateNativeInboundSyncItem,
    type NativeInboundSyncItem,
} from './native-lan-transport-adapter'

export interface NativeLanInboundQueue {
    /** Non-destructive read; the same front item must survive process restart. */
    peekInbound(limit: number): Promise<readonly NativeInboundSyncItem[]>
    /** Removes only the exact durable front item after Phase 11 commits it. */
    acknowledgeInbound(requestId: string): Promise<void>
}

export interface SyncIngressRepository {
    receiveRemote(value: SyncEnvelope, receivedAt: string): Promise<SyncRemoteApplyReceipt>
}

export interface NativeLanIngressResult {
    readonly nativeItemsAcknowledged: number
    readonly envelopesApplied: number
    readonly duplicateEnvelopes: number
}

function assertTimestamp(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        || !Number.isFinite(Date.parse(value))
        || new Date(value).toISOString() !== value) {
        throw new TypeError('Ingress receivedAt must be a canonical UTC timestamp.')
    }
}

/**
 * Crash-safe server ingress boundary. It depends on native durable peek/ack and
 * the duplicate-safe Phase 11 repository; every envelope is committed before
 * the native item is removed, so interruption can cause replay but not loss.
 */
export class NativeLanIngressCoordinator {
    private active = false

    constructor(
        private readonly repository: SyncIngressRepository,
        private readonly nativeQueue: NativeLanInboundQueue,
    ) {}

    async processOnce(input: {
        readonly receivedAt: string
        readonly limit?: number
        readonly signal?: AbortSignal
    }): Promise<NativeLanIngressResult> {
        assertTimestamp(input.receivedAt)
        const limit = input.limit ?? 32
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) {
            throw new TypeError('Ingress item limit must be between 1 and 128.')
        }
        if (this.active) throw new Error('A LAN ingress pass is already active.')
        this.active = true
        let nativeItemsAcknowledged = 0
        let envelopesApplied = 0
        let duplicateEnvelopes = 0
        try {
            this.assertActive(input.signal)
            const items = await this.nativeQueue.peekInbound(limit)
            if (items.length > limit) throw new TypeError('Native ingress returned more items than requested.')
            for (const candidate of items) {
                const item = validateNativeInboundSyncItem(candidate)
                this.assertActive(input.signal)
                for (const envelope of item.payload) {
                    this.assertActive(input.signal)
                    const receipt = await this.repository.receiveRemote(envelope, input.receivedAt)
                    envelopesApplied += 1
                    if (receipt.duplicateDelivery) duplicateEnvelopes += 1
                }
                this.assertActive(input.signal)
                await this.nativeQueue.acknowledgeInbound(item.requestId)
                nativeItemsAcknowledged += 1
            }
            return { nativeItemsAcknowledged, envelopesApplied, duplicateEnvelopes }
        } finally {
            this.active = false
        }
    }

    private assertActive(signal: AbortSignal | undefined): void {
        if (signal?.aborted !== true) return
        throw new DOMException('The LAN ingress pass was cancelled.', 'AbortError')
    }
}
