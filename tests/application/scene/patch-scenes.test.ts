import { describe, expect, it } from 'vitest'
import { patchScenes, type PatchScenesInput, type ScenePatch } from '@/application/scene/patch-scenes'
import type {
    CommitResult,
    SceneAuthoringRecord,
    SceneDocument,
    SceneRepositoryPort,
} from '@/application/scene/scene-repository'
import { resolveScene } from '@/application/scene/resolve-scenes'
import type { PromptContribution } from '@/domain/composition/types'

const NOW = '2026-09-04T01:02:03.000Z'

function scene(id: string, prompt = ''): SceneAuthoringRecord {
    return {
        id,
        name: id,
        scenePrompt: prompt,
        artifactRefs: [],
        createdAt: 1,
    }
}

function document(scenes: readonly SceneAuthoringRecord[], revision = 4): SceneDocument {
    return {
        schemaVersion: 1,
        presetId: 'preset:1',
        revision,
        scenes,
        updatedAt: '2026-09-04T00:00:00.000Z',
    }
}

function contribution(
    id: string,
    text: string,
    slot: 'base' | 'inpainting' | 'additional' | 'workflow' | 'scene' | 'style' | 'detail' | 'quality' = 'additional',
    merge: PromptContribution['merge'] = 'replace',
): PromptContribution {
    const actor = { kind: 'agent' as const, id: 'agent:test' }
    return {
        id,
        orderKey: id,
        revision: 0,
        createdAt: NOW,
        createdBy: actor,
        updatedAt: NOW,
        updatedBy: actor,
        enabled: true,
        target: { kind: 'positive', slot },
        text,
        merge,
        provenance: [{ kind: 'external', source: 'test' }],
    }
}

function repository(current: SceneDocument, result?: CommitResult) {
    const commits: Array<{ next: SceneDocument; expectedRevision: number }> = []
    const port: SceneRepositoryPort = {
        readLegacyProjection: async () => null,
        getDocument: async () => structuredClone(current),
        listDocuments: async () => [],
        commit: async (next, expectedRevision) => {
            commits.push({ next: structuredClone(next), expectedRevision })
            return result ?? { status: 'COMMITTED', document: structuredClone(next) }
        },
    }
    return { port, commits }
}

function input(port: SceneRepositoryPort, scenePatches: PatchScenesInput['scenePatches']): PatchScenesInput {
    return {
        repository: port,
        presetId: 'preset:1',
        expectedRevision: 4,
        scenePatches,
        now: NOW,
    }
}

describe('patchScenes', () => {
    it.each([
        { value: [] },
        { value: [{ sceneId: 'scene:a', patches: [] }] },
    ])('rejects no-op mutation without consuming a revision: $value', async ({ value: scenePatches }) => {
        const repo = repository(document([scene('scene:a')]))
        const result = await patchScenes(input(
            repo.port,
            scenePatches as PatchScenesInput['scenePatches'],
        ))

        expect(result).toMatchObject({ status: 'INVALID', code: 'INVALID_INPUT' })
        expect(repo.commits).toEqual([])
    })

    it('commits two Scene changes atomically with exactly one new revision', async () => {
        const original = document([scene('scene:a'), scene('scene:b')])
        const repo = repository(original)
        const result = await patchScenes(input(repo.port, [{
            sceneId: 'scene:a',
            patches: [{ op: 'set-parameter', field: 'steps', value: 31 }],
        }, {
            sceneId: 'scene:b',
            patches: [{ op: 'set-parameter', field: 'sampler', value: 'k_euler' }],
        }]))

        expect(result.status).toBe('COMMITTED')
        expect(repo.commits).toHaveLength(1)
        expect(repo.commits[0]).toMatchObject({ expectedRevision: 4, next: { revision: 5, updatedAt: NOW } })
        expect(repo.commits[0].next.scenes[0].compositionRef?.paramsOverride?.steps).toBe(31)
        expect(repo.commits[0].next.scenes[1].compositionRef?.paramsOverride?.sampler).toBe('k_euler')
    })

    it.each([
        { value: [
            { sceneId: 'scene:a', patches: [{ op: 'set-parameter', field: 'steps', value: 31 }] },
            { sceneId: 'scene:missing', patches: [] },
        ] },
        { value: [
            { sceneId: 'scene:a', patches: [{ op: 'set-parameter', field: 'steps', value: 31 }] },
            { sceneId: 'scene:b', patches: [{ op: 'set-parameter', field: 'steps', value: 0 }] },
        ] },
    ] as const)('does not commit when one Scene is missing or invalid', async ({ value: scenePatches }) => {
        const original = document([scene('scene:a'), scene('scene:b')])
        const repo = repository(original)
        const result = await patchScenes(input(repo.port, scenePatches as unknown as PatchScenesInput['scenePatches']))

        expect(result.status).toBe('INVALID')
        expect(repo.commits).toEqual([])
        expect(original).toEqual(document([scene('scene:a'), scene('scene:b')]))
    })

    it('returns current without applying an optimistic projection on stale input or CAS conflict', async () => {
        const current = document([scene('scene:a')], 5)
        const stale = repository(current)
        const staleResult = await patchScenes({
            ...input(stale.port, [{ sceneId: 'scene:a', patches: [] }]),
            expectedRevision: 4,
        })
        expect(staleResult).toMatchObject({ status: 'REVISION_CONFLICT', current: { revision: 5 } })
        expect(stale.commits).toEqual([])

        const original = document([scene('scene:a')])
        const raced = document([scene('scene:a', 'concurrent')], 5)
        const conflict = repository(original, { status: 'REVISION_CONFLICT', current: raced })
        const conflictResult = await patchScenes(input(conflict.port, [{
            sceneId: 'scene:a', patches: [{ op: 'set-parameter', field: 'steps', value: 30 }],
        }]))
        expect(conflictResult).toMatchObject({ status: 'REVISION_CONFLICT', current: raced })
        expect(conflictResult.status === 'REVISION_CONFLICT' && conflictResult.scenes[0].raw.scenePrompt)
            .toBe('concurrent')
    })

    it('keeps input/current detached while upserting and removing contributions', async () => {
        const first = contribution('contribution:1', 'first')
        const replacement = contribution('contribution:1', 'replacement')
        const originalPatches: ScenePatch[] = [
            { op: 'set-prompt-contribution', contribution: first },
            { op: 'set-prompt-contribution', contribution: replacement },
        ]
        const original = document([scene('scene:a', 'legacy')])
        const before = structuredClone({ original, originalPatches })
        const repo = repository(original)
        await patchScenes(input(repo.port, [{ sceneId: 'scene:a', patches: originalPatches }]))

        expect({ original, originalPatches }).toEqual(before)
        expect(repo.commits[0].next.scenes[0].compositionRef?.sceneContributions).toEqual([replacement])

        const repo2 = repository(repo.commits[0].next)
        await patchScenes({
            ...input(repo2.port, [{
                sceneId: 'scene:a',
                patches: [{ op: 'remove-prompt-contribution', contributionId: first.id }],
            }]),
            expectedRevision: 5,
        })
        expect(repo2.commits[0].next.scenes[0].compositionRef).not.toHaveProperty('sceneContributions')
    })

    it('sets and inherits parameters, removing the empty params object', async () => {
        const repo = repository(document([scene('scene:a')]))
        await patchScenes(input(repo.port, [{ sceneId: 'scene:a', patches: [
            { op: 'set-parameter', field: 'cfgScale', value: 6 },
            { op: 'inherit-parameter', field: 'cfgScale' },
        ] }]))
        expect(repo.commits[0].next.scenes[0].compositionRef).not.toHaveProperty('paramsOverride')
    })

    it('upserts a caption by character ID, validates position, and preserves overrides on recipe assignment', async () => {
        const authored = {
            ...scene('scene:a'),
            compositionRef: {
                recipeId: 'recipe:old',
                recipeRevision: 1,
                selectionKind: 'asset' as const,
                paramsOverride: { steps: 35 },
            },
        }
        const repo = repository(document([authored]))
        await patchScenes(input(repo.port, [{ sceneId: 'scene:a', patches: [
            {
                op: 'set-character-caption',
                characterId: 'character:hero',
                prompt: 'hero',
                negative: 'bad',
                position: { x: 0.25, y: 0.75 },
            },
            { op: 'assign-recipe', recipeId: 'recipe:new', recipeRevision: 8 },
        ] }]))
        expect(repo.commits[0].next.scenes[0].compositionRef).toMatchObject({
            recipeId: 'recipe:new', recipeRevision: 8, selectionKind: 'asset', paramsOverride: { steps: 35 },
            characterOverrides: [{
                characterId: 'character:hero', positivePrompt: 'hero', negativePrompt: 'bad',
                position: { mode: 'manual', x: 0.25, y: 0.75 },
            }],
        })

        const invalid = repository(document([scene('scene:a')]))
        const invalidResult = await patchScenes(input(invalid.port, [{
            sceneId: 'scene:a',
            patches: [{
                op: 'set-character-caption', characterId: 'character:hero', prompt: '', negative: '',
                position: { x: 1.01, y: 0.5 },
            }],
        }]))
        expect(invalidResult.status).toBe('INVALID')
        expect(invalid.commits).toEqual([])
    })

    it.each([
        { op: 'set-parameter', field: 'qualityToggle', value: true },
        { op: 'set-parameter', field: 'steps', value: '31' },
        { op: 'set-parameter', field: 'steps', value: 31, qualityToggle: true },
        { steps: 31 },
    ])('rejects unsupported Partial/config fields: %j', async patch => {
        const repo = repository(document([scene('scene:a')]))
        const result = await patchScenes(input(repo.port, [{
            sceneId: 'scene:a', patches: [patch as unknown as ScenePatch],
        }]))
        expect(result.status).toBe('INVALID')
        expect(repo.commits).toEqual([])
    })
})

describe('resolveScene', () => {
    it('uses the legacy scalar as fallback but makes a contribution authoritative with source provenance', () => {
        const legacy = resolveScene(scene('scene:a', 'legacy scalar'))
        expect(legacy.effective.prompts.additional).toEqual({
            value: 'legacy scalar', source: { kind: 'legacy-scalar', field: 'scenePrompt' },
        })

        const patched: SceneAuthoringRecord = {
            ...scene('scene:a', 'legacy scalar'),
            compositionRef: {
                recipeId: 'scene:direct', selectionKind: 'direct',
                sceneContributions: [contribution('contribution:1', 'authoritative')],
            },
        }
        const resolved = resolveScene(patched)
        expect(resolved.raw).toBe(patched)
        expect(resolved.effective.prompts.additional).toEqual({
            value: 'authoritative',
            source: { kind: 'scene-contribution', contributionIds: ['contribution:1'] },
        })
    })

    it('retains canonical positive slots and reports only contributing source IDs', () => {
        const contributions = [
            contribution('contribution:inpaint', 'inpaint', 'inpainting', 'append'),
            contribution('contribution:scene', 'scene', 'scene', 'append'),
            contribution('contribution:style', 'style', 'style', 'append'),
            contribution('contribution:quality', 'quality', 'quality', 'append'),
            contribution('contribution:detail', 'detail', 'detail', 'append'),
        ]
        const resolved = resolveScene({
            ...scene('scene:a', 'legacy'),
            compositionRef: {
                recipeId: 'scene:direct', selectionKind: 'direct', sceneContributions: contributions,
            },
        })

        expect(resolved.effective.prompts).toMatchObject({
            inpainting: {
                value: 'inpaint',
                source: { kind: 'scene-contribution', contributionIds: ['contribution:inpaint'] },
            },
            workflow: {
                value: 'quality, scene, style',
                source: {
                    kind: 'scene-contribution',
                    contributionIds: ['contribution:quality', 'contribution:scene', 'contribution:style'],
                },
            },
            detail: {
                value: 'detail',
                source: { kind: 'scene-contribution', contributionIds: ['contribution:detail'] },
            },
            positive: { value: 'inpaint, legacy, quality, scene, style, detail' },
        })
        expect(resolved.effective.prompts.positive.source).toEqual({
            kind: 'composed',
            sources: [
                { kind: 'scene-contribution', contributionIds: ['contribution:inpaint'] },
                { kind: 'legacy-scalar', field: 'scenePrompt' },
                {
                    kind: 'scene-contribution',
                    contributionIds: ['contribution:quality', 'contribution:scene', 'contribution:style'],
                },
                { kind: 'scene-contribution', contributionIds: ['contribution:detail'] },
            ],
        })
    })
})
