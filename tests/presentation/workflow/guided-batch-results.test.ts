import { describe, expect, it } from 'vitest'

import type { GenerationJob } from '@/domain/queue/types'
import { listGuidedBatchResultJobs } from '@/presentation/workflow/guided-batch-results'

function jobs(count: number): GenerationJob[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `job:${index}`,
    })) as GenerationJob[]
}

describe('Guided batch result pagination', () => {
    it('reads only the requested successful-job window and exposes remaining results', async () => {
        const source = jobs(400)
        const limits: number[] = []
        const repository = {
            async listJobs(input: { cursor?: string | null; limit?: number }) {
                const offset = Number(input.cursor ?? 0)
                const limit = input.limit ?? 100
                limits.push(limit)
                const items = source.slice(offset, offset + limit)
                const next = offset + items.length
                return { items, nextCursor: next < source.length ? String(next) : null }
            },
        }

        const first = await listGuidedBatchResultJobs('batch:1', 48, repository)
        expect(first.items).toHaveLength(48)
        expect(first.hasMore).toBe(true)
        expect(limits).toEqual([48])

        limits.length = 0
        const expanded = await listGuidedBatchResultJobs('batch:1', 300, repository)
        expect(expanded.items).toHaveLength(300)
        expect(expanded.hasMore).toBe(true)
        expect(limits).toEqual([250, 50])
    })

    it('stops at the last cursor and rejects an unbounded request', async () => {
        const source = jobs(60)
        const repository = {
            async listJobs(input: { cursor?: string | null; limit?: number }) {
                const offset = Number(input.cursor ?? 0)
                const items = source.slice(offset, offset + (input.limit ?? 100))
                const next = offset + items.length
                return { items, nextCursor: next < source.length ? String(next) : null }
            },
        }

        await expect(listGuidedBatchResultJobs('batch:1', 96, repository)).resolves.toEqual({
            items: source,
            hasMore: false,
        })
        await expect(listGuidedBatchResultJobs('batch:1', 0, repository)).rejects.toThrow(
            'result window must be a positive integer',
        )
    })
})
