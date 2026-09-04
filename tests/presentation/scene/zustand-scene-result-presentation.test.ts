import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
    type SceneImage = { id?: string, url: string }
    type Scene = { id: string, images: SceneImage[] }
    type Preset = { id: string, name: string, scenes: Scene[] }

    const generation = {
        basePrompt: 'base',
        additionalPrompt: 'additional',
        detailPrompt: 'detail',
        negativePrompt: 'negative',
        inpaintingPrompt: 'inpaint',
        history: [] as Array<{ id: string }>,
        addToHistory: vi.fn((value: { id: string }) => {
            generation.history = [value, ...generation.history]
        }),
    }
    const scene = {
        presets: [] as Preset[],
        addImageToScene: vi.fn((presetId: string, sceneId: string, path: string, imageId?: string) => {
            const target = scene.presets.find(candidate => candidate.id === presetId)
                ?.scenes.find(candidate => candidate.id === sceneId)
            target?.images.push({ id: imageId, url: path })
        }),
    }
    const useGenerationStore = Object.assign(() => undefined, {
        getState: () => generation,
        setState: vi.fn((project: (state: typeof generation) => Partial<typeof generation>) => {
            Object.assign(generation, project(generation))
        }),
    })
    const useSceneStore = Object.assign(() => undefined, {
        getState: () => scene,
        setState: vi.fn((project: (state: typeof scene) => Partial<typeof scene>) => {
            Object.assign(scene, project(scene))
        }),
    })
    return {
        generation,
        scene,
        useGenerationStore,
        useSceneStore,
        settings: {
            useAbsoluteScenePath: true,
            metadataMode: 'sidecar-only' as const,
        },
        character: {
            vibeImages: [] as Array<{ id: string, encodedVibe?: string }>,
            updateVibeImage: vi.fn(),
        },
        getScenePresetPathSegments: vi.fn(() => ['Parent', 'Preset']),
        publishGeneratedArtifact: vi.fn(),
        toast: vi.fn(),
        translate: vi.fn((_key: string, fallback: string) => fallback),
    }
})

vi.mock('@/stores/generation-store', () => ({ useGenerationStore: runtime.useGenerationStore }))
vi.mock('@/stores/scene-store', () => ({
    useSceneStore: runtime.useSceneStore,
    getScenePresetPathSegments: runtime.getScenePresetPathSegments,
}))
vi.mock('@/stores/settings-store', () => ({
    useSettingsStore: { getState: () => runtime.settings },
}))
vi.mock('@/stores/character-store', () => ({
    useCharacterStore: { getState: () => runtime.character },
}))
vi.mock('@/stores/artifact-lifecycle-store', () => ({
    publishGeneratedArtifact: runtime.publishGeneratedArtifact,
}))
vi.mock('@/lib/toast', () => ({ toast: runtime.toast }))
vi.mock('@/i18n', () => ({ default: { t: runtime.translate } }))

import { createZustandSceneResultPresentation } from '@/presentation/scene/zustand-scene-result-presentation'

describe('Zustand Scene result presentation adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        runtime.generation.history = []
        runtime.scene.presets = [{
            id: 'preset-a',
            name: 'Preset',
            scenes: [{ id: 'scene-a', images: [] }],
        }]
        runtime.character.vibeImages = []
    })

    it('reads output defaults and projects a reversible Scene result', () => {
        const presentation = createZustandSceneResultPresentation()

        expect(presentation.readOutputDefaults('preset-a')).toEqual({
            useAbsoluteScenePath: true,
            metadataMode: 'sidecar-only',
            presetName: 'Preset',
            presetPathSegments: ['Parent', 'Preset'],
            fallbackPromptParts: {
                base: 'base',
                additional: 'additional',
                detail: 'detail',
                negative: 'negative',
                inpainting: 'inpaint',
            },
        })

        const historyId = '123_5000'
        presentation.commitResult({
            historyId,
            presetId: 'preset-a',
            sceneId: 'scene-a',
            path: 'NAI_Blue_Scene/result.png',
            thumbnail: 'data:image/png;base64,thumb',
            prompt: 'scene prompt',
            seed: 7,
            sourceJobId: 'job-a',
            sourceSceneId: 'scene-a',
            artifactId: 'artifact-a',
        })

        expect(runtime.generation.addToHistory).toHaveBeenCalledWith(expect.objectContaining({
            id: historyId,
            url: 'NAI_Blue_Scene/result.png',
            sourceJobId: 'job-a',
        }))
        expect(runtime.publishGeneratedArtifact).toHaveBeenCalledWith({
            path: 'NAI_Blue_Scene/result.png',
            artifactId: 'artifact-a',
            sourceJobId: 'job-a',
            sourceSceneId: 'scene-a',
        })
        expect(runtime.scene.addImageToScene).toHaveBeenCalledWith(
            'preset-a',
            'scene-a',
            'NAI_Blue_Scene/result.png',
            'artifact-a',
        )
        expect(runtime.scene.presets[0].scenes[0].images).toEqual([{
            id: 'artifact-a',
            url: 'NAI_Blue_Scene/result.png',
        }])

        presentation.rollbackResult({
            presetId: 'preset-a',
            sceneId: 'scene-a',
            path: 'NAI_Blue_Scene/result.png',
            historyId,
        })
        expect(runtime.scene.presets[0].scenes[0].images).toEqual([])
        expect(runtime.generation.history).toEqual([])
    })

    it('keeps notification and Vibe cache updates behind the same port', () => {
        runtime.character.vibeImages = [
            { id: 'cached', encodedVibe: 'existing' },
            { id: 'missing' },
        ]
        const presentation = createZustandSceneResultPresentation()

        presentation.reportCapabilityFallback('unsupported path', 'AppData')
        presentation.updateEncodedVibes(['encoded'])

        expect(runtime.toast).toHaveBeenCalledOnce()
        expect(runtime.character.updateVibeImage).toHaveBeenCalledWith('missing', {
            encodedVibe: 'encoded',
        })
    })
})
