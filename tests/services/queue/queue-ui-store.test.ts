import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

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
})
