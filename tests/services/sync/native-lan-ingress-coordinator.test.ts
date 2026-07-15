import { describe, expect, it } from 'vitest'

import type {
    SyncEnvelope,
    SyncRemoteApplyReceipt,
} from '@/domain/sync'
import { NativeLanIngressCoordinator } from '@/services/sync/native-lan-ingress-coordinator'
import {
    NativeLanQueueAdapter,
    type NativeSyncBindings,
} from '@/services/sync/native-lan-transport-adapter'
import { LATER } from '../../domain/sync/constants'
import { envelope, repository } from '../../domain/sync/fixtures'

const FINGERPRINT = `sha256:${'b'.repeat(64)}`

class DurableQueueBindings implements NativeSyncBindings {
    readonly queue: unknown[]
    readonly acknowledged: string[] = []

    constructor(items: unknown[]) { this.queue = structuredClone(items) }

    isTauri(): boolean { return true }

    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        if (command === 'sync_transport_peek_inbound') {
            const limit = Number((args?.request as { limit: number }).limit)
            return structuredClone(this.queue.slice(0, limit)) as T
        }
        if (command === 'sync_transport_ack_inbound') {
            const requestId = String((args?.request as { requestId: string }).requestId)
            const front = this.queue[0] as { requestId: string } | undefined
            if (front?.requestId !== requestId) throw new Error('ack order mismatch')
            this.queue.shift()
            this.acknowledged.push(requestId)
            return undefined as T
        }
        throw new Error('unexpected command')
    }
}

describe('NativeLanIngressCoordinator', () => {
    it('replays a non-destructive native peek after process restart and acks only after Phase 11 commit', async () => {
        const first = envelope({ opId: 'op:ingress:1', entityId: 'scene:ingress-1' })
        const second = envelope({ opId: 'op:ingress:2', entityId: 'scene:ingress-2' })
        const bindings = new DurableQueueBindings([{
            requestId: 'push:request:1',
            peerFingerprint: FINGERPRINT,
            sequence: 1,
            nonce: 'nonce-safe-0000001',
            payload: [first, second],
        }])
        const durableQueue = new NativeLanQueueAdapter(bindings)
        const local = repository('phase12-native-ingress-restart')
        let failSecond = true
        const ingressRepository = {
            async receiveRemote(value: SyncEnvelope, receivedAt: string): Promise<SyncRemoteApplyReceipt> {
                if (value.opId === second.opId && failSecond) throw new Error('simulated process interruption')
                return local.receiveRemote(value, receivedAt)
            },
        }

        await expect(new NativeLanIngressCoordinator(ingressRepository, durableQueue).processOnce({
            receivedAt: LATER,
        })).rejects.toThrow('simulated process interruption')
        expect(bindings.queue).toHaveLength(1)
        expect(bindings.acknowledged).toEqual([])
        expect(await local.getInbox(first.opId)).not.toBeNull()
        expect(await local.getInbox(second.opId)).toBeNull()

        failSecond = false
        const restarted = new NativeLanIngressCoordinator(ingressRepository, new NativeLanQueueAdapter(bindings))
        await expect(restarted.processOnce({ receivedAt: LATER })).resolves.toEqual({
            nativeItemsAcknowledged: 1,
            envelopesApplied: 2,
            duplicateEnvelopes: 1,
        })
        expect(bindings.queue).toEqual([])
        expect(bindings.acknowledged).toEqual(['push:request:1'])
        expect(await local.getInbox(second.opId)).not.toBeNull()
    })

    it('does not acknowledge when cancellation occurs after peek and before persistence', async () => {
        const selected = envelope({ opId: 'op:ingress:cancel', entityId: 'scene:cancel' })
        const bindings = new DurableQueueBindings([{
            requestId: 'push:request:cancel',
            peerFingerprint: FINGERPRINT,
            sequence: 2,
            nonce: 'nonce-safe-0000002',
            payload: [selected],
        }])
        const controller = new AbortController()
        controller.abort()

        await expect(new NativeLanIngressCoordinator(
            { async receiveRemote() { throw new Error('must not persist') } },
            new NativeLanQueueAdapter(bindings),
        ).processOnce({ receivedAt: LATER, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
        expect(bindings.queue).toHaveLength(1)
        expect(bindings.acknowledged).toEqual([])
    })
})
