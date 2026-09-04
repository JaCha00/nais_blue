import { describe, expect, it, vi } from 'vitest'

const persistedSceneStorage = vi.hoisted(() => ({
    value: '',
}))

vi.mock('@/lib/indexed-db', () => ({
    indexedDBStorage: {
        getItem: async (name: string) => (
            name === 'nai-blue-scenes' ? persistedSceneStorage.value : null
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

describe('Scene store legacy fallback projection', () => {
    it('restores a pre-composition SceneCard without reviving its transient queue', async () => {
        const oldScene = {
            id: 'scene:legacy-hydrated',
            name: 'Legacy hydrated scene',
            scenePrompt: 'legacy scene prompt',
            queueCount: 2,
            images: [{
                id: 'image:legacy',
                url: 'NAI_Blue_Scene/imported.png',
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
        const { applyLegacySceneProjection } = await import('@/lib/scene-authority-runtime')
        const { queueCount: _queueCount, ...legacyAuthoring } = oldScene
        applyLegacySceneProjection({
            presets: [{
                id: 'preset:legacy-hydrated',
                name: 'Legacy hydrated preset',
                scenes: [legacyAuthoring],
                createdAt: 1_680_000_000_000,
            }],
        })

        const state = useSceneStore.getState()
        const hydrated = state.getScene('preset:legacy-hydrated', 'scene:legacy-hydrated')

        expect(hydrated).toEqual({ ...legacyAuthoring, queueCount: 0, artifactRefs: [] })
        expect(hydrated).not.toHaveProperty('compositionRef')
        expect(hydrated?.compositionRef).toBeUndefined()
        expect(state.activePresetId).toBe('preset:legacy-hydrated')
        expect(state.sceneCompositionMode).toBe('v2')
        expect(state.sceneCompositionResults).toEqual({})
    })
})
