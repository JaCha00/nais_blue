import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
    generation: {
        batchCount: 2,
        prepareMainBatch: vi.fn(),
    },
}))

vi.mock('@/stores/generation-store', () => ({
    useGenerationStore: {
        getState: () => runtime.generation,
    },
}))

import { createZustandMainBatchPlanner } from '@/presentation/generation/zustand-main-batch-planner'

describe('Zustand Main batch Planner adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        runtime.generation.batchCount = 2
    })

    it('exposes the current requested count and returns the prepared batch', async () => {
        runtime.generation.prepareMainBatch.mockResolvedValue([{ id: 'first' }, { id: 'second' }])
        const planner = createZustandMainBatchPlanner()

        expect(planner.getRequestedCount()).toBe(2)
        await expect(planner.prepareBatch()).resolves.toEqual([{ id: 'first' }, { id: 'second' }])

        expect(runtime.generation.prepareMainBatch).toHaveBeenCalledOnce()
    })
})
