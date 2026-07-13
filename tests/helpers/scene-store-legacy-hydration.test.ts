import { describe, expect, it, vi } from 'vitest'

const persistedSceneStorage = vi.hoisted(() => ({
    value: '',
}))

vi.mock('@/lib/indexed-db', () => ({
    indexedDBStorage: {
        getItem: async (name: string) => (
            name === 'nais2-scenes' ? persistedSceneStorage.value : null
        ),
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

describe('Scene store legacy persistence hydration', () => {
    it('hydrates a pre-composition SceneCard and defaults the missing rollout mode to v2', async () => {
        const oldScene = {
            id: 'scene:legacy-hydrated',
            name: 'Legacy hydrated scene',
            scenePrompt: 'legacy scene prompt',
            queueCount: 2,
            images: [{
                id: 'image:legacy',
                url: 'NAIS_Scene/legacy.png',
                timestamp: 1_700_000_000_000,
                isFavorite: true,
            }],
            width: 768,
            height: 1024,
            excludePinned: false,
            createdAt: 1_690_000_000_000,
        }
        persistedSceneStorage.value = JSON.stringify({
            state: {
                presets: [{
                    id: 'preset:legacy-hydrated',
                    name: 'Legacy hydrated preset',
                    scenes: [oldScene],
                    createdAt: 1_680_000_000_000,
                }],
                activePresetId: 'preset:legacy-hydrated',
                gridColumns: 3,
                thumbnailLayout: 'horizontal',
            },
            version: 0,
        })

        vi.resetModules()
        const { useSceneStore } = await import('@/stores/scene-store')
        await useSceneStore.persist.rehydrate()

        const state = useSceneStore.getState()
        const hydrated = state.getScene('preset:legacy-hydrated', 'scene:legacy-hydrated')

        expect(hydrated).toEqual(oldScene)
        expect(hydrated).not.toHaveProperty('compositionRef')
        expect(hydrated?.compositionRef).toBeUndefined()
        expect(state.activePresetId).toBe('preset:legacy-hydrated')
        expect(state.sceneCompositionMode).toBe('v2')
        expect(state.sceneCompositionResults).toEqual({})
    })
})
