import { describe, expect, it, vi } from 'vitest'

import { planGeneration } from '@/application/generation/plan-generation'
import type { PlanGenerationInput } from '@/application/generation/generation-plan-contract'
import {
    createBatchImageDraft,
    reviseBatchImageDraft,
} from '@/domain/workflow/single-image-draft'
import {
    createWorkflowDraftGenerationPlanDependencies,
    planWorkflowDraftGeneration,
    WORKFLOW_DRAFT_RETRY_POLICY_ID,
} from '@/presentation/generation/workflow-draft-main-batch-planner'
import type { FragmentLookupRepository } from '@/stores/fragment-store'

const NOW = '2026-09-03T00:00:00.000Z'

function readyDraft() {
    const created = createBatchImageDraft({
        id: 'draft:canonical',
        now: NOW,
        seed: 1,
        batchMode: 'same-settings',
    })
    return reviseBatchImageDraft(created, {
        updatedAt: '2026-09-03T00:00:01.000Z',
        currentNodeId: 'review',
        status: 'review',
        payload: {
            ...created.payload,
            model: 'nai-diffusion-4-5-full',
            prompt: { positive: '1girl, <*wardrobe/outfit>', negative: 'blurry' },
            resolution: { width: 1024, height: 1024 },
            count: 3,
            output: {
                ...created.payload.output,
                directory: 'E:\\private\\nai-output',
                generationFolderId: 'folder:portraits',
                generationFolderPath: 'data:image/png;base64,PRIVATE_PATH_TOKEN',
                collisionPolicy: 'unique',
            },
        },
    })
}

function fragmentRepository(commit = vi.fn(), revision = 4): FragmentLookupRepository {
    return {
        findMetadataByPath: () => undefined,
        loadDefinitionByPath: async path => path === 'wardrobe/outfit'
            ? { id: 'fragment:outfit', path, lines: ['coat', 'dress', 'jacket'] }
            : null,
        getSequenceSnapshot: () => ({ revision, counters: { 'fragment:outfit': 0 } }),
        commitSequenceProposal: commit,
    }
}

const input: PlanGenerationInput = {
    source: {
        kind: 'workflow-draft',
        draftId: 'draft:canonical',
        expectedRevision: 1,
    },
    count: 3,
    seedPolicy: { kind: 'increment', firstSeed: 8 },
    budget: { maxImages: 3, maxAnlas: 100 },
}

describe('Workflow Draft canonical generation adapter', () => {
    it('keeps Guided and direct plans identical, explicit, redacted, and read-only', async () => {
        const draft = readyDraft()
        const commit = vi.fn()
        const options = {
            drafts: { get: vi.fn(async () => draft) },
            fragmentRepository: fragmentRepository(commit),
            pricingBasis: 'all-active-opus' as const,
        }

        const wrapped = await planWorkflowDraftGeneration(input, options)
        const direct = await planGeneration(
            input,
            createWorkflowDraftGenerationPlanDependencies(options),
        )

        expect(wrapped.status).toBe('ready')
        expect(direct.status).toBe('ready')
        if (wrapped.status !== 'ready' || direct.status !== 'ready') return

        expect(wrapped.plan.planHash).toBe(direct.plan.planHash)
        expect(wrapped.plan.materializedSeedTrace.seeds).toEqual([8, 9, 10])
        expect(wrapped.plan.jobs.map(job => job.semantic.seed)).toEqual([8, 9, 10])
        expect(wrapped.plan.jobs.map(job => job.prepared.finalPrompt)).toEqual([
            '1girl, coat',
            '1girl, dress',
            '1girl, jacket',
        ])
        expect(wrapped.plan.executionPolicy).toMatchObject({
            failurePolicy: 'continue',
            retryPolicyId: WORKFLOW_DRAFT_RETRY_POLICY_ID,
            maxAttempts: 3,
            maxConcurrency: 2,
            pricingBasis: 'all-active-opus',
        })
        expect(wrapped.plan.issues).toHaveLength(3)
        expect(wrapped.plan.issues.every(issue => (
            issue.code === 'compatibility-synthetic-only' && issue.severity === 'warning'
        ))).toBe(true)

        const publicView = JSON.stringify(wrapped.view)
        const publicSemantics = JSON.stringify(wrapped.plan.jobs.map(job => job.semantic))
        expect(publicView).not.toContain('E:\\private')
        expect(publicView).not.toContain('data:image')
        expect(publicView).not.toContain('PRIVATE_PATH_TOKEN')
        expect(publicSemantics).not.toContain('data:image')
        expect(publicSemantics).not.toContain('PRIVATE_PATH_TOKEN')
        expect(wrapped.view.jobs[0]?.destination).toMatchObject({
            generationFolderId: 'folder:portraits',
            expectedBaseName: 'NAI_Blue_8',
            collisionPolicy: 'fail',
        })
        expect(wrapped.view.jobs[0]?.destination.generationFolderPathHash).toMatch(/^sha256:/)
        expect(commit).not.toHaveBeenCalled()
    })

    it('keeps provider semantics stable but changes plan identity with the sequence proposal', async () => {
        const draft = readyDraft()
        const planWithRevision = (revision: number) => planWorkflowDraftGeneration(input, {
            drafts: { get: async () => draft },
            fragmentRepository: fragmentRepository(vi.fn(), revision),
            pricingBasis: 'paid',
        })

        const first = await planWithRevision(4)
        const second = await planWithRevision(9)
        expect(first.status).toBe('ready')
        expect(second.status).toBe('ready')
        if (first.status !== 'ready' || second.status !== 'ready') return

        expect(second.plan.semanticPlanHash).toBe(first.plan.semanticPlanHash)
        expect(second.plan.planHash).not.toBe(first.plan.planHash)
        expect(second.plan.jobs[0]?.preparationDigest)
            .not.toBe(first.plan.jobs[0]?.preparationDigest)
    })

    it('plans pinned credentials without exposing tokens or enabling legacy enqueue affinity', async () => {
        const current = readyDraft()
        const pinned = reviseBatchImageDraft(current, {
            updatedAt: '2026-09-03T00:00:02.000Z',
            payload: {
                ...current.payload,
                credentialPolicy: { kind: 'pinned', credentialId: 'credential:stable' },
            },
        })
        const result = await planWorkflowDraftGeneration({
            ...input,
            source: { ...input.source, expectedRevision: pinned.revision },
        }, {
            drafts: { get: async () => pinned },
            fragmentRepository: fragmentRepository(),
            pricingBasis: 'paid',
        })

        expect(result.status).toBe('ready')
        if (result.status === 'ready') {
            expect(result.plan.executionPolicy.credentialDispatch).toEqual({
                kind: 'pinned',
                credentialId: 'credential:stable',
            })
        }
    })

    it('returns missing prompt modules as a structured invalid result', async () => {
        const unavailable: FragmentLookupRepository = {
            findMetadataByPath: () => undefined,
            loadDefinitionByPath: async () => null,
            getSequenceSnapshot: () => ({ revision: 0, counters: {} }),
            commitSequenceProposal: () => false,
        }
        const result = await planWorkflowDraftGeneration(input, {
            drafts: { get: async () => readyDraft() },
            fragmentRepository: unavailable,
            pricingBasis: 'paid',
        })

        expect(result).toMatchObject({
            status: 'invalid',
            issues: [{
                code: 'prompt-module-unavailable',
                fieldPath: 'source.draft.payload.prompt',
            }],
        })
    })
})
