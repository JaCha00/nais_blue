import { describe, expect, it, vi } from 'vitest'

import {
    getGenerationRun,
    type GenerationRunReadPort,
} from '@/application/generation/get-generation-run'

describe('getGenerationRun', () => {
    it('reads existing authority facts through its port and derives the projection', async () => {
        const readGenerationRunFacts = vi.fn<GenerationRunReadPort['readGenerationRunFacts']>(async runId => ({
            batchId: runId,
            queueState: 'active',
            jobs: [{
                jobId: 'job-1',
                queueState: 'succeeded',
                interpretation: {
                    state: 'succeeded',
                    source: 'queue-snapshot',
                    referenceId: 'plan-1',
                    observedAt: '2026-09-03T00:00:00.000Z',
                    kind: 'direct',
                },
                storage: {
                    state: 'succeeded',
                    source: 'artifact-record',
                    referenceId: 'artifact-1',
                    observedAt: '2026-09-03T00:01:00.000Z',
                    kind: 'direct',
                },
                release: { policy: 'not-required' },
                acceptance: { required: false },
            }],
        }))

        const result = await getGenerationRun({ readGenerationRunFacts }, 'batch-1')

        expect(readGenerationRunFacts).toHaveBeenCalledOnce()
        expect(readGenerationRunFacts).toHaveBeenCalledWith('batch-1')
        expect(result?.runId).toBe('batch-1')
        expect(result?.overall).toBe('delivered')
    })

    it('returns null when the durable batch does not exist', async () => {
        const readGenerationRunFacts = vi.fn(async () => null)

        await expect(getGenerationRun({ readGenerationRunFacts }, 'missing')).resolves.toBeNull()
    })
})
