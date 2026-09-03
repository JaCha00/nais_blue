import { describe, expect, it } from 'vitest'

import {
    deriveGenerationFulfillment,
    type GenerationFulfillmentFacts,
    type GenerationFulfillmentJobFacts,
    type ObservedTechnicalFact,
} from '@/application/generation/generation-fulfillment'

const observedAt = '2026-09-03T00:00:00.000Z'

function fact(
    state: ObservedTechnicalFact['state'],
    source: string,
    kind: ObservedTechnicalFact['kind'] = 'direct',
): ObservedTechnicalFact {
    return { state, source, referenceId: `${source}-1`, observedAt, kind }
}

function job(overrides: Partial<GenerationFulfillmentJobFacts> = {}): GenerationFulfillmentJobFacts {
    return {
        jobId: 'job-1',
        queueState: 'succeeded',
        interpretation: fact('succeeded', 'queue-snapshot'),
        storage: fact('succeeded', 'output-writer'),
        release: { policy: 'not-required' },
        acceptance: { required: false },
        ...overrides,
    }
}

function run(
    jobFacts: GenerationFulfillmentJobFacts,
    overrides: Partial<GenerationFulfillmentFacts> = {},
) {
    return deriveGenerationFulfillment({
        batchId: 'batch-1',
        queueState: 'active',
        jobs: [jobFacts],
        ...overrides,
    })
}

describe('deriveGenerationFulfillment matrix', () => {
    it('keeps an unstarted required release in the planned state', () => {
        const result = run(job({
            queueState: 'queued',
            storage: fact('pending', 'queue-job', 'derived'),
            release: { policy: 'required' },
        }))

        expect(result.overall).toBe('planned')
    })

    it('keeps a running Queue state separate from fulfillment stages', () => {
        const result = run(job({
            queueState: 'running',
            interpretation: fact('succeeded', 'queue-snapshot'),
            storage: fact('pending', 'output-writer'),
        }))

        expect(result.queue).toEqual({ batchId: 'batch-1', state: 'active' })
        expect(result.overall).toBe('running')
        expect(result.storage.state).toBe('pending')
    })

    it('does not hide a failed sibling behind another running Queue job', () => {
        const result = deriveGenerationFulfillment({
            batchId: 'batch-1',
            queueState: 'active',
            jobs: [
                job({ jobId: 'job-running', queueState: 'running', storage: fact('pending', 'output-writer') }),
                job({ jobId: 'job-failed', queueState: 'failed', storage: fact('failed', 'output-writer') }),
            ],
        })

        expect(result.overall).toBe('needs-attention')
    })

    it('reports an unknown Provider dispatch as uncertain and needing attention', () => {
        const result = run(job({
            provider: fact('uncertain', 'provider-dispatch'),
            storage: fact('pending', 'output-writer'),
        }))

        expect(result.provider.state).toBe('uncertain')
        expect(result.overall).toBe('needs-attention')
    })

    it('preserves Provider success when the spooled result later fails local storage', () => {
        const result = run(job({
            provider: fact('succeeded', 'provider-spool'),
            storage: fact('failed', 'output-writer'),
        }))

        expect(result.provider.state).toBe('succeeded')
        expect(result.storage.state).toBe('failed')
        expect(result.overall).toBe('needs-attention')
    })

    it('reports best-effort R2 failure as partial after local success', () => {
        const result = run(job({
            release: { policy: 'best-effort', fact: fact('failed', 'r2-upload-job') },
        }))

        expect(result.release.state).toBe('failed')
        expect(result.overall).toBe('partial')
    })

    it('reports required R2 failure as needing attention', () => {
        const result = run(job({
            release: { policy: 'required', fact: fact('failed', 'r2-upload-job') },
        }))

        expect(result.overall).toBe('needs-attention')
    })

    it('keeps a pending release in the running state', () => {
        const result = run(job({
            release: { policy: 'best-effort', fact: fact('pending', 'r2-upload-job') },
        }))

        expect(result.overall).toBe('running')
    })

    it('does not treat required but unevaluated acceptance as delivered', () => {
        const result = run(job({ acceptance: { required: true } }))

        expect(result.acceptance.state).toBe('not-evaluated')
        expect(result.overall).toBe('needs-attention')
    })

    it('waits for a running technical workflow before requiring acceptance', () => {
        const result = run(job({
            queueState: 'running',
            storage: fact('pending', 'output-writer'),
            acceptance: { required: true },
        }))

        expect(result.overall).toBe('running')
    })

    it('delivers a local-only result without acceptance', () => {
        const result = run(job())

        expect(result.provider).toEqual({
            state: 'succeeded',
            evidence: [{
                source: 'output-writer',
                referenceId: 'output-writer-1',
                observedAt,
                kind: 'derived',
            }],
        })
        expect(result.release.state).toBe('not-required')
        expect(result.acceptance.state).toBe('not-required')
        expect(result.overall).toBe('delivered')
    })

    it('reports a rubric rejection after all technical stages succeed', () => {
        const result = run(job({
            release: { policy: 'required', fact: fact('succeeded', 'r2-manifest') },
            acceptance: {
                required: true,
                assessment: {
                    state: 'rejected',
                    assessmentId: 'assessment-1',
                    acceptedArtifactIds: [],
                },
            },
        }), { requiredAcceptedCount: 1 })

        expect(result.acceptance).toEqual({
            state: 'rejected',
            assessmentIds: ['assessment-1'],
            acceptedArtifactIds: [],
            requiredAcceptedCount: 1,
        })
        expect(result.overall).toBe('rejected')
    })

    it('marks missing direct evidence unavailable without inferring success from Queue', () => {
        const result = run(job({ interpretation: undefined, storage: undefined }))

        expect(result.interpretation).toEqual({ state: 'unavailable', evidence: [] })
        expect(result.provider).toEqual({ state: 'unavailable', evidence: [] })
        expect(result.storage).toEqual({ state: 'unavailable', evidence: [] })
        expect(result.overall).toBe('needs-attention')
    })
})

describe('Generation fulfillment projection safety', () => {
    it('projects every job while exposing only safe stage evidence fields', () => {
        const unsafeFact = {
            ...fact('succeeded', 'artifact-record'),
            prompt: 'private prompt',
            snapshot: { secret: 'snapshot secret' },
            checksum: 'sha256:private',
            path: 'C:\\private\\image.png',
            remoteKey: 'private/image.png',
            bytes: [1, 2, 3],
        } as ObservedTechnicalFact
        const result = deriveGenerationFulfillment({
            batchId: 'batch-1',
            queueState: 'active',
            jobs: [
                job({ jobId: 'job-1', storage: unsafeFact }),
                job({ jobId: 'job-2' }),
            ],
        })

        expect(result.jobs.map(item => item.jobId)).toEqual(['job-1', 'job-2'])
        expect(result.jobs[0]?.storage.evidence[0]).toEqual({
            source: 'artifact-record',
            referenceId: 'artifact-record-1',
            observedAt,
            kind: 'direct',
        })
        expect(JSON.stringify(result)).not.toContain('private prompt')
        expect(JSON.stringify(result)).not.toContain('snapshot secret')
        expect(JSON.stringify(result)).not.toContain('sha256:private')
        expect(JSON.stringify(result)).not.toContain('C:\\\\private')
        expect(JSON.stringify(result)).not.toContain('private/image.png')
        expect(JSON.stringify(result)).not.toContain('[1,2,3]')
    })
})
