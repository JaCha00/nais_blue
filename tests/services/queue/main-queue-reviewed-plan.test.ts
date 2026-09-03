import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    planGeneration,
    type PlanGenerationDependencies,
} from '@/application/generation/plan-generation'
import type {
    GenerationPlan,
    GenerationExecutionPolicySnapshot,
    PlanGenerationInput,
    PreparedGenerationJobDraft,
} from '@/application/generation/generation-plan-contract'
import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import { CURRENT_MAIN_QUEUE_POLICY } from '@/domain/queue/types'
import {
    createSingleImageDraft,
    reviseSingleImageDraft,
    type WorkflowDraft,
} from '@/domain/workflow/single-image-draft'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'

const runtime = vi.hoisted(() => ({
    begin: vi.fn(() => 'operation:reviewed'),
    complete: vi.fn(),
    repository: vi.fn(),
    createBatchAndEnqueue: vi.fn(),
    materializer: vi.fn(() => ({})),
    dehydrate: vi.fn(async () => ({
        parameters: { generationParams: {}, resourceBindings: [], resourceArrayLengths: {} },
        records: [],
        resources: [],
    })),
    encode: vi.fn((prepared: PreparedMainGeneration) => ({
        snapshot: { seed: prepared.params.seed },
        compositionPlanHash: null,
    })),
    compatibility: vi.fn(() => ({ status: 'supported' })),
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
    getRuntimeQueueRepository: runtime.repository,
}))

vi.mock('@/services/queue/queue-resource-materializer', () => ({
    getRuntimeQueueResourceMaterializer: runtime.materializer,
    dehydrateGenerationParams: runtime.dehydrate,
}))

vi.mock('@/services/queue/main-job-snapshot-codec', () => ({
    encodeMainJobSnapshot: runtime.encode,
}))

vi.mock('@/services/nai/compatibility', () => ({
    CURRENT_NAI_PAYLOAD_BUILDER_REVISION: 'test-revision',
    queryNaiGenerationCompatibility: runtime.compatibility,
}))

import { enqueueReviewedMainPlan } from '@/services/queue/main-queue-adapter'

const source = { kind: 'workflow-draft', draftId: 'draft-reviewed', expectedRevision: 1 } as const

function workflowDraft(credentialPolicy: WorkflowDraft['payload']['credentialPolicy'] = { kind: 'auto' }) {
    const created = createSingleImageDraft({
        id: source.draftId,
        now: '2026-09-03T00:00:00.000Z',
        seed: 1,
    })
    return reviseSingleImageDraft(created, {
        updatedAt: '2026-09-03T00:00:01.000Z',
        payload: {
            ...created.payload,
            prompt: { positive: 'reviewed prompt', negative: 'lowres' },
            credentialPolicy,
            output: { ...created.payload.output, collisionPolicy: 'unique' },
        },
    })
}

function dependencies(
    draft = workflowDraft(),
    randomSeed = vi.fn(() => 17),
    prompt = 'reviewed prompt',
): PlanGenerationDependencies<PreparedMainGeneration> {
    return {
        drafts: { get: vi.fn(async () => draft) },
        planner: {
            prepare: vi.fn(async ({ materializedSeeds }) => materializedSeeds.map(seed => {
                const prepared = {
                    params: {
                        prompt,
                        negativePrompt: 'lowres',
                        model: 'nai-diffusion-4-5-full',
                        width: 832,
                        height: 1_216,
                        steps: 28,
                        seed,
                    },
                    streaming: false,
                } as PreparedMainGeneration
                return {
                    semantic: {
                        prompt,
                        negativePrompt: 'lowres',
                        model: prepared.params.model,
                        width: prepared.params.width,
                        height: prepared.params.height,
                        steps: prepared.params.steps,
                        seed,
                        generationParameters: {},
                        resourceDigest: `sha256:${'a'.repeat(64)}`,
                    },
                    preparationDigest: `sha256:${'b'.repeat(64)}`,
                    destination: {
                        generationFolderId: null,
                        generationFolderPathHash: null,
                        outputPolicyId: 'output:reviewed',
                        expectedBaseName: 'image',
                        extension: 'png',
                        collisionPolicy: 'fail',
                        deliveryRequired: false,
                    },
                    prepared,
                } satisfies PreparedGenerationJobDraft<PreparedMainGeneration>
            })),
        },
        executionPolicy: {
            failurePolicy: 'continue',
            retryPolicyId: CURRENT_MAIN_QUEUE_POLICY.retryPolicyId,
            maxAttempts: 3,
            maxConcurrency: CURRENT_MAIN_QUEUE_POLICY.maxConcurrency,
            pricingBasis: 'all-active-opus',
        },
        estimateAnlas: () => 0,
        resolveCompatibility: () => ({
            compatibilityProfileId: 'nai:test',
            status: 'captured-pass',
        }),
        randomSeed,
    }
}

function withExecutionPolicy(
    deps: PlanGenerationDependencies<PreparedMainGeneration>,
    overrides: Partial<PlanGenerationDependencies<PreparedMainGeneration>['executionPolicy']>,
): PlanGenerationDependencies<PreparedMainGeneration> {
    return {
        ...deps,
        executionPolicy: {
            ...deps.executionPolicy,
            ...overrides,
        } satisfies Omit<GenerationExecutionPolicySnapshot, 'credentialDispatch' | 'metadataMode'>,
    }
}

function costConsent(pricingBasis: 'all-active-opus' | 'paid' = 'all-active-opus') {
    return createAnlasCostConsentSnapshot({
        pricingBasis,
        estimatedAnlas: 0,
        maxAnlas: 0,
        estimatedAt: '2026-09-03T00:00:02.000Z',
        approvedAt: '2026-09-03T00:00:03.000Z',
    })
}

async function reviewedPlan(
    input: PlanGenerationInput,
    deps: PlanGenerationDependencies<PreparedMainGeneration>,
): Promise<GenerationPlan<PreparedMainGeneration>> {
    const result = await planGeneration(input, deps)
    expect(['ready', 'needs_input']).toContain(result.status)
    if (result.status !== 'ready' && result.status !== 'needs_input') {
        throw new Error(`Expected a reviewable plan, received ${result.status}`)
    }
    return result.plan
}

function expectNoQueueSideEffects() {
    expect(runtime.begin).not.toHaveBeenCalled()
    expect(runtime.complete).not.toHaveBeenCalled()
    expect(runtime.materializer).not.toHaveBeenCalled()
    expect(runtime.dehydrate).not.toHaveBeenCalled()
    expect(runtime.encode).not.toHaveBeenCalled()
    expect(runtime.repository).not.toHaveBeenCalled()
    expect(runtime.createBatchAndEnqueue).not.toHaveBeenCalled()
}

describe('reviewed Main plan Queue bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        runtime.repository.mockReturnValue({ createBatchAndEnqueue: runtime.createBatchAndEnqueue })
        runtime.createBatchAndEnqueue.mockResolvedValue({ batch: {}, jobs: [] })
    })

    it('replays saved seeds and enqueues the replayed jobs under the stable plan identity', async () => {
        const randomSeed = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(20)
        const input: PlanGenerationInput = {
            source,
            count: 2,
            seedPolicy: { kind: 'random' },
            budget: { maxImages: 2, maxAnlas: 0 },
        }
        const reviewed = await reviewedPlan(input, dependencies(workflowDraft(), randomSeed))
        randomSeed.mockClear()

        const result = await enqueueReviewedMainPlan({
            reviewed,
            input: { source, count: 2, budget: input.budget },
            dependencies: dependencies(workflowDraft(), randomSeed),
            submissionPolicy: { kind: 'guided', costConsent: costConsent() },
        })

        expect(result.status).toBe('enqueued')
        expect(randomSeed).not.toHaveBeenCalled()
        expect(runtime.encode.mock.calls.map(([prepared]) => prepared.params.seed)).toEqual([10, 20])
        expect(runtime.encode).toHaveBeenCalledWith(expect.anything(), expect.anything(), costConsent())
        expect(runtime.createBatchAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({
            batch: expect.objectContaining({
                id: `main-batch-${reviewed.planId}`,
                idempotencyKey: `main-enqueue-${reviewed.planId}`,
            }),
            jobs: [
                expect.objectContaining({ id: `main-job-${reviewed.planId}-0` }),
                expect.objectContaining({ id: `main-job-${reviewed.planId}-1` }),
            ],
        }))
    })

    it('returns a replay mismatch before any Queue-side operation', async () => {
        const input: PlanGenerationInput = {
            source,
            count: 1,
            seedPolicy: { kind: 'fixed', seed: 7 },
            budget: { maxImages: 1, maxAnlas: 0 },
        }
        const reviewed = await reviewedPlan(input, dependencies())

        const result = await enqueueReviewedMainPlan({
            reviewed,
            input: { source, count: 1, budget: input.budget },
            dependencies: dependencies(workflowDraft(), vi.fn(() => 999), 'changed prompt'),
            submissionPolicy: { kind: 'guided', costConsent: costConsent() },
        })

        expect(result).toMatchObject({ status: 'conflict', mismatch: { fieldPath: 'jobs[0].semantic' } })
        expectNoQueueSideEffects()
    })

    it('returns an unmet budget requirement before any Queue-side operation', async () => {
        const input: PlanGenerationInput = {
            source,
            count: 1,
            seedPolicy: { kind: 'fixed', seed: 7 },
            budget: { maxImages: 0, maxAnlas: 0 },
        }
        const reviewed = await reviewedPlan(input, dependencies())

        const result = await enqueueReviewedMainPlan({
            reviewed,
            input: { source, count: 1, budget: input.budget },
            dependencies: dependencies(),
            submissionPolicy: { kind: 'guided', costConsent: costConsent() },
        })

        expect(result).toMatchObject({ status: 'needs_input', requirements: [{ fieldPath: 'budget.maxImages' }] })
        expectNoQueueSideEffects()
    })

    it('rejects pinned credential affinity before any Queue-side operation', async () => {
        const draft = workflowDraft({ kind: 'pinned', credentialId: 'credential-1' })
        const input: PlanGenerationInput = {
            source,
            count: 1,
            seedPolicy: { kind: 'fixed', seed: 7 },
            budget: { maxImages: 1, maxAnlas: 0 },
        }
        const reviewed = await reviewedPlan(input, dependencies(draft))

        const result = await enqueueReviewedMainPlan({
            reviewed,
            input: { source, count: 1, budget: input.budget },
            dependencies: dependencies(draft),
            submissionPolicy: { kind: 'guided', costConsent: costConsent() },
        })

        expect(result).toMatchObject({
            status: 'unsupported',
            capability: 'unsupported-pinned-credential-affinity',
        })
        expectNoQueueSideEffects()
    })

    it('rejects invalid replay input and mismatched cost consent before Queue work', async () => {
        const input: PlanGenerationInput = {
            source,
            count: 1,
            seedPolicy: { kind: 'fixed', seed: 7 },
            budget: { maxImages: 1, maxAnlas: 0 },
        }
        const reviewed = await reviewedPlan(input, dependencies())

        const invalid = await enqueueReviewedMainPlan({
            reviewed,
            input: { source, count: 0, budget: input.budget },
            dependencies: dependencies(),
            submissionPolicy: { kind: 'guided', costConsent: costConsent() },
        })
        expect(invalid).toMatchObject({ status: 'invalid', issues: [{ fieldPath: 'count' }] })
        expectNoQueueSideEffects()

        const mismatchedConsent = await enqueueReviewedMainPlan({
            reviewed,
            input: { source, count: 1, budget: input.budget },
            dependencies: dependencies(),
            submissionPolicy: { kind: 'guided', costConsent: costConsent('paid') },
        })
        expect(mismatchedConsent).toMatchObject({
            status: 'invalid',
            issues: [{ code: 'cost-consent-plan-mismatch' }],
        })
        expectNoQueueSideEffects()
    })

    it('rejects an unsupported concurrency policy before Queue work', async () => {
        const input: PlanGenerationInput = {
            source,
            count: 1,
            seedPolicy: { kind: 'fixed', seed: 7 },
            budget: { maxImages: 1, maxAnlas: 0 },
        }
        const deps = withExecutionPolicy(dependencies(), { maxConcurrency: 1 })
        const reviewed = await reviewedPlan(input, deps)

        const result = await enqueueReviewedMainPlan({
            reviewed,
            input: { source, count: 1, budget: input.budget },
            dependencies: withExecutionPolicy(dependencies(), { maxConcurrency: 1 }),
            submissionPolicy: { kind: 'guided', costConsent: costConsent() },
        })

        expect(result).toMatchObject({
            status: 'unsupported',
            capability: 'unsupported-main-queue-concurrency',
        })
        expectNoQueueSideEffects()
    })

    it('persists the reviewed failure and retry limits', async () => {
        const input: PlanGenerationInput = {
            source,
            count: 1,
            seedPolicy: { kind: 'fixed', seed: 7 },
            budget: { maxImages: 1, maxAnlas: 0 },
        }
        const deps = withExecutionPolicy(dependencies(), { failurePolicy: 'stop', maxAttempts: 5 })
        const reviewed = await reviewedPlan(input, deps)

        const result = await enqueueReviewedMainPlan({
            reviewed,
            input: { source, count: 1, budget: input.budget },
            dependencies: withExecutionPolicy(dependencies(), { failurePolicy: 'stop', maxAttempts: 5 }),
            submissionPolicy: { kind: 'guided', costConsent: costConsent() },
        })

        expect(result.status).toBe('enqueued')
        expect(runtime.createBatchAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({
            batch: expect.objectContaining({ failurePolicy: 'stop-on-first-error' }),
            jobs: [expect.objectContaining({ maxAttempts: 5 })],
        }))
    })
})
