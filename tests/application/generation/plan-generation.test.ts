import { describe, expect, it, vi } from 'vitest'

import {
    hashGenerationSemanticIntent,
    planGeneration,
    replayGenerationPlan,
    type PlanGenerationDependencies,
} from '@/application/generation/plan-generation'
import type {
    CompatibilityStatus,
    PlanGenerationInput,
    PreparedGenerationJobDraft,
} from '@/application/generation/generation-plan-contract'
import {
    createSingleImageDraft,
    reviseSingleImageDraft,
    type WorkflowDraft,
} from '@/domain/workflow/single-image-draft'
import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'

function workflowDraft(overrides: { prompt?: string; model?: string; directory?: string } = {}): WorkflowDraft {
    const created = createSingleImageDraft({
        id: 'draft-1',
        now: '2026-09-03T00:00:00.000Z',
        seed: 1,
    })
    return reviseSingleImageDraft(created, {
        updatedAt: '2026-09-03T00:00:01.000Z',
        payload: {
            ...created.payload,
            model: overrides.model ?? created.payload.model,
            prompt: { positive: overrides.prompt ?? 'blue hair', negative: 'lowres' },
            output: {
                ...created.payload.output,
                directory: overrides.directory ?? created.payload.output.directory,
                // Both current `unique` drafts and explicit `error` drafts map
                // to a logical fail reservation until Folder CAS exists.
                collisionPolicy: 'unique',
            },
        },
    })
}

const baseInput: PlanGenerationInput = {
    source: { kind: 'workflow-draft', draftId: 'draft-1', expectedRevision: 1 },
    count: 2,
    seedPolicy: { kind: 'fixed', seed: 42 },
    budget: { maxImages: 2, maxAnlas: 100 },
}

function dependencies(
    draft = workflowDraft(),
    compatibilityStatus: CompatibilityStatus = 'captured-pass',
): PlanGenerationDependencies<{ sourceImage: string; privateAbsolutePath: string }> {
    return {
        drafts: { get: vi.fn(async () => draft) },
        planner: {
            prepare: vi.fn(async ({ draft: loaded, materializedSeeds }) => materializedSeeds.map(seed => ({
                semantic: {
                    prompt: loaded.payload.prompt.positive,
                    negativePrompt: loaded.payload.prompt.negative,
                    model: loaded.payload.model ?? 'missing',
                    width: loaded.payload.resolution?.width ?? 0,
                    height: loaded.payload.resolution?.height ?? 0,
                    steps: loaded.payload.generation.steps,
                    seed,
                    generationParameters: {
                        cfgScale: loaded.payload.generation.cfgScale,
                        directoryIdentity: hashCanonicalValue(loaded.payload.output.directory),
                    },
                    resourceDigest: `sha256:${'a'.repeat(64)}`,
                },
                preparationDigest: `sha256:${'b'.repeat(64)}`,
                destination: {
                    generationFolderId: loaded.payload.output.generationFolderId ?? null,
                    generationFolderPathHash: loaded.payload.output.generationFolderPath
                        ? `sha256:${hashCanonicalValue(loaded.payload.output.generationFolderPath)}`
                        : null,
                    outputPolicyId: `output:${hashCanonicalValue(loaded.payload.output.directory)}`,
                    expectedBaseName: 'image',
                    extension: loaded.payload.output.imageFormat,
                    collisionPolicy: 'fail',
                    deliveryRequired: loaded.payload.output.autoSave,
                },
                prepared: {
                    sourceImage: 'data:image/png;base64,PRIVATE',
                    privateAbsolutePath: 'E:\\private\\image.png',
                },
            } satisfies PreparedGenerationJobDraft<{ sourceImage: string; privateAbsolutePath: string }>))),
        },
        executionPolicy: {
            failurePolicy: 'continue',
            retryPolicyId: 'safe-v1',
            maxAttempts: 2,
            maxConcurrency: 1,
            pricingBasis: 'paid',
        },
        estimateAnlas: () => 7,
        resolveCompatibility: () => ({ compatibilityProfileId: 'nai:test', status: compatibilityStatus }),
    }
}

async function readyPlan(
    input: PlanGenerationInput = baseInput,
    deps = dependencies(),
) {
    const result = await planGeneration(input, deps)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error(`Expected ready, received ${result.status}`)
    return result
}

describe('planGeneration', () => {
    it('produces stable canonical hashes and changes the relevant hashes with semantic inputs', async () => {
        const first = await readyPlan()
        const second = await readyPlan()
        expect(second.plan.planHash).toBe(first.plan.planHash)
        expect(second.plan.semanticPlanHash).toBe(first.plan.semanticPlanHash)
        expect(first.plan.planId).toBe(first.plan.planHash)
        expect(hashGenerationSemanticIntent(first.plan.jobs[0].semantic)).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(hashGenerationSemanticIntent(first.plan.jobs[0].semantic))
            .toBe(hashGenerationSemanticIntent(second.plan.jobs[0].semantic))

        const promptChanged = await readyPlan(baseInput, dependencies(workflowDraft({ prompt: 'red hair' })))
        expect(promptChanged.plan.semanticPlanHash).not.toBe(first.plan.semanticPlanHash)
        expect(hashGenerationSemanticIntent(promptChanged.plan.jobs[0].semantic))
            .not.toBe(hashGenerationSemanticIntent(first.plan.jobs[0].semantic))
        expect(promptChanged.plan.planHash).not.toBe(first.plan.planHash)

        const seedChanged = await readyPlan({
            ...baseInput,
            seedPolicy: { kind: 'fixed', seed: 43 },
        })
        expect(seedChanged.plan.semanticPlanHash).not.toBe(first.plan.semanticPlanHash)

        const outputChanged = await readyPlan(baseInput, dependencies(workflowDraft({ directory: 'other' })))
        expect(outputChanged.plan.planHash).not.toBe(first.plan.planHash)
    })

    it('returns a stale-source conflict without invoking the planner', async () => {
        const deps = dependencies()
        const prepare = vi.mocked(deps.planner.prepare)
        const result = await planGeneration({
            ...baseInput,
            source: { ...baseInput.source, expectedRevision: 0 },
        }, deps)

        expect(result).toEqual({
            status: 'conflict',
            source: { kind: 'workflow-draft', draftId: 'draft-1', expectedRevision: 0 },
            currentRevision: 1,
            action: 'reload-workflow-draft',
        })
        expect(prepare).not.toHaveBeenCalled()
    })

    it('replays a random trace without calling the random source again', async () => {
        const randomSeed = vi.fn().mockReturnValueOnce(11).mockReturnValueOnce(22)
        const random = { ...dependencies(), randomSeed }
        const planned = await readyPlan({ ...baseInput, seedPolicy: { kind: 'random' } }, random)

        const replay = {
            ...dependencies(),
            randomSeed,
            resolveReplayTrace: vi.fn(async () => planned.plan.materializedSeedTrace.seeds),
        }
        const replayed = await readyPlan({
            ...baseInput,
            seedPolicy: { kind: 'replay', traceId: 'trace-1' },
        }, replay)

        expect(randomSeed).toHaveBeenCalledTimes(2)
        expect(replayed.plan.semanticPlanHash).toBe(planned.plan.semanticPlanHash)
        expect(replayed.plan.planHash).toBe(planned.plan.planHash)
        expect(planned.plan.materializedSeedTrace.traceId).toMatch(/^sha256:/)
        expect(replayed.plan.jobs.map(job => job.semantic.seed)).toEqual([11, 22])
    })

    it('redacts opaque prepared values from the public view', async () => {
        const result = await readyPlan()
        const serialized = JSON.stringify(result.view)

        expect(serialized).not.toContain('PRIVATE')
        expect(serialized).not.toContain('privateAbsolutePath')
        expect(result.view.jobs[0]).toMatchObject({
            ordinal: 0,
            model: result.plan.jobs[0].semantic.model,
            seed: 42,
            estimatedAnlas: 7,
            compatibilityProfileId: 'nai:test',
            compatibilityStatus: 'captured-pass',
        })
    })

    it('returns budget approval requirements and compatibility outcomes structurally', async () => {
        const budget = await planGeneration({
            ...baseInput,
            budget: { maxImages: 1, maxAnlas: 10 },
        }, dependencies())
        expect(budget.status).toBe('needs_input')
        if (budget.status === 'needs_input') {
            expect(budget.requirements).toEqual([
                { kind: 'budget', fieldPath: 'budget.maxImages', required: 2, allowed: 1 },
                { kind: 'budget', fieldPath: 'budget.maxAnlas', required: 14, allowed: 10 },
            ])
        }

        const warning = await readyPlan(baseInput, dependencies(workflowDraft(), 'synthetic-only'))
        expect(warning.plan.issues).toHaveLength(2)
        expect(warning.plan.issues.every(issue => issue.severity === 'warning')).toBe(true)
        expect(warning.plan.planHash).not.toBe((await readyPlan()).plan.planHash)

        const unsupported = await planGeneration(baseInput, dependencies(workflowDraft(), 'known-divergence'))
        expect(unsupported.status).toBe('unsupported')
        if (unsupported.status === 'unsupported') {
            expect(unsupported.capability).toBe('compatibility-known-divergence')
            expect(unsupported.issues).toHaveLength(2)
            expect(unsupported.issues.every(issue => issue.severity === 'blocking')).toBe(true)
        }
    })

    it('deep-freezes the internal plan and detached view', async () => {
        const result = await readyPlan()

        expect(Object.isFrozen(result.plan)).toBe(true)
        expect(Object.isFrozen(result.plan.jobs)).toBe(true)
        expect(Object.isFrozen(result.plan.jobs[0].semantic)).toBe(true)
        expect(Object.isFrozen(result.plan.jobs[0].prepared)).toBe(true)
        expect(Object.isFrozen(result.view)).toBe(true)
        expect(Object.isFrozen(result.view.jobs[0].destination)).toBe(true)
    })

    it('re-reads with reviewed seeds and reports the first digest mismatch', async () => {
        const reviewed = await readyPlan()
        const randomSeed = vi.fn(() => 999)
        const result = await replayGenerationPlan(reviewed.plan, {
            source: baseInput.source,
            count: baseInput.count,
            budget: baseInput.budget,
        }, {
            ...dependencies(workflowDraft({ prompt: 'changed after review' })),
            randomSeed,
        })

        expect(randomSeed).not.toHaveBeenCalled()
        expect(result.status).toBe('conflict')
        if (result.status === 'conflict') {
            expect(result.mismatch).toMatchObject({ fieldPath: 'jobs[0].semantic' })
            expect(result.mismatch?.expectedDigest).toMatch(/^sha256:/)
            expect(result.mismatch?.actualDigest).toMatch(/^sha256:/)
        }
    })

    it('treats a changed compatibility snapshot as a reviewed-plan mismatch', async () => {
        const reviewed = await readyPlan()
        const result = await replayGenerationPlan(reviewed.plan, {
            source: baseInput.source,
            count: baseInput.count,
            budget: baseInput.budget,
        }, dependencies(workflowDraft(), 'synthetic-only'))

        expect(result.status).toBe('conflict')
        if (result.status === 'conflict') {
            expect(result.mismatch?.fieldPath).toBe('jobs[0].compatibility')
        }
    })
})
