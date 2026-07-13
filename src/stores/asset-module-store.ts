import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import {
    runtimeCapabilities,
    UnsupportedRuntimeCapabilityError,
} from '@/platform/capabilities'
import {
    ASSET_PROFILE_FILE_PATH,
    loadAssetProfileFile,
    saveAssetProfileFile,
    watchAssetProfileFile,
    type SaveAssetProfileFileResult,
} from '@/services/asset-profile-file'
import {
    createDefaultAssetProfile,
    type AssetModuleProfile,
    type AssetProfile,
    type AssetProfileUpdatedBy,
    type AssetRecipe,
} from '@/types/asset-profile'

export const ASSET_MODULE_STORE_KEY = 'nais2-asset-modules'

interface AssetModuleStoreState {
    profile: AssetProfile
    sourcePath: string
    isLoading: boolean
    isSaving: boolean
    isWatchingDisk: boolean
    lastLoadedAt: string | null
    lastSavedAt: string | null
    lastDiskMtimeMs: number | null
    hasConflict: boolean
    conflictFilePath: string | null
    conflictMessage: string | null
    lastError: string | null

    reloadFromDisk: () => Promise<void>
    saveToDisk: (profile?: AssetProfile, updatedBy?: AssetProfileUpdatedBy) => Promise<SaveAssetProfileFileResult>
    replaceProfileDraft: (profile: AssetProfile) => void
    updateSettings: (settings: AssetProfile['settings']) => Promise<SaveAssetProfileFileResult>
    upsertModule: (module: AssetModuleProfile) => Promise<SaveAssetProfileFileResult>
    removeModule: (moduleId: string) => Promise<SaveAssetProfileFileResult>
    upsertRecipe: (recipe: AssetRecipe) => Promise<SaveAssetProfileFileResult>
    removeRecipe: (recipeId: string) => Promise<SaveAssetProfileFileResult>
    clearConflictWarning: () => void
    startDiskWatcher: () => void
    stopDiskWatcher: () => void
}

let stopAssetProfileWatcher: (() => void) | null = null

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function conflictMessage(result: Extract<SaveAssetProfileFileResult, { status: 'conflict' }>): string {
    return `Asset profile revision conflict: disk=${result.diskRevision}, store=${result.expectedRevision}. GUI changes were written to ${result.conflictPath}.`
}

export const useAssetModuleStore = create<AssetModuleStoreState>()(
    persist(
        (set, get) => ({
            profile: createDefaultAssetProfile(),
            sourcePath: ASSET_PROFILE_FILE_PATH,
            isLoading: false,
            isSaving: false,
            isWatchingDisk: false,
            lastLoadedAt: null,
            lastSavedAt: null,
            lastDiskMtimeMs: null,
            hasConflict: false,
            conflictFilePath: null,
            conflictMessage: null,
            lastError: null,

            reloadFromDisk: async () => {
                set({ isLoading: true, lastError: null })
                try {
                    const snapshot = await loadAssetProfileFile({ createIfMissing: true })
                    set({
                        profile: snapshot.profile,
                        sourcePath: snapshot.path,
                        lastLoadedAt: new Date().toISOString(),
                        lastDiskMtimeMs: snapshot.mtimeMs,
                        lastError: null,
                    })
                } catch (error) {
                    const message = errorMessage(error)
                    set({ lastError: message })
                    throw error
                } finally {
                    set({ isLoading: false })
                }
            },

            saveToDisk: async (profile = get().profile, updatedBy = 'gui') => {
                const expectedRevision = get().profile.revision
                set({ isSaving: true, lastError: null })

                try {
                    const result = await saveAssetProfileFile(profile, {
                        expectedRevision,
                        updatedBy,
                        path: get().sourcePath,
                    })

                    if (result.status === 'conflict') {
                        set({
                            profile: result.diskProfile,
                            hasConflict: true,
                            conflictFilePath: result.conflictPath,
                            conflictMessage: conflictMessage(result),
                            lastDiskMtimeMs: result.mtimeMs,
                            lastLoadedAt: new Date().toISOString(),
                        })
                        return result
                    }

                    set({
                        profile: result.profile,
                        sourcePath: result.path,
                        lastSavedAt: new Date().toISOString(),
                        lastDiskMtimeMs: result.mtimeMs,
                        lastError: null,
                    })
                    return result
                } catch (error) {
                    const message = errorMessage(error)
                    set({ lastError: message })
                    throw error
                } finally {
                    set({ isSaving: false })
                }
            },

            replaceProfileDraft: (profile) => set({ profile }),

            updateSettings: async (settings) => {
                const profile = get().profile
                return get().saveToDisk({
                    ...profile,
                    settings: {
                        ...profile.settings,
                        ...settings,
                    },
                })
            },

            upsertModule: async (module) => {
                const profile = get().profile
                return get().saveToDisk({
                    ...profile,
                    modules: {
                        ...profile.modules,
                        [module.id]: module,
                    },
                })
            },

            removeModule: async (moduleId) => {
                const profile = get().profile
                const modules = { ...profile.modules }
                delete modules[moduleId]
                return get().saveToDisk({
                    ...profile,
                    modules,
                })
            },

            upsertRecipe: async (recipe) => {
                const profile = get().profile
                const existingIndex = profile.recipes.findIndex(item => item.id === recipe.id)
                const recipes = existingIndex >= 0
                    ? profile.recipes.map(item => item.id === recipe.id ? recipe : item)
                    : [...profile.recipes, recipe]

                return get().saveToDisk({
                    ...profile,
                    recipes,
                })
            },

            removeRecipe: async (recipeId) => {
                const profile = get().profile
                return get().saveToDisk({
                    ...profile,
                    recipes: profile.recipes.filter(recipe => recipe.id !== recipeId),
                })
            },

            clearConflictWarning: () => set({
                hasConflict: false,
                conflictFilePath: null,
                conflictMessage: null,
            }),

            startDiskWatcher: () => {
                if (stopAssetProfileWatcher) return
                if (!runtimeCapabilities.externalProfileFileWatch.supported) {
                    set({
                        isWatchingDisk: false,
                        lastError: new UnsupportedRuntimeCapabilityError(
                            'externalProfileFileWatch',
                            runtimeCapabilities.externalProfileFileWatch,
                        ).message,
                    })
                    return
                }

                stopAssetProfileWatcher = watchAssetProfileFile(
                    async () => {
                        await get().reloadFromDisk()
                    },
                    {
                        path: get().sourcePath,
                        onError: (error) => set({ lastError: errorMessage(error) }),
                    },
                )
                set({ isWatchingDisk: true })
            },

            stopDiskWatcher: () => {
                stopAssetProfileWatcher?.()
                stopAssetProfileWatcher = null
                set({ isWatchingDisk: false })
            },
        }),
        {
            name: ASSET_MODULE_STORE_KEY,
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                profile: state.profile,
                sourcePath: state.sourcePath,
                // Session-only diagnostic. Persisting a new timestamp after
                // every startup makes the exact legacy migration source hash
                // change even when the profile itself is unchanged.
                lastSavedAt: state.lastSavedAt,
                lastDiskMtimeMs: state.lastDiskMtimeMs,
                hasConflict: state.hasConflict,
                conflictFilePath: state.conflictFilePath,
                conflictMessage: state.conflictMessage,
                lastError: state.lastError,
            }),
        },
    ),
)

export async function startAssetProfileDiskSync(): Promise<void> {
    await useAssetModuleStore.getState().reloadFromDisk()
    useAssetModuleStore.getState().startDiskWatcher()
}

export function stopAssetProfileDiskSync(): void {
    useAssetModuleStore.getState().stopDiskWatcher()
}
