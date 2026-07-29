import { describe, expect, it, vi } from 'vitest'

import {
    planMainBatch,
    type MainBatchPlannerPort,
} from '@/application/generation/plan-main-batch'

function plannerFor<T>(requestedCount: number, prepared: readonly T[]): MainBatchPlannerPort<T> {
    return {
        getRequestedCount: () => requestedCount,
        prepareBatch: async () => prepared,
    }
}

describe('PlanMainBatch', () => {
    it('materializes captures in deterministic ordinal order', async () => {
        const materialize = vi.fn(async (value: string, ordinal: number) => `${ordinal}:${value}`)

        const result = await planMainBatch({
            planner: plannerFor(2, ['first', 'second']),
            materialize,
        })

        expect(result).toEqual({
            requestedCount: 2,
            items: ['0:first', '1:second'],
        })
        expect(materialize.mock.calls).toEqual([
            ['first', 0],
            ['second', 1],
        ])
        expect(Object.isFrozen(result)).toBe(true)
        expect(Object.isFrozen(result?.items)).toBe(true)
    })

    it('rejects an incomplete capture instead of persisting a partial batch', async () => {
        const materialize = vi.fn((value: string) => value)
        const result = await planMainBatch({
            planner: plannerFor(2, ['only']),
            materialize,
        })

        expect(result).toBeNull()
        expect(materialize).not.toHaveBeenCalled()
    })

    it('rejects an invalid requested count without invoking the legacy planner', async () => {
        const prepareBatch = vi.fn(async () => [] as const)

        const result = await planMainBatch({
            planner: { getRequestedCount: () => 0, prepareBatch },
            materialize: (value: unknown) => value,
        })

        expect(result).toBeNull()
        expect(prepareBatch).not.toHaveBeenCalled()
    })
})
