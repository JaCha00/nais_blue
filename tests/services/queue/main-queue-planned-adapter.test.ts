import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MainBatchPlannerPort } from '@/application/generation/plan-main-batch'
import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'

const runtime = vi.hoisted(() => ({
    begin: vi.fn(() => 'operation:1'),
    complete: vi.fn(),
    createBatchAndEnqueue: vi.fn(),
    dehydrate: vi.fn(async () => ({
        parameters: { generationParams: {}, resourceBindings: [], resourceArrayLengths: {} },
        records: [],
        resources: [],
    })),
    encode: vi.fn(() => ({
        snapshot: { schemaVersion: 1, prompt: {}, parameters: {}, outputPolicy: {}, resources: [] },
        compositionPlanHash: null,
    })),
}))

vi.mock('@/services/queue/main-queue-runtime-dependencies', () => ({
    getRuntimeMainQueueDependencies: () => ({
        planner: null,
        presentation: {
            beginEnqueueOperation: runtime.begin,
            completeEnqueueOperation: runtime.complete,
        },
    }),
}))

vi.mock('@/services/queue/indexeddb-queue-repository', () => ({
    getRuntimeQueueRepository: () => ({ createBatchAndEnqueue: runtime.createBatchAndEnqueue }),
}))

vi.mock('@/services/queue/queue-resource-materializer', () => ({
    getRuntimeQueueResourceMaterializer: () => ({}),
    dehydrateGenerationParams: runtime.dehydrate,
}))

vi.mock('@/services/queue/main-job-snapshot-codec', () => ({
    encodeMainJobSnapshot: runtime.encode,
}))

import { enqueuePlannedMainBatch } from '@/services/queue/main-queue-adapter'

const prepared = {
    params: {
        width: 832,
        height: 1_216,
        steps: 28,
    },
} as PreparedMainGeneration

function planner(): MainBatchPlannerPort<PreparedMainGeneration> {
    return {
        getRequestedCount: () => 1,
        prepareBatch: async () => [prepared],
    }
}

function freeCostConsent() {
    return createAnlasCostConsentSnapshot({
        pricingBasis: 'all-active-opus',
        estimatedAnlas: 0,
        maxAnlas: 0,
        estimatedAt: '2026-08-08T12:00:00.000Z',
        approvedAt: '2026-08-08T12:00:01.000Z',
    })
}

describe('planned Main queue adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        runtime.createBatchAndEnqueue.mockResolvedValue({ batch: {}, jobs: [] })
    })

    it('reuses the Main codec/materializer and assigns stable Guided identities', async () => {
        await enqueuePlannedMainBatch({
            planner: planner(),
            submissionPolicy: { kind: 'guided', costConsent: freeCostConsent() },
            idempotencyScope: 'guided:draft-1:revision-2',
        })

        expect(runtime.dehydrate).toHaveBeenCalledOnce()
        expect(runtime.encode).toHaveBeenCalledOnce()
        expect(runtime.createBatchAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({
            batch: expect.objectContaining({
                id: 'main-batch-guided:draft-1:revision-2',
                idempotencyKey: 'main-enqueue-guided:draft-1:revision-2',
            }),
            jobs: [expect.objectContaining({
                id: 'main-job-guided:draft-1:revision-2-0',
                idempotencyKey: 'main-enqueue-guided:draft-1:revision-2-0',
            })],
        }))
        expect(runtime.complete).toHaveBeenCalledWith('operation:1')
    })

    it('always completes the presentation operation when planning fails', async () => {
        const failed: MainBatchPlannerPort<PreparedMainGeneration> = {
            getRequestedCount: () => 1,
            prepareBatch: async () => { throw new Error('planner failed') },
        }

        await expect(enqueuePlannedMainBatch({
            planner: failed,
            submissionPolicy: { kind: 'guided', costConsent: freeCostConsent() },
        })).rejects.toThrow('planner failed')
        expect(runtime.createBatchAndEnqueue).not.toHaveBeenCalled()
        expect(runtime.complete).toHaveBeenCalledWith('operation:1')
    })

    it('persists a verified Guided max-Anlas consent with the immutable snapshot', async () => {
        const costConsent = freeCostConsent()

        await enqueuePlannedMainBatch({
            planner: planner(),
            submissionPolicy: { kind: 'guided', costConsent },
        })

        expect(runtime.encode).toHaveBeenCalledWith(prepared, expect.anything(), costConsent)
        expect(runtime.createBatchAndEnqueue).toHaveBeenCalledOnce()
    })

    it('revalidates the paid production estimate before materializing resources', async () => {
        const costConsent = createAnlasCostConsentSnapshot({
            pricingBasis: 'paid',
            estimatedAnlas: 20,
            maxAnlas: 20,
            estimatedAt: '2026-08-08T12:00:00.000Z',
            approvedAt: '2026-08-08T12:00:01.000Z',
        })

        await enqueuePlannedMainBatch({
            planner: planner(),
            submissionPolicy: { kind: 'guided', costConsent },
        })

        expect(runtime.dehydrate).toHaveBeenCalledOnce()
        expect(runtime.encode).toHaveBeenCalledWith(prepared, expect.anything(), costConsent)
        expect(runtime.createBatchAndEnqueue).toHaveBeenCalledOnce()
    })

    it('prices queued jobs as separate one-sample NovelAI requests', async () => {
        const twoRequests: MainBatchPlannerPort<PreparedMainGeneration> = {
            getRequestedCount: () => 2,
            prepareBatch: async () => [prepared, prepared],
        }

        await enqueuePlannedMainBatch({
            planner: twoRequests,
            submissionPolicy: { kind: 'guided', costConsent: freeCostConsent() },
        })

        expect(runtime.dehydrate).toHaveBeenCalledTimes(2)
        expect(runtime.createBatchAndEnqueue).toHaveBeenCalledOnce()
    })

    it('rejects missing or stale Guided consent before resource materialization', async () => {
        await expect(enqueuePlannedMainBatch({
            planner: planner(),
            submissionPolicy: { kind: 'guided' } as never,
        })).rejects.toMatchObject({ code: 'E_ANLAS_CONSENT_REQUIRED' })

        const staleConsent = createAnlasCostConsentSnapshot({
            pricingBasis: 'paid',
            estimatedAnlas: 10,
            maxAnlas: 10,
            estimatedAt: '2026-08-08T12:00:00.000Z',
            approvedAt: '2026-08-08T12:00:01.000Z',
        })
        await expect(enqueuePlannedMainBatch({
            planner: planner(),
            submissionPolicy: { kind: 'guided', costConsent: staleConsent },
        })).rejects.toMatchObject({ code: 'E_ANLAS_ESTIMATE_CHANGED' })

        const lowCeiling = {
            ...freeCostConsent(),
            pricingBasis: 'paid' as const,
            estimatedAnlas: 20,
            maxAnlas: 19,
        }
        await expect(enqueuePlannedMainBatch({
            planner: planner(),
            submissionPolicy: { kind: 'guided', costConsent: lowCeiling },
        })).rejects.toMatchObject({ code: 'E_ANLAS_CEILING_EXCEEDED' })

        expect(runtime.dehydrate).not.toHaveBeenCalled()
        expect(runtime.createBatchAndEnqueue).not.toHaveBeenCalled()
        expect(runtime.complete).toHaveBeenCalledTimes(3)
    })
})
