import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PromptContribution } from '@/domain/composition/types'
import {
    resolveSceneGeneration,
    resolveScenePrompts,
    useSceneStore,
    type SceneCard,
    type SceneCompositionRef,
    type ScenePreset,
} from '@/stores/scene-store'

vi.mock('@/lib/indexed-db', () => ({
    indexedDBStorage: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { Picture: 1, AppData: 2 },
    exists: async () => false,
    rename: async () => undefined,
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: async () => 'C:/Synthetic/AppData',
    pictureDir: async () => 'C:/Synthetic/Pictures',
    join: async (...parts: string[]) => parts.join('/'),
}))

const NOW = Date.parse('2026-07-12T00:00:00.000Z')
const PRESET_ID = 'preset:composition-actions'

function contribution(): PromptContribution {
    const timestamp = new Date(NOW).toISOString()
    const actor = { kind: 'user' as const, id: 'scene-test:user' }
    return {
        id: 'scene:override:detail',
        orderKey: 'scene:override:detail',
        revision: 1,
        createdAt: timestamp,
        createdBy: actor,
        updatedAt: timestamp,
        updatedBy: actor,
        enabled: true,
        target: { kind: 'positive', slot: 'detail' },
        text: 'scene detail override',
        merge: 'append',
    }
}

function fullCompositionRef(): SceneCompositionRef {
    return {
        recipeId: 'recipe:old',
        recipeRevision: 4,
        sceneContributions: [contribution()],
        paramsOverride: {
            cfgRescale: 0,
            smea: false,
        },
        characterOverrides: [{
            characterId: 'character:hero',
            positivePrompt: 'scene costume',
            position: { mode: 'manual', x: 0.25, y: 0.75 },
        }],
        outputOverride: {
            destination: { kind: 'memory' },
            format: 'webp',
            filenameTemplate: 'scene_{seed}',
            metadataMode: 'sidecar-only',
            collisionPolicy: 'overwrite',
        },
        migrationMarker: {
            kind: 'legacy-scene-prompt',
            schemaVersion: 2,
        },
        extensions: {
            preservedUnknown: 'value',
        },
    }
}

function scene(
    id: string,
    overrides: Partial<SceneCard> = {},
): SceneCard {
    return {
        id,
        name: `Scene ${id}`,
        scenePrompt: `legacy prompt ${id}`,
        queueCount: 3,
        images: [{
            id: `image:${id}`,
            url: `NAI_Blue_Scene/${id}.png`,
            timestamp: NOW,
            isFavorite: true,
        }],
        width: 768,
        height: 1024,
        excludePinned: true,
        createdAt: NOW,
        ...overrides,
    }
}

function preset(scenes: SceneCard[]): ScenePreset {
    return {
        id: PRESET_ID,
        name: 'Composition actions',
        scenes,
        createdAt: NOW,
    }
}

beforeEach(() => {
    useSceneStore.setState({
        presets: [preset([
            scene('scene:a', { compositionRef: fullCompositionRef() }),
            scene('scene:b', { queueCount: 2 }),
            scene('scene:c', { queueCount: 1, scenePrompt: 'unselected prompt' }),
        ])],
        activePresetId: PRESET_ID,
        selectedSceneIds: ['scene:a', 'scene:b'],
        lastSelectedSceneId: 'scene:b',
        sceneCompositionMode: 'v2',
        sceneCompositionResults: {
            'scene:a': { mode: 'v2', warnings: [], errors: [] },
            'scene:b': { mode: 'v2', warnings: [], errors: [] },
            'scene:c': { mode: 'v2', warnings: [], errors: [] },
        },
    })
})

describe('Scene store composition actions', () => {
    it('owns five prompt slots and generation parameters per scene', () => {
        const store = useSceneStore.getState()
        store.updateScenePrompts(PRESET_ID, 'scene:a', {
            base: 'scene base',
            additional: 'scene additional',
            character: 'scene character',
            negative: 'scene negative',
            characterNegative: 'scene character negative',
        })
        store.updateSceneGeneration(PRESET_ID, 'scene:a', {
            model: 'nai-diffusion-4-5-curated',
            steps: 41,
            cfgScale: 6.5,
            sampler: 'k_dpmpp_2m',
            seed: 123456,
            seedLocked: true,
        })

        const updated = useSceneStore.getState().getScene(PRESET_ID, 'scene:a')!
        const untouched = useSceneStore.getState().getScene(PRESET_ID, 'scene:b')!

        expect(resolveScenePrompts(updated)).toEqual({
            base: 'scene base',
            additional: 'scene additional',
            character: 'scene character',
            negative: 'scene negative',
            characterNegative: 'scene character negative',
        })
        expect(resolveSceneGeneration(updated)).toMatchObject({
            model: 'nai-diffusion-4-5-curated',
            steps: 41,
            cfgScale: 6.5,
            sampler: 'k_dpmpp_2m',
            seed: 123456,
            seedLocked: true,
        })
        expect(resolveSceneGeneration(untouched).steps).toBe(28)
        expect(updated.scenePrompt).toBe('scene additional')
    })

    it('projects an old single scene prompt into the additional slot', () => {
        expect(resolveScenePrompts(scene('scene:legacy', { scenePrompt: 'legacy only' }))).toMatchObject({
            base: '',
            additional: 'legacy only',
            character: '',
            negative: '',
            characterNegative: '',
        })
    })

    it('bulk-applies a recipe while preserving queue, images, and per-scene overrides', () => {
        const beforeA = structuredClone(useSceneStore.getState().getScene(PRESET_ID, 'scene:a'))
        const beforeB = structuredClone(useSceneStore.getState().getScene(PRESET_ID, 'scene:b'))
        const beforeC = structuredClone(useSceneStore.getState().getScene(PRESET_ID, 'scene:c'))

        useSceneStore.getState().applyRecipeToSelectedScenes('recipe:new', 12)

        const state = useSceneStore.getState()
        const afterA = state.getScene(PRESET_ID, 'scene:a')
        const afterB = state.getScene(PRESET_ID, 'scene:b')
        const afterC = state.getScene(PRESET_ID, 'scene:c')

        expect(afterA).toMatchObject({
            queueCount: beforeA?.queueCount,
            images: beforeA?.images,
            scenePrompt: beforeA?.scenePrompt,
            width: beforeA?.width,
            height: beforeA?.height,
            excludePinned: beforeA?.excludePinned,
            compositionRef: {
                ...beforeA?.compositionRef,
                recipeId: 'recipe:new',
                recipeRevision: 12,
            },
        })
        expect(afterA?.compositionRef?.sceneContributions)
            .toEqual(beforeA?.compositionRef?.sceneContributions)
        expect(afterA?.compositionRef?.paramsOverride)
            .toEqual(beforeA?.compositionRef?.paramsOverride)
        expect(afterA?.compositionRef?.characterOverrides)
            .toEqual(beforeA?.compositionRef?.characterOverrides)
        expect(afterA?.compositionRef?.outputOverride)
            .toEqual(beforeA?.compositionRef?.outputOverride)

        expect(afterB).toMatchObject({
            queueCount: beforeB?.queueCount,
            images: beforeB?.images,
            scenePrompt: beforeB?.scenePrompt,
            width: beforeB?.width,
            height: beforeB?.height,
            compositionRef: {
                recipeId: 'recipe:new',
                recipeRevision: 12,
                migrationMarker: {
                    kind: 'legacy-scene-prompt',
                    schemaVersion: 2,
                },
            },
        })
        expect(afterC).toEqual(beforeC)
        expect(state.selectedSceneIds).toEqual(['scene:a', 'scene:b'])
        expect(state.sceneCompositionResults).toEqual({
            'scene:c': { mode: 'v2', warnings: [], errors: [] },
        })
    })

    it('resets scene-local fields while retaining recipe identity and migration metadata', () => {
        const before = structuredClone(useSceneStore.getState().getScene(PRESET_ID, 'scene:a'))

        useSceneStore.getState().resetSceneToRecipe(PRESET_ID, 'scene:a')

        const state = useSceneStore.getState()
        const reset = state.getScene(PRESET_ID, 'scene:a')

        expect(reset).toMatchObject({
            id: before?.id,
            name: before?.name,
            scenePrompt: '',
            queueCount: before?.queueCount,
            images: before?.images,
            excludePinned: before?.excludePinned,
            createdAt: before?.createdAt,
            compositionRef: {
                recipeId: 'recipe:old',
                recipeRevision: 4,
                migrationMarker: {
                    kind: 'legacy-scene-prompt',
                    schemaVersion: 2,
                },
                extensions: {
                    preservedUnknown: 'value',
                },
            },
        })
        expect(reset).not.toHaveProperty('width')
        expect(reset).not.toHaveProperty('height')
        expect(reset?.compositionRef).not.toHaveProperty('sceneContributions')
        expect(reset?.compositionRef).not.toHaveProperty('paramsOverride')
        expect(reset?.compositionRef).not.toHaveProperty('characterOverrides')
        expect(reset?.compositionRef).not.toHaveProperty('outputOverride')
        expect(state.sceneCompositionResults).not.toHaveProperty('scene:a')
        expect(state.sceneCompositionResults).toHaveProperty('scene:b')
        expect(state.sceneCompositionResults).toHaveProperty('scene:c')
    })

    it('consumes an unlocked seed and publishes the next seed atomically', () => {
        useSceneStore.getState().updateSceneGeneration(PRESET_ID, 'scene:a', {
            seed: 123,
            seedLocked: false,
        })
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.25)

        expect(useSceneStore.getState().consumeSceneGenerationSeed(PRESET_ID, 'scene:a')).toBe(123)
        expect(resolveSceneGeneration(useSceneStore.getState().getScene(PRESET_ID, 'scene:a')!).seed)
            .toBe(2_147_483_647)
        expect(useSceneStore.getState().consumeSceneGenerationSeed(PRESET_ID, 'scene:a'))
            .toBe(2_147_483_647)
        expect(resolveSceneGeneration(useSceneStore.getState().getScene(PRESET_ID, 'scene:a')!).seed)
            .toBe(1_073_741_823)
    })

    it('materializes a zero seed once when the Scene is locked', () => {
        useSceneStore.getState().updateSceneGeneration(PRESET_ID, 'scene:a', {
            seed: 0,
            seedLocked: true,
        })
        vi.spyOn(Math, 'random').mockReturnValue(0.5)

        expect(useSceneStore.getState().consumeSceneGenerationSeed(PRESET_ID, 'scene:a'))
            .toBe(2_147_483_647)
        expect(resolveSceneGeneration(useSceneStore.getState().getScene(PRESET_ID, 'scene:a')!))
            .toMatchObject({ seed: 2_147_483_647, seedLocked: true })
        expect(useSceneStore.getState().consumeSceneGenerationSeed(PRESET_ID, 'scene:a'))
            .toBe(2_147_483_647)
    })

    it('claims and requeues FIFO image filenames without losing the scene default', () => {
        const store = useSceneStore.getState()
        store.setSceneFilenameTemplate(PRESET_ID, 'scene:a', 'scene_{seed}')
        store.setQueuedImageFileNames(PRESET_ID, 'scene:a', ['first', '', 'third'])

        expect(store.decrementFirstQueuedScene(PRESET_ID)).toMatchObject({
            scene: { id: 'scene:a' },
            filenameTemplate: 'first',
        })
        const inherited = useSceneStore.getState().decrementFirstQueuedScene(PRESET_ID)
        expect(inherited).toMatchObject({
            scene: { id: 'scene:a' },
            filenameTemplate: 'scene_{seed}',
        })

        useSceneStore.getState().requeueSceneGeneration(
            PRESET_ID,
            'scene:a',
            inherited?.filenameTemplate,
        )
        expect(useSceneStore.getState().getScene(PRESET_ID, 'scene:a')).toMatchObject({
            queueCount: 2,
            queuedFileNames: ['scene_{seed}', 'third'],
        })
    })

    it('keeps same-tick image and session identities unique', () => {
        vi.spyOn(Date, 'now').mockReturnValue(NOW)
        const store = useSceneStore.getState()
        store.addImageToScene(PRESET_ID, 'scene:a', 'first.png')
        store.addImageToScene(PRESET_ID, 'scene:a', 'second.png')

        const images = useSceneStore.getState().getScene(PRESET_ID, 'scene:a')!.images
        expect(new Set(images.map(image => image.id)).size).toBe(images.length)

        useSceneStore.setState({ generationSessionId: NOW })
        expect(useSceneStore.getState().startNewGenerationSession()).toBe(NOW + 1)
        useSceneStore.getState().cancelSceneGeneration()
        expect(useSceneStore.getState().generationSessionId).toBe(NOW + 2)
        useSceneStore.getState().setIsGenerating(false)
        expect(useSceneStore.getState().generationSessionId).toBe(NOW + 3)
    })
})
