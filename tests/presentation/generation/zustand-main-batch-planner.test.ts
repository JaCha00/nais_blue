import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
    generation: {
        batchCount: 2,
        generate: vi.fn(),
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

    it('exposes the current requested count and forwards ordered captures', async () => {
        runtime.generation.generate.mockImplementation(async options => {
            await options.capturePrepared?.({ id: 'first' })
            await options.capturePrepared?.({ id: 'second' })
        })
        const planner = createZustandMainBatchPlanner()
        const captured: unknown[] = []

        expect(planner.getRequestedCount()).toBe(2)
        await planner.capturePrepared(value => { captured.push(value) })

        expect(captured).toEqual([{ id: 'first' }, { id: 'second' }])
        expect(runtime.generation.generate).toHaveBeenCalledOnce()
    })
})
