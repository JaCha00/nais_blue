import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getScenePresetPathSegments, useSceneStore, type SceneCard, type ScenePreset } from '@/stores/scene-store'

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

const sourceScene: SceneCard = {
    id: 'scene:source',
    name: 'Source metadata',
    scenePrompt: 'legacy additional',
    prompts: {
        base: 'base',
        additional: 'additional',
        character: 'character',
        negative: 'negative',
        characterNegative: 'character negative',
    },
    generation: {
        model: 'nai-diffusion-4-5-full',
        steps: 35,
        cfgScale: 6,
        cfgRescale: 0.2,
        sampler: 'k_euler_ancestral',
        scheduler: 'karras',
        smea: false,
        smeaDyn: false,
        variety: true,
        qualityToggle: true,
        ucPreset: 1,
        seed: 123,
        seedLocked: true,
    },
    width: 1024,
    height: 1024,
    metadataMode: 'strip-only',
    queueCount: 4,
    images: [{ id: 'image:1', url: 'source.png', timestamp: 1, isFavorite: true }],
    createdAt: 1,
}

const folders: ScenePreset[] = [
    { id: 'folder:source', name: 'Source', parentId: null, scenes: [sourceScene], createdAt: 1 },
    { id: 'folder:parent', name: 'Parent', parentId: null, scenes: [], createdAt: 2 },
    { id: 'folder:target', name: 'Target', parentId: 'folder:parent', scenes: [], createdAt: 3 },
]

beforeEach(() => {
    useSceneStore.setState({
        presets: structuredClone(folders),
        activePresetId: 'folder:source',
        selectedSceneIds: [],
        sceneCompositionResults: {},
    })
})

describe('Scene folder management', () => {
    it('copies a complete Scene snapshot as a folder default and opens clean new Scene state', () => {
        const store = useSceneStore.getState()
        store.setPresetDefaultFromScene(['folder:target'], 'folder:source', 'scene:source')
        const newId = store.addScene('folder:target', 'Created from default')
        const created = useSceneStore.getState().getScene('folder:target', newId)

        expect(created).toMatchObject({
            name: 'Created from default',
            prompts: sourceScene.prompts,
            generation: sourceScene.generation,
            width: 1024,
            height: 1024,
            metadataMode: 'strip-only',
            queueCount: 0,
            images: [],
        })
        expect(created?.id).not.toBe(sourceScene.id)
        expect(created?.prompts).not.toBe(sourceScene.prompts)
        expect(created?.generation).not.toBe(sourceScene.generation)
    })

    it('resolves nested output paths and rejects a move into its own descendant', () => {
        expect(getScenePresetPathSegments(useSceneStore.getState().presets, 'folder:target'))
            .toEqual(['Parent', 'Target'])

        useSceneStore.getState().movePresets(['folder:parent'], 'folder:target')
        expect(useSceneStore.getState().presets.find(folder => folder.id === 'folder:parent')?.parentId).toBeNull()
    })

    it('duplicates a selected branch and removes descendants with their parent', () => {
        useSceneStore.getState().duplicatePresets(['folder:parent', 'folder:target'])
        const clonedParent = useSceneStore.getState().presets.find(folder => folder.name === 'Parent (복사본)')
        expect(clonedParent).toBeDefined()
        expect(useSceneStore.getState().presets.filter(folder => folder.parentId === clonedParent?.id)).toHaveLength(1)

        useSceneStore.getState().deletePreset('folder:parent')
        const remainingIds = useSceneStore.getState().presets.map(folder => folder.id)
        expect(remainingIds).not.toContain('folder:parent')
        expect(remainingIds).not.toContain('folder:target')
    })
})
