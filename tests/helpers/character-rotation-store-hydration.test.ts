import { describe, expect, it, vi } from 'vitest'

const persistedRotation = vi.hoisted(() => ({ value: null as string | null }))

vi.mock('@/lib/indexed-db', () => ({
    indexedDBStorage: {
        getItem: async () => persistedRotation.value,
        setItem: async (_key: string, value: string) => {
            persistedRotation.value = value
        },
        removeItem: async () => undefined,
    },
}))

vi.mock('@/stores/scene-store', () => ({
    useSceneStore: Object.assign(() => undefined, {
        getState: () => ({
            activePresetId: null,
            presets: [],
            isGenerating: false,
            setIsGenerating: () => undefined,
        }),
        subscribe: () => () => undefined,
    }),
}))

vi.mock('@/stores/character-prompt-store', () => ({
    useCharacterPromptStore: Object.assign(() => undefined, {
        getState: () => ({ characters: [], toggleEnabled: () => undefined }),
        subscribe: () => () => undefined,
    }),
}))

vi.mock('@/stores/auth-store', () => ({
    useAuthStore: Object.assign(() => undefined, {
        getState: () => ({
            getActiveTokens: () => [],
            isSlotActive: () => false,
        }),
        subscribe: () => () => undefined,
    }),
}))

vi.mock('@/stores/generation-store', () => ({
    useGenerationStore: {
        getState: () => ({ generatingMode: null }),
    },
}))

vi.mock('@/components/ui/use-toast', () => ({ toast: () => undefined }))

describe('character rotation old-store hydration', () => {
    it('normalizes a pre-versioned runtime snapshot without restarting work or losing resume state', async () => {
        persistedRotation.value = JSON.stringify({
            version: 0,
            state: {
                active: true,
                awaitingWorker: true,
                characterIds: ['character:hero', 'character:rival'],
                pinnedCharacterIds: ['character:guide'],
                repeats: 2,
                restEnabled: false,
                workMinutes: 30,
                workJitterMinutes: 0,
                restMinutes: 15,
                restJitterMinutes: 0,
                currentIndex: 99,
                currentRepeat: 99,
                snapshot: {
                    presetId: 'preset:legacy-rotation',
                    queueCounts: { 'scene:one': 2 },
                    enabledStates: {
                        'character:hero': true,
                        'character:rival': false,
                    },
                },
            },
        })

        vi.resetModules()
        const {
            CHARACTER_ROTATION_STORE_VERSION,
            migrateRotationPersistedState,
            useRotationStore,
        } = await import('@/stores/character-rotation-store')
        await useRotationStore.persist.rehydrate()

        const state = useRotationStore.getState()
        expect(CHARACTER_ROTATION_STORE_VERSION).toBe(2)
        expect(state).toMatchObject({
            status: 'arming_pass',
            active: false,
            paused: false,
            awaitingWorker: false,
            resting: false,
            characterIds: ['character:hero', 'character:rival'],
            pinnedCharacterIds: ['character:guide'],
            repeats: 2,
            workJitterMinutes: 0,
            restJitterMinutes: 0,
            currentIndex: 1,
            currentRepeat: 1,
            snapshot: {
                presetId: 'preset:legacy-rotation',
                queueCounts: { 'scene:one': 2 },
            },
        })
        expect(state.workStartedAt).toBeNull()
        expect(state.nextWorkTargetMs).toBeNull()

        expect(migrateRotationPersistedState(null)).toMatchObject({
            status: 'idle',
            characterIds: [],
            pinnedCharacterIds: [],
            repeats: 1,
            snapshot: null,
        })
    })
})
