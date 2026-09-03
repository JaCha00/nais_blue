import { describe, expect, it, vi } from 'vitest'

const persistedSceneStorage = vi.hoisted(() => ({ value: '' }))

vi.mock('@/lib/indexed-db', () => ({
    getIndexedDBItemStrict: async (key: string) => (
        key === 'nai-blue-scenes' ? persistedSceneStorage.value : null
    ),
    indexedDBStorage: {
        getItem: async (key: string) => (
            key === 'nai-blue-scenes' ? persistedSceneStorage.value : null
        ),
        setItem: async () => undefined,
        removeItem: async () => undefined,
    },
}))

import { IndexedDbSceneRepository } from '@/adapters/scene/indexeddb-scene-repository'
import {
    getScenePresetPathSegments,
    resolveSceneCharacterCaptions,
    resolveSceneGeneration,
    resolveScenePrompts,
    useSceneStore,
    type SceneCard,
    type ScenePreset,
} from '@/stores/scene-store'

const legacyScene = {
    id: 'scene:legacy',
    name: 'Legacy',
    scenePrompt: 'legacy scalar prompt',
    queueCount: 4,
    queuedFileNames: ['runtime.png'],
    images: [{ id: 'image:legacy', url: 'Scene/legacy.png', timestamp: 10, isFavorite: true }],
    width: 768,
    height: 1024,
    excludePinned: false,
    createdAt: 1_700_000_000_000,
    isGenerating: true,
    compositionDiagnostics: { warnings: ['runtime only'] },
}

const modularScene = {
    id: 'scene:modular',
    name: 'Modular',
    scenePrompt: 'compatibility alias',
    prompts: {
        base: 'base',
        additional: 'modular additional',
        character: 'character',
        negative: 'negative',
        characterNegative: 'character negative',
    },
    characterCaptions: [{
        id: 'caption:1',
        name: 'Hero',
        prompt: 'hero prompt',
        negative: 'hero negative',
        enabled: true,
        position: { x: 0.25, y: 0.75 },
    }],
    characterPositionEnabled: true,
    generation: { steps: 31, cfgScale: 6, seed: 42, seedLocked: true, smea: true },
    queueCount: 2,
    images: [{ id: 'image:modular', url: 'data:image/png;base64,legacy', timestamp: 20, isFavorite: false }],
    metadataMode: 'strip-and-sidecar',
    generationFolderId: 'folder:1',
    filenameTemplate: '{scene}_{index}',
    compositionRef: { recipeId: 'recipe:1', recipeRevision: 7 },
    createdAt: 1_700_000_000_001,
}

const persistedState = {
    presets: [{
        id: 'preset:parent',
        name: 'Parent',
        scenes: [legacyScene],
        parentId: null,
        defaultTemplate: {
            sourceSceneId: legacyScene.id,
            sourceSceneName: legacyScene.name,
            scenePrompt: legacyScene.scenePrompt,
            prompts: { base: '', additional: legacyScene.scenePrompt, character: '', negative: '', characterNegative: '' },
            generation: { model: 'nai-diffusion-4-5-full', steps: 28 },
        },
        createdAt: 1_699_000_000_000,
    }, {
        id: 'preset:child',
        name: 'Child',
        scenes: [modularScene],
        parentId: 'preset:parent',
        createdAt: 1_699_000_000_001,
    }],
    activePresetId: 'preset:child',
    gridColumns: 6,
    thumbnailLayout: 'horizontal',
    scrollPosition: 240,
    isGenerating: true,
    isCancelling: true,
    streamingSession: { id: 'runtime' },
    historyTrigger: 9,
    sceneCompositionResults: { [modularScene.id]: { warnings: ['runtime'] } },
}

describe('IndexedDbSceneRepository', () => {
    it('reads version 0 without changing the preimage and projects authoring fields only', async () => {
        const preimage = JSON.stringify({ state: persistedState, version: 0 })
        const reads: string[] = []
        const repository = new IndexedDbSceneRepository({
            getItem: async key => {
                reads.push(key)
                return preimage
            },
        })

        const projection = await repository.readLegacyProjection()

        expect(reads).toEqual(['nai-blue-scenes'])
        expect(JSON.stringify({ state: persistedState, version: 0 })).toBe(preimage)
        expect(projection?.presets[0]).toMatchObject({
            id: 'preset:parent',
            name: 'Parent',
            parentId: null,
            defaultTemplate: persistedState.presets[0].defaultTemplate,
            createdAt: 1_699_000_000_000,
        })
        expect(projection?.presets[0].scenes[0].images).toEqual(legacyScene.images)
        expect(projection?.presets[1].scenes[0]).toMatchObject({
            prompts: modularScene.prompts,
            characterCaptions: modularScene.characterCaptions,
            generation: modularScene.generation,
            metadataMode: modularScene.metadataMode,
            generationFolderId: modularScene.generationFolderId,
            filenameTemplate: modularScene.filenameTemplate,
            compositionRef: modularScene.compositionRef,
        })
        expect(projection).not.toHaveProperty('activePresetId')
        expect(projection?.presets[0].scenes[0]).not.toHaveProperty('queueCount')
        expect(projection?.presets[0].scenes[0]).not.toHaveProperty('queuedFileNames')
        expect(projection?.presets[0].scenes[0]).not.toHaveProperty('isGenerating')
        expect(projection?.presets[0].scenes[0]).not.toHaveProperty('compositionDiagnostics')
    })

    it('matches Zustand hydration and existing prompt, caption, generation, and path resolvers', async () => {
        persistedSceneStorage.value = JSON.stringify({ state: persistedState, version: 0 })
        await useSceneStore.persist.rehydrate()
        const projection = await new IndexedDbSceneRepository({
            getItem: async () => persistedSceneStorage.value,
        }).readLegacyProjection()
        const projectedPresets = projection?.presets as unknown as ScenePreset[]
        const hydrated = useSceneStore.getState()

        for (const sceneId of [legacyScene.id, modularScene.id]) {
            const projected = projectedPresets.flatMap(preset => preset.scenes).find(scene => scene.id === sceneId) as SceneCard
            const hydratedScene = hydrated.presets.flatMap(preset => preset.scenes).find(scene => scene.id === sceneId) as SceneCard
            expect(resolveScenePrompts(projected)).toEqual(resolveScenePrompts(hydratedScene))
            expect(resolveSceneCharacterCaptions(projected)).toEqual(resolveSceneCharacterCaptions(hydratedScene))
            expect(resolveSceneGeneration(projected)).toEqual(resolveSceneGeneration(hydratedScene))
        }
        expect(getScenePresetPathSegments(projectedPresets, 'preset:child')).toEqual(
            getScenePresetPathSegments(hydrated.presets, 'preset:child'),
        )
    })

    it('returns null when the Scene key is missing', async () => {
        await expect(new IndexedDbSceneRepository({ getItem: async () => null }).readLegacyProjection())
            .resolves.toBeNull()
    })

    it.each([
        '{',
        'null',
        JSON.stringify({ state: persistedState }),
        JSON.stringify({ state: persistedState, version: 1 }),
        JSON.stringify({ state: [], version: 0 }),
        JSON.stringify({ state: { presets: 'invalid' }, version: 0 }),
        JSON.stringify({ state: { presets: [{ id: 'broken' }] }, version: 0 }),
    ])('rejects a malformed or unsupported envelope without repairing it: %s', async serialized => {
        const repository = new IndexedDbSceneRepository({ getItem: async () => serialized })
        await expect(repository.readLegacyProjection()).rejects.toBeInstanceOf(TypeError)
    })
})
