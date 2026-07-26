import { describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import type { GenerationJob } from '@/domain/queue/types'
import { createStyleRenderBudget } from '@/domain/style-lab'
import { IndexedDbStyleLabRepository } from '@/services/style-lab/indexeddb-style-lab-repository'
import {
    reconcileStyleLabRenderReservations,
    styleLabRenderIdempotencyKey,
} from '@/services/style-lab/style-lab-queue-adapter'

function memoryStorage(): StateStorage {
    const values = new Map<string, string>()
    return {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value) },
        removeItem: async key => { values.delete(key) },
    }
}

describe('Style-Lab durable Queue adapter', () => {
    it('keys work by render, context, seed, and output policy', () => {
        const base = {
            renderHash: 'render-a', contextId: 'context-a', seed: 7,
            outputPolicy: { format: 'png', directory: 'a' },
        }
        expect(styleLabRenderIdempotencyKey(base)).toBe(styleLabRenderIdempotencyKey({ ...base }))
        expect(styleLabRenderIdempotencyKey(base)).not.toBe(styleLabRenderIdempotencyKey({
            ...base, seed: 8,
        }))
        expect(styleLabRenderIdempotencyKey(base)).not.toBe(styleLabRenderIdempotencyKey({
            ...base, outputPolicy: { format: 'webp', directory: 'a' },
        }))
    })

    it('releases failed work and spends recovered successful work exactly once', async () => {
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'queue-recovery-budget')
        await repository.putRenderBudget(createStyleRenderBudget({ id: 'budget-a', limit: 2, createdAt: 1 }))
        const failed = await repository.reserveRenderBudget({
            budgetId: 'budget-a', units: 1, idempotencyKey: 'failed', createdAt: 2,
        })
        const succeeded = await repository.reserveRenderBudget({
            budgetId: 'budget-a', units: 1, idempotencyKey: 'succeeded', createdAt: 2,
        })
        await repository.bindRenderReservationJob(failed!.id, 'job-failed')
        await repository.bindRenderReservationJob(succeeded!.id, 'job-succeeded')
        const states = new Map([['job-failed', 'failed'], ['job-succeeded', 'succeeded']])
        const queueRepository = {
            getJob: async (id: string) => ({ state: states.get(id) }) as GenerationJob,
        }

        expect(await reconcileStyleLabRenderReservations({
            styleRepository: repository, queueRepository, now: 10,
        })).toEqual({ spent: 1, released: 1 })
        expect(await repository.getRenderBudget('budget-a')).toMatchObject({ reserved: 0, spent: 1 })
        expect(await reconcileStyleLabRenderReservations({
            styleRepository: repository, queueRepository, now: 11,
        })).toEqual({ spent: 0, released: 0 })
    })
})
