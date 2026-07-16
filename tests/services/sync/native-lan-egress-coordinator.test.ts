import { describe, expect, it } from 'vitest'

import type { SyncEnvelope } from '@/domain/sync'
import { SyncTransportError } from '@/domain/sync'
import { NativeLanEgressCoordinator } from '@/services/sync/native-lan-egress-coordinator'
import type { NativeOutboundSyncReceipt } from '@/services/sync/native-lan-transport-adapter'
import { LATER, NOW } from '../../domain/sync/constants'
import { repository } from '../../domain/sync/fixtures'

const FINGERPRINT = `sha256:${'b'.repeat(64)}`

class DurableOutboundQueue {
    readonly deliveries: Array<{
        peerFingerprint: string
        deliveryId: string
        opIds: readonly string[]
        payload: readonly SyncEnvelope[]
    }> = []
    readonly receipts: NativeOutboundSyncReceipt[] = []
    failEnqueue = false
    failReceiptAckOnce = false
    private nextSequence = 1

    async enqueueOutbound(input: {
        peerFingerprint: string
        deliveryId: string
        opIds: readonly string[]
        payload: readonly SyncEnvelope[]
    }): Promise<void> {
        if (this.failEnqueue) throw new SyncTransportError('E_SYNC_TRANSPORT', 'offline', true)
        const existing = this.deliveries.find(item => item.deliveryId === input.deliveryId)
        if (existing === undefined) this.deliveries.push(structuredClone(input))
    }

    remoteAcknowledge(deliveryId: string): void {
        const index = this.deliveries.findIndex(item => item.deliveryId === deliveryId)
        const delivery = this.deliveries[index]
        if (delivery === undefined) throw new Error('delivery missing')
        this.deliveries.splice(index, 1)
        this.receipts.push({
            peerFingerprint: delivery.peerFingerprint,
            deliveryId: delivery.deliveryId,
            opIds: [...delivery.opIds],
            sequence: this.nextSequence,
        })
        this.nextSequence += 1
    }

    async peekOutboundReceipts(limit: number): Promise<readonly NativeOutboundSyncReceipt[]> {
        return structuredClone(this.receipts.slice(0, limit))
    }

    async acknowledgeOutboundReceipt(receipt: NativeOutboundSyncReceipt): Promise<void> {
        if (this.failReceiptAckOnce) {
            this.failReceiptAckOnce = false
            throw new Error('simulated process interruption')
        }
        const front = this.receipts[0]
        if (front?.deliveryId !== receipt.deliveryId || front.sequence !== receipt.sequence) {
            throw new Error('receipt order mismatch')
        }
        this.receipts.shift()
    }
}

async function addLocalOperation(
    local: ReturnType<typeof repository>,
    opId: string,
    entityId: string,
): Promise<void> {
    await local.applyLocalMutation({
        opId,
        entityType: 'scene.card',
        entityId,
        op: 'upsert',
        deviceId: 'device:desktop',
        userId: 'user:1',
        createdAt: NOW,
        payload: {
            id: entityId,
            name: 'LAN egress',
            scenePrompt: 'quiet harbor',
            orderKey: '0001',
            createdAt: 1,
        },
    })
}

describe('NativeLanEgressCoordinator', () => {
    it('acks the Phase 11 outbox only after a durable remote receipt and survives receipt-ack restart', async () => {
        const local = repository('phase12-native-egress-restart')
        await addLocalOperation(local, 'op:egress:1', 'scene:egress-1')
        const native = new DurableOutboundQueue()
        const coordinator = new NativeLanEgressCoordinator(local, native, FINGERPRINT)

        const first = await coordinator.synchronizeOnce(LATER)
        expect(first).toMatchObject({
            receiptsApplied: 0,
            publish: { enqueued: true, waitingForRemoteAck: true },
        })
        expect(first.publish.deliveryId).toMatch(/^op:[a-f0-9]{64}$/)
        expect(native.deliveries[0]).toMatchObject({
            peerFingerprint: FINGERPRINT,
            opIds: ['op:egress:1'],
        })
        expect(native.deliveries[0]?.payload).toHaveLength(1)
        expect((await local.getOutbox('op:egress:1'))?.state).toBe('in-flight')

        native.remoteAcknowledge(String(first.publish.deliveryId))
        native.failReceiptAckOnce = true
        await expect(coordinator.applyRemoteReceipts({ ackedAt: LATER }))
            .rejects.toThrow('simulated process interruption')
        expect((await local.getOutbox('op:egress:1'))?.state).toBe('acked')
        expect(native.receipts).toHaveLength(1)

        const restarted = new NativeLanEgressCoordinator(local, native, FINGERPRINT)
        await expect(restarted.applyRemoteReceipts({ ackedAt: LATER })).resolves.toBe(1)
        expect(native.receipts).toEqual([])
        expect(await local.getCheckpoint(`lan-egress:${FINGERPRINT}`)).toMatchObject({
            sequence: 1,
            cursor: first.publish.deliveryId,
        })
    })

    it('returns an enqueue failure to a CAS-guarded Phase 11 retry state', async () => {
        const local = repository('phase12-native-egress-retry')
        await addLocalOperation(local, 'op:egress:retry', 'scene:egress-retry')
        const native = new DurableOutboundQueue()
        native.failEnqueue = true

        await expect(new NativeLanEgressCoordinator(local, native, FINGERPRINT).publishNext(LATER))
            .rejects.toMatchObject({ code: 'E_SYNC_TRANSPORT' })
        expect(await local.getOutbox('op:egress:retry')).toMatchObject({
            state: 'retry',
            attemptCount: 1,
            lastFailureCode: 'E_SYNC_TRANSPORT',
        })
        expect(native.deliveries).toEqual([])
    })
})
