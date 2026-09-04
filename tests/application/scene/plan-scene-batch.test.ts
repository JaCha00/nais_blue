import { describe, expect, it } from 'vitest'

import {
    createSceneGenerationBinding,
    isSceneBatchRequest,
    planSceneBatch,
    resolveRepositorySceneBatchTargets,
    sceneGenerationBindingMatches,
} from '@/application/scene/plan-scene-batch'

const folderBinding = {
    resourceType: 'generation-folder-document' as const,
    resourceId: 'workspace-a',
    revision: 4,
    contentHash: `sha256:${'f'.repeat(64)}` as const,
}

function document(seed: number, revision = 7) {
    return {
        schemaVersion: 1 as const,
        presetId: 'preset-a',
        revision,
        updatedAt: '2026-09-04T00:00:00.000Z',
        scenes: [{
            id: 'scene-a',
            name: 'Opening',
            scenePrompt: 'A room',
            generation: { seed, seedLocked: false },
            artifactRefs: [],
            createdAt: 1,
        }],
    }
}

describe('Scene batch planning authority', () => {
    it('resolves every source from the repository and rejects missing or stale targets atomically', async () => {
        const repository = {
            getDocument: async (presetId: string) => presetId === 'preset-a' ? document(12) : null,
        } as never
        await expect(resolveRepositorySceneBatchTargets(repository, [
            { presetId: 'preset-a', sceneId: 'scene-a', expectedRevision: 7 },
        ])).resolves.toMatchObject([{ document: { revision: 7 }, scene: { scenePrompt: 'A room' } }])
        await expect(resolveRepositorySceneBatchTargets(repository, [
            { presetId: 'preset-a', sceneId: 'scene-a', expectedRevision: 7 },
            { presetId: 'preset-a', sceneId: 'missing', expectedRevision: 7 },
        ])).rejects.toThrow('Scene is missing')
        await expect(resolveRepositorySceneBatchTargets(repository, [
            { presetId: 'preset-a', sceneId: 'scene-a', expectedRevision: 8 },
        ])).rejects.toThrow('revision changed')
    })

    it('hashes semantic authoring state without undefined placeholders', () => {
        const binding = createSceneGenerationBinding(document(12), 'scene-a')
        expect(binding).not.toBeNull()
        expect(binding?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(sceneGenerationBindingMatches(binding!, document(99), 'scene-a')).toBe(true)
        expect(sceneGenerationBindingMatches(binding!, document(99, 8), 'scene-a')).toBe(false)

        const locked = createSceneGenerationBinding({
            ...document(12),
            scenes: [{ ...document(12).scenes[0], generation: { seed: 12, seedLocked: true } }],
        }, 'scene-a')!
        const changedLocked = {
            ...document(99),
            scenes: [{ ...document(99).scenes[0], generation: { seed: 99, seedLocked: true } }],
        }
        expect(sceneGenerationBindingMatches(locked, changedLocked, 'scene-a')).toBe(false)
    })

    it('freezes expanded exact jobs and a stable plan hash', () => {
        const sceneBinding = createSceneGenerationBinding(document(12), 'scene-a')!
        const plan = planSceneBatch({
            folderBinding,
            jobs: [{
                presetId: 'preset-a',
                sceneId: 'scene-a',
                seed: 12,
                fileName: 'opening.png',
                sceneBinding,
                estimatedAnlas: 0,
                prepared: { marker: true },
            }],
            request: {
                actor: { kind: 'user', id: 'scene-queue' },
                preset: { id: 'preset-a', expectedRevision: 7 },
                items: [{ sceneId: 'scene-a', count: 1 }],
                seedPolicy: { kind: 'random' },
                execution: { failurePolicy: 'continue' },
                budget: { maxImages: 1, maxAnlas: 0 },
            },
        })

        expect(plan.planHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        expect(plan.jobs[0]).toMatchObject({ ordinal: 0, fileName: 'opening.png' })
        expect(Object.isFrozen(plan)).toBe(true)
        expect(Object.isFrozen(plan.jobs)).toBe(true)
    })

    it('rejects malformed public requests and unsafe exact filenames', () => {
        const sceneBinding = createSceneGenerationBinding(document(12), 'scene-a')!
        const request = {
            actor: { kind: 'user' as const, id: 'scene-queue' },
            preset: { id: 'preset-a', expectedRevision: 7 },
            items: [{ sceneId: 'scene-a', count: 1 }],
            seedPolicy: { kind: 'fixed' as const, seed: 12 },
            execution: { failurePolicy: 'continue' as const },
            budget: { maxImages: 1, maxAnlas: 0 },
        }
        expect(isSceneBatchRequest(request)).toBe(true)
        expect(isSceneBatchRequest({
            ...request,
            actor: { kind: 'user', id: 'x'.repeat(201) },
        })).toBe(false)
        expect(() => planSceneBatch({
            folderBinding,
            request,
            jobs: [{
                presetId: 'preset-a',
                sceneId: 'scene-a',
                seed: 12,
                fileName: 'opening/unsafe.png',
                sceneBinding,
                estimatedAnlas: 0,
                prepared: { marker: true },
            }],
        })).toThrow(TypeError)
    })
})
