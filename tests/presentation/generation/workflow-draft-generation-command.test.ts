import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
    createInput: vi.fn(),
    createDependencies: vi.fn(),
    plan: vi.fn(),
    createConsent: vi.fn(),
    enqueue: vi.fn(),
    enqueueReviewedMainPlan: vi.fn(),
}))

vi.mock('@/application/generation/enqueue-generation-plan', () => ({
    enqueueGeneration: runtime.enqueue,
}))
vi.mock('@/domain/queue/anlas-cost-consent', () => ({
    createAnlasCostConsentSnapshot: runtime.createConsent,
}))
vi.mock('@/presentation/generation/workflow-draft-main-batch-planner', () => ({
    createWorkflowDraftGenerationInput: runtime.createInput,
    createWorkflowDraftGenerationPlanDependencies: runtime.createDependencies,
    planWorkflowDraftGeneration: runtime.plan,
}))
vi.mock('@/services/queue/main-queue-adapter', () => ({
    enqueueReviewedMainPlan: runtime.enqueueReviewedMainPlan,
}))

import type { GenerationPlan, PlanGenerationInput } from '@/application/generation/generation-plan-contract'
import type { AnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import type { SingleImageDraft } from '@/domain/workflow/single-image-draft'
import { enqueueWorkflowDraftGenerationCommand } from '@/presentation/generation/workflow-draft-generation-command'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'
import type { FragmentLookupRepository } from '@/stores/fragment-store'

const draft = { id: 'draft:1', revision: 7 } as SingleImageDraft
const drafts = { get: vi.fn() }
const fragmentRepository = {} as FragmentLookupRepository
const planInput: PlanGenerationInput = {
    source: { kind: 'workflow-draft', draftId: 'draft:1', expectedRevision: 7 },
    count: 2,
    seedPolicy: { kind: 'random' },
    budget: { maxImages: 2, maxAnlas: 12 },
}
const dependencies = { drafts, fragmentRepository, pricingBasis: 'paid' }
const plan = { estimatedAnlas: 8 } as unknown as GenerationPlan<PreparedMainGeneration>
const costConsent = {
    pricingBasis: 'paid',
    estimatedAnlas: 8,
    maxAnlas: 12,
    estimatedAt: '2026-09-03T00:00:00.000Z',
    approvedAt: '2026-09-03T00:00:00.000Z',
} as AnlasCostConsentSnapshot

function commandInput() {
    return {
        draft,
        maxImages: 2,
        maxAnlas: 12,
        pricingBasis: 'paid' as const,
        approvedAt: '2026-09-03T00:00:00.000Z',
        drafts,
        fragmentRepository,
    }
}

describe('workflow draft generation command', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        runtime.createInput.mockReturnValue(planInput)
        runtime.createDependencies.mockReturnValue(dependencies)
        runtime.createConsent.mockReturnValue(costConsent)
    })

    it('enqueues a ready plan with explicit identity, replay input, and consent', async () => {
        runtime.plan.mockResolvedValue({ status: 'ready', plan, view: {} })
        runtime.enqueue.mockResolvedValue({
            status: 'ready',
            batchId: 'batch:1',
            runId: 'batch:1',
            jobIds: ['job:0', 'job:1'],
        })

        await expect(enqueueWorkflowDraftGenerationCommand(commandInput())).resolves.toEqual({
            status: 'ready',
            batchId: 'batch:1',
            runId: 'batch:1',
            jobIds: ['job:0', 'job:1'],
        })

        expect(runtime.enqueue).toHaveBeenCalledWith({
            reviewedPlan: plan,
            costConsent,
            idempotencyKey: 'guided:draft:1:revision:7',
            actor: { kind: 'user', id: 'guided-ui:user' },
            replanInput: {
                source: planInput.source,
                count: planInput.count,
                budget: planInput.budget,
            },
        }, expect.objectContaining({ replan: dependencies, enqueue: expect.any(Object) }))
        expect(runtime.enqueueReviewedMainPlan).not.toHaveBeenCalled()
    })

    it.each([
        ['conflict', {
            status: 'conflict',
            source: planInput.source,
            currentRevision: 8,
            action: 'reload-workflow-draft',
        }],
        ['needs_input', {
            status: 'needs_input',
            plan,
            view: {},
            requirements: [],
        }],
    ] as const)('does not enqueue when the initial plan is %s', async (_status, result) => {
        runtime.plan.mockResolvedValue(result)

        await expect(enqueueWorkflowDraftGenerationCommand(commandInput())).resolves.toEqual(result)

        expect(runtime.enqueue).not.toHaveBeenCalled()
        expect(runtime.enqueueReviewedMainPlan).not.toHaveBeenCalled()
    })

    it('reduces ready adapter queue jobs to ordered application references', async () => {
        runtime.plan.mockResolvedValue({ status: 'ready', plan, view: {} })
        runtime.enqueueReviewedMainPlan.mockResolvedValue({
            status: 'enqueued',
            queue: {
                batch: { id: 'batch:adapter' },
                jobs: [
                    { id: 'job:0', ordinal: 0 },
                    { id: 'job:1', ordinal: 1 },
                ],
            },
        })
        runtime.enqueue.mockImplementation(async (input, ports) => {
            const result = await ports.enqueue.enqueue({
                plan: input.reviewedPlan,
                costConsent: input.costConsent,
                idempotencyKey: input.idempotencyKey,
                actor: input.actor,
            })
            return result.status === 'ready'
                ? {
                    status: 'ready',
                    batchId: result.batchId,
                    runId: result.batchId,
                    jobIds: result.jobs.map(job => job.id),
                }
                : result
        })

        await expect(enqueueWorkflowDraftGenerationCommand(commandInput())).resolves.toEqual({
            status: 'ready',
            batchId: 'batch:adapter',
            runId: 'batch:adapter',
            jobIds: ['job:0', 'job:1'],
        })
        expect(runtime.enqueueReviewedMainPlan).toHaveBeenCalledWith(expect.objectContaining({
            reviewed: plan,
            input: {
                source: planInput.source,
                count: planInput.count,
                budget: planInput.budget,
            },
            dependencies,
            submissionPolicy: { kind: 'guided', costConsent },
            idempotencyScope: 'guided:draft:1:revision:7',
        }))
    })
})
