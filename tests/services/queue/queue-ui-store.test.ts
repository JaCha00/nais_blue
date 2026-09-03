import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { flushAllPendingWrites, indexedDBStorage } from '@/lib/indexed-db'
import { useQueueStore } from '@/stores/queue-store'

describe('durable queue UI operation identity', () => {
    beforeEach(() => {
        useQueueStore.setState({
            executionAuthority: 'durable',
            selectedBatchId: null,
            pendingEnqueueOperationIds: { main: null, scene: null },
        })
    })

    it('reuses an unacknowledged enqueue identity and rotates it only after commit acknowledgement', () => {
        const first = useQueueStore.getState().beginEnqueueOperation('main')
        expect(useQueueStore.getState().beginEnqueueOperation('main')).toBe(first)

        useQueueStore.getState().completeEnqueueOperation('main', 'different-operation')
        expect(useQueueStore.getState().pendingEnqueueOperationIds.main).toBe(first)

        useQueueStore.getState().completeEnqueueOperation('main', first)
        expect(useQueueStore.getState().pendingEnqueueOperationIds.main).toBeNull()

        const next = useQueueStore.getState().beginEnqueueOperation('main')
        expect(next).not.toBe(first)
        expect(useQueueStore.getState().pendingEnqueueOperationIds.scene).toBeNull()
    })

    it('keeps the legacy authority as an explicit rollback flag', () => {
        useQueueStore.getState().setExecutionAuthority('legacy')
        expect(useQueueStore.getState().executionAuthority).toBe('legacy')
        expect(useQueueStore.getState().pendingEnqueueOperationIds).toEqual({ main: null, scene: null })
    })

    it('rehydrates the exact selected batch after a process restart', async () => {
        useQueueStore.getState().setSelectedBatchId('batch:restored-main')
        await flushAllPendingWrites()
        const persisted = await indexedDBStorage.getItem('nai-blue-queue-ui')
        expect(persisted).not.toBeNull()

        useQueueStore.setState({ selectedBatchId: null })
        await indexedDBStorage.setItem('nai-blue-queue-ui', persisted ?? '')
        await flushAllPendingWrites()
        await useQueueStore.persist.rehydrate()

        expect(useQueueStore.getState().selectedBatchId).toBe('batch:restored-main')
    })
})
