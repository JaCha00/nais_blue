import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { rename, exists } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { useSettingsStore } from './settings-store'
import { getMediaStorageRoot, shouldUseAbsoluteMediaPath } from '@/platform/storage'
import type { CompositionPlanHash } from '@/domain/composition/canonical-serialize'
import type { CompositionEngineIssue } from '@/domain/composition/engine'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type {
    SceneCompositionMode,
    SceneCompositionRef,
} from '@/lib/composition/scene-adapter'
import { abortSceneSessionRequests } from '@/lib/scene-generation/request-cancellation'

export type { SceneCompositionMode, SceneCompositionRef } from '@/lib/composition/scene-adapter'

export interface SceneImage {
    id: string
    url: string  // data:image/png;base64,... format
    timestamp: number
    isFavorite: boolean
}

export interface SceneCard {
    id: string
    name: string
    scenePrompt: string
    queueCount: number  // Number of images to generate
    images: SceneImage[]  // Generated images for this scene
    width?: number
    height?: number
    excludePinned?: boolean // Rotation-only: skip pinned characters for this scene.
    compositionRef?: SceneCompositionRef
    createdAt: number
}

export interface SceneCompositionRuntimeRecord {
    mode: SceneCompositionMode
    planHash?: DeepReadonly<CompositionPlanHash>
    warnings: readonly DeepReadonly<CompositionEngineIssue>[]
    errors: readonly DeepReadonly<CompositionEngineIssue>[]
}

export function hasSceneCompositionOverrides(scene: Pick<SceneCard, 'scenePrompt' | 'width' | 'height' | 'compositionRef'>): boolean {
    const ref = scene.compositionRef
    return scene.scenePrompt.trim().length > 0
        || scene.width !== undefined
        || scene.height !== undefined
        || (ref?.sceneContributions?.length ?? 0) > 0
        || ref?.paramsOverride !== undefined
        || (ref?.characterOverrides?.length ?? 0) > 0
        || ref?.outputOverride !== undefined
}

export interface ScenePreset {
    id: string
    name: string
    scenes: SceneCard[]
    createdAt: number
}

interface SceneState {
    presets: ScenePreset[]
    activePresetId: string | null

    // Actions - Presets
    addPreset: (name: string) => void
    deletePreset: (id: string) => void
    renamePreset: (id: string, name: string) => void
    reorderPresets: (oldIndex: number, newIndex: number) => void
    setActivePreset: (id: string) => void
    getActivePreset: () => ScenePreset | undefined

    // Actions - Scenes
    addScene: (presetId: string, name?: string) => void
    deleteScene: (presetId: string, sceneId: string) => void
    duplicateScene: (presetId: string, sceneId: string) => void
    renameScene: (presetId: string, sceneId: string, name: string) => Promise<void>
    updateScenePrompt: (presetId: string, sceneId: string, prompt: string) => void
    updateSceneSettings: (presetId: string, sceneId: string, settings: { width?: number, height?: number, excludePinned?: boolean }) => void
    setSceneCompositionRef: (presetId: string, sceneId: string, ref: SceneCompositionRef | undefined) => void
    resetSceneToRecipe: (presetId: string, sceneId: string) => void
    updateAllScenesResolution: (presetId: string, width: number, height: number) => void
    reorderScenes: (presetId: string, scenes: SceneCard[]) => void
    getScene: (presetId: string, sceneId: string) => SceneCard | undefined

    // Actions - Queue
    setQueueCount: (presetId: string, sceneId: string, count: number) => void
    incrementQueue: (presetId: string, sceneId: string, count?: number) => void
    decrementQueue: (presetId: string, sceneId: string) => void
    addAllToQueue: (presetId: string, count?: number) => void
    clearAllQueue: (presetId: string) => void
    getTotalQueueCount: (presetId: string) => number
    getQueuedScenes: (presetId: string) => SceneCard[]

    // Actions - Images
    addImageToScene: (presetId: string, sceneId: string, imageUrl: string) => void
    toggleFavorite: (presetId: string, sceneId: string, imageId: string) => void
    deleteImage: (presetId: string, sceneId: string, imageId: string) => void
    deleteNonFavoriteImages: (presetId: string, sceneId: string) => { count: number; paths: string[] }
    clearAllFavorites: (presetId: string, sceneId: string) => number
    deleteAllImages: (presetId: string, sceneId: string) => { count: number; paths: string[] }
    getSceneThumbnail: (scene: SceneCard) => string | undefined

    // Actions - Generation
    decrementFirstQueuedScene: (presetId: string) => SceneCard | null

    // Generation Status
    isGenerating: boolean
    isCancelling: boolean  // True while active worker requests are aborting
    setIsGenerating: (isGenerating: boolean) => void
    cancelSceneGeneration: () => void  // Invalidates the session and aborts its active HTTP requests
    generationSessionId: number  // Incremented on each new generation session to invalidate old ones
    startNewGenerationSession: () => number  // Returns new session ID

    // Streaming State
    streamingSceneId: string | null
    streamingImage: string | null
    streamingProgress: number
    setStreamingData: (sceneId: string | null, image: string | null, progress: number) => void
    
    // Memory cleanup - call when leaving scene mode to release streaming data
    clearRuntimeData: () => void

    // History Refresh Trigger
    historyRefreshTrigger: number
    triggerHistoryRefresh: () => void

    // File Management
    importPreset: (preset: ScenePreset) => void
    validateSceneImages: (presetId: string, sceneId: string, validImageIds: string[]) => void

    // Multi-Select / Edit Mode
    isEditMode: boolean
    selectedSceneIds: string[]
    setEditMode: (isEdit: boolean) => void
    toggleSceneSelection: (sceneId: string, clearOthers?: boolean) => void
    selectSceneRange: (fromId: string, toId: string) => void
    selectAllScenes: () => void
    clearSelection: () => void
    deleteSelectedScenes: () => void
    moveSelectedScenesToPreset: (targetPresetId: string) => void
    updateSelectedScenesResolution: (width: number, height: number) => void
    applyRecipeToSelectedScenes: (
        recipeId: string,
        recipeRevision?: number,
        selectionKind?: SceneCompositionRef['selectionKind'],
    ) => void
    lastSelectedSceneId: string | null
    setLastSelectedSceneId: (id: string | null) => void

    // Composition v2 rollout and transient worker diagnostics
    sceneCompositionMode: SceneCompositionMode
    sceneCompositionResults: Record<string, SceneCompositionRuntimeRecord>
    setSceneCompositionMode: (mode: SceneCompositionMode) => void
    recordSceneCompositionResult: (sceneId: string, record: SceneCompositionRuntimeRecord) => void
    clearSceneCompositionResult: (sceneId: string) => void

    // Generation Progress
    completedCount: number
    totalQueuedCount: number
    setGenerationProgress: (completed: number, total: number) => void
    initGenerationProgress: () => void

    // Grid Layout
    gridColumns: number
    setGridColumns: (columns: number) => void
    thumbnailLayout: 'vertical' | 'horizontal'
    setThumbnailLayout: (layout: 'vertical' | 'horizontal') => void

    // Scroll Position (for returning from detail page)
    scrollPosition: number
    setScrollPosition: (position: number) => void
}

const DEFAULT_PRESET_ID = 'scene-default'

const createDefaultPreset = (): ScenePreset => ({
    id: DEFAULT_PRESET_ID,
    name: '기본',
    scenes: [],
    createdAt: Date.now(),
})

function withoutSceneCompositionResult(
    records: Record<string, SceneCompositionRuntimeRecord>,
    sceneId: string,
): Record<string, SceneCompositionRuntimeRecord> {
    if (!(sceneId in records)) return records
    const next = { ...records }
    delete next[sceneId]
    return next
}

function withoutSceneCompositionResults(
    records: Record<string, SceneCompositionRuntimeRecord>,
    sceneIds: readonly string[],
): Record<string, SceneCompositionRuntimeRecord> {
    if (!sceneIds.some(id => id in records)) return records
    const next = { ...records }
    sceneIds.forEach(id => delete next[id])
    return next
}

export const useSceneStore = create<SceneState>()(
    persist(
        (set, get) => ({
            presets: [createDefaultPreset()],
            activePresetId: DEFAULT_PRESET_ID,
            sceneCompositionMode: 'v2',
            sceneCompositionResults: {},
            setSceneCompositionMode: (sceneCompositionMode) => set({
                sceneCompositionMode,
                sceneCompositionResults: {},
            }),
            recordSceneCompositionResult: (sceneId, record) => set(state => ({
                sceneCompositionResults: {
                    ...state.sceneCompositionResults,
                    [sceneId]: {
                        ...record,
                        ...(record.planHash === undefined
                            ? {}
                            : { planHash: { ...record.planHash } }),
                        warnings: record.warnings.map(issue => ({
                            ...issue,
                            fieldPath: [...issue.fieldPath],
                        })),
                        errors: record.errors.map(issue => ({
                            ...issue,
                            fieldPath: [...issue.fieldPath],
                        })),
                    },
                },
            })),
            clearSceneCompositionResult: (sceneId) => set(state => ({
                sceneCompositionResults: withoutSceneCompositionResult(state.sceneCompositionResults, sceneId),
            })),

            // Preset Actions
            addPreset: (name) => {
                const newPreset: ScenePreset = {
                    id: Date.now().toString(),
                    name,
                    scenes: [],
                    createdAt: Date.now(),
                }
                set(state => ({
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id,
                }))
            },

            deletePreset: (id) => {
                if (id === DEFAULT_PRESET_ID) return
                const wasActive = get().activePresetId === id
                set(state => ({
                    presets: state.presets.filter(p => p.id !== id),
                    activePresetId: wasActive ? DEFAULT_PRESET_ID : state.activePresetId,
                }))
            },

            renamePreset: (id, name) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === id ? { ...p, name } : p
                    ),
                }))
            },

            reorderPresets: (oldIndex, newIndex) => {
                set(state => {
                    const newPresets = [...state.presets]
                    const [removed] = newPresets.splice(oldIndex, 1)
                    newPresets.splice(newIndex, 0, removed)
                    return { presets: newPresets }
                })
            },

            setActivePreset: (id) => set({ activePresetId: id }),

            getActivePreset: () => {
                return get().presets.find(p => p.id === get().activePresetId)
            },

            // Scene Actions
            addScene: (presetId, name) => {
                set(state => ({
                    presets: state.presets.map(p => {
                        if (p.id !== presetId) return p
                        const newScene: SceneCard = {
                            id: Date.now().toString(),
                            name: name || `씬 ${p.scenes.length + 1}`,
                            scenePrompt: '',
                            queueCount: 0,
                            images: [],
                            excludePinned: false,
                            createdAt: Date.now(),
                        }
                        return { ...p, scenes: [...p.scenes, newScene] }
                    }),
                }))
            },

            deleteScene: (presetId, sceneId) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? { ...p, scenes: p.scenes.filter(s => s.id !== sceneId) }
                            : p
                    ),
                    sceneCompositionResults: withoutSceneCompositionResult(state.sceneCompositionResults, sceneId),
                }))
            },

            duplicateScene: (presetId, sceneId) => {
                set(state => ({
                    presets: state.presets.map(p => {
                        if (p.id !== presetId) return p
                        const scene = p.scenes.find(s => s.id === sceneId)
                        if (!scene) return p
                        const duplicated: SceneCard = {
                            ...scene,
                            id: Date.now().toString(),
                            name: `${scene.name} (복사본)`,
                            queueCount: 0,
                            images: [],
                            createdAt: Date.now(),
                        }
                        const index = p.scenes.findIndex(s => s.id === sceneId)
                        const newScenes = [...p.scenes]
                        newScenes.splice(index + 1, 0, duplicated)
                        return { ...p, scenes: newScenes }
                    }),
                }))
            },

            renameScene: async (presetId, sceneId, name) => {
                const state = get()
                const preset = state.presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                
                if (!scene || scene.name === name) return
                
                const oldName = scene.name
                const safeOldName = oldName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Untitled_Scene'
                const safeNewName = name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Untitled_Scene'
                const safePresetName = (preset?.name || 'Default').replace(/[<>:"/\\|?*]/g, '_').trim()
                
                // B's rename behavior intentionally covers only the direct
                // preset/scene folder in this phase. Rotation character
                // subfolders are left untouched to avoid cross-character
                // collisions until a dedicated migration pass owns that scan.
                try {
                    const { sceneSavePath, useAbsoluteScenePath } = useSettingsStore.getState()
                    let oldFolderPath: string
                    let newFolderPath: string
                    
                    if (shouldUseAbsoluteMediaPath(useAbsoluteScenePath) && sceneSavePath) {
                        oldFolderPath = await join(sceneSavePath, safePresetName, safeOldName)
                        newFolderPath = await join(sceneSavePath, safePresetName, safeNewName)
                    } else {
                        const baseDir = await getMediaStorageRoot()
                        const sceneRoot = (sceneSavePath || 'NAIS_Scene').replace(/[<>:"/\\|?*]/g, '_').trim() || 'NAIS_Scene'
                        oldFolderPath = await join(baseDir, sceneRoot, safePresetName, safeOldName)
                        newFolderPath = await join(baseDir, sceneRoot, safePresetName, safeNewName)
                    }
                    
                    if (await exists(oldFolderPath) && !(await exists(newFolderPath))) {
                        await rename(oldFolderPath, newFolderPath)
                        set(state => ({
                            presets: state.presets.map(p =>
                                p.id === presetId
                                    ? {
                                        ...p,
                                        scenes: p.scenes.map(s =>
                                            s.id === sceneId 
                                                ? { 
                                                    ...s, 
                                                    name,
                                                    images: s.images.map(img => ({
                                                        ...img,
                                                        url: img.url.replace(oldFolderPath, newFolderPath)
                                                    }))
                                                } 
                                                : s
                                        ),
                                    }
                                    : p
                            ),
                        }))
                        return
                    }
                } catch (e) {
                    console.warn('Failed to rename scene folder:', e)
                }
                
                // Fallback: just update the name without folder rename
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId ? { ...s, name } : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            updateScenePrompt: (presetId, sceneId, prompt) => set((state) => ({
                presets: state.presets.map((preset) =>
                    preset.id === presetId
                        ? {
                            ...preset,
                            scenes: preset.scenes.map((scene) =>
                                scene.id === sceneId ? { ...scene, scenePrompt: prompt } : scene
                            ),
                        }
                        : preset
                ),
                sceneCompositionResults: withoutSceneCompositionResult(state.sceneCompositionResults, sceneId),
            })),
            updateSceneSettings: (presetId, sceneId, settings) => set((state) => ({
                presets: state.presets.map((preset) =>
                    preset.id === presetId
                        ? {
                            ...preset,
                            scenes: preset.scenes.map((scene) =>
                                scene.id === sceneId ? { ...scene, ...settings } : scene
                            ),
                        }
                        : preset
                ),
                sceneCompositionResults: withoutSceneCompositionResult(state.sceneCompositionResults, sceneId),
            })),
            setSceneCompositionRef: (presetId, sceneId, compositionRef) => set(state => ({
                presets: state.presets.map(preset => preset.id === presetId
                    ? {
                        ...preset,
                        scenes: preset.scenes.map(scene => scene.id === sceneId
                            ? {
                                ...scene,
                                ...(compositionRef === undefined ? { compositionRef: undefined } : { compositionRef }),
                            }
                            : scene),
                    }
                    : preset),
                sceneCompositionResults: withoutSceneCompositionResult(state.sceneCompositionResults, sceneId),
            })),
            resetSceneToRecipe: (presetId, sceneId) => set(state => ({
                presets: state.presets.map(preset => preset.id === presetId
                    ? {
                        ...preset,
                        scenes: preset.scenes.map(scene => {
                            if (scene.id !== sceneId) return scene
                            const { width: _width, height: _height, ...rest } = scene
                            const ref = scene.compositionRef
                            return {
                                ...rest,
                                scenePrompt: '',
                                ...(ref === undefined
                                    ? {}
                                    : {
                                        compositionRef: {
                                            recipeId: ref.recipeId,
                                            ...(ref.selectionKind === undefined ? {} : { selectionKind: ref.selectionKind }),
                                            ...(ref.recipeRevision === undefined ? {} : { recipeRevision: ref.recipeRevision }),
                                            ...(ref.migrationMarker === undefined ? {} : { migrationMarker: ref.migrationMarker }),
                                            ...(ref.extensions === undefined ? {} : { extensions: ref.extensions }),
                                        },
                                    }),
                            }
                        }),
                    }
                    : preset),
                sceneCompositionResults: withoutSceneCompositionResult(state.sceneCompositionResults, sceneId),
            })),
            updateAllScenesResolution: (presetId, width, height) => set((state) => ({
                presets: state.presets.map((preset) =>
                    preset.id === presetId
                        ? {
                            ...preset,
                            scenes: preset.scenes.map((scene) => ({
                                ...scene,
                                width,
                                height
                            })),
                        }
                        : preset
                ),
                sceneCompositionResults: withoutSceneCompositionResults(
                    state.sceneCompositionResults,
                    state.presets.find(preset => preset.id === presetId)?.scenes.map(scene => scene.id) ?? [],
                ),
            })),
            reorderScenes: (presetId, scenes) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId ? { ...p, scenes } : p
                    ),
                }))
            },

            getScene: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                return preset?.scenes.find(s => s.id === sceneId)
            },

            // Queue Actions
            setQueueCount: (presetId, sceneId, count) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId ? { ...s, queueCount: Math.max(0, count) } : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            incrementQueue: (presetId, sceneId, count = 1) => {
                const safeCount = Math.max(0, count)
                if (safeCount === 0) return

                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId ? { ...s, queueCount: s.queueCount + safeCount } : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            decrementQueue: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (scene && scene.queueCount > 0) {
                    get().setQueueCount(presetId, sceneId, scene.queueCount - 1)
                }
            },

            addAllToQueue: (presetId, count = 1) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s => ({ ...s, queueCount: s.queueCount + count })),
                            }
                            : p
                    ),
                }))
            },

            clearAllQueue: (presetId) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s => ({ ...s, queueCount: 0 })),
                            }
                            : p
                    ),
                }))
            },

            getTotalQueueCount: (presetId) => {
                const preset = get().presets.find(p => p.id === presetId)
                return preset?.scenes.reduce((sum, s) => sum + s.queueCount, 0) || 0
            },

            getQueuedScenes: (presetId) => {
                const preset = get().presets.find(p => p.id === presetId)
                return preset?.scenes.filter(s => s.queueCount > 0) || []
            },

            // Image Actions
            addImageToScene: (presetId, sceneId, imageUrl) => {
                const newImage: SceneImage = {
                    id: Date.now().toString(),
                    url: imageUrl,
                    timestamp: Date.now(),
                    isFavorite: false,
                }
                
                // MEMORY OPTIMIZATION: Increased limit for heavy users (was 100)
                const MAX_IMAGES_PER_SCENE = 2000
                
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s => {
                                    if (s.id !== sceneId) return s
                                    
                                    // Add new image at the beginning (newest first)
                                    let updatedImages = [newImage, ...s.images]
                                    
                                    // If over limit, remove oldest non-favorites
                                    if (updatedImages.length > MAX_IMAGES_PER_SCENE) {
                                        // Sort by timestamp descending to keep newest
                                        // Favorites are preserved separately
                                        const favorites = updatedImages.filter(img => img.isFavorite)
                                        const nonFavorites = updatedImages
                                            .filter(img => !img.isFavorite)
                                            .sort((a, b) => b.timestamp - a.timestamp)
                                        
                                        // Keep all favorites + newest non-favorites up to limit
                                        const keepCount = Math.max(0, MAX_IMAGES_PER_SCENE - favorites.length)
                                        // Merge back and sort by timestamp to maintain display order
                                        updatedImages = [...favorites, ...nonFavorites.slice(0, keepCount)]
                                            .sort((a, b) => b.timestamp - a.timestamp)
                                        
                                        console.warn(`[SceneStore] Scene ${s.name}: Trimmed to ${updatedImages.length} images (limit: ${MAX_IMAGES_PER_SCENE})`)
                                    }
                                    
                                    return { ...s, images: updatedImages }
                                }),
                            }
                            : p
                    ),
                }))
                // NOTE: Removed triggerHistoryRefresh() here.
                // HistoryPanel now uses the transient artifact lifecycle store,
                // so triggering a full directory rescan per image is no longer needed.
            },

            toggleFavorite: (presetId, sceneId, imageId) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? {
                                            ...s,
                                            images: s.images.map(img =>
                                                img.id === imageId
                                                    ? { ...img, isFavorite: !img.isFavorite }
                                                    : img
                                            ),
                                        }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            deleteImage: (presetId, sceneId, imageId) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: s.images.filter(img => img.id !== imageId) }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
            },

            deleteNonFavoriteImages: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (!scene) return { count: 0, paths: [] }
                
                const nonFavorites = scene.images.filter(img => !img.isFavorite)
                const nonFavoriteCount = nonFavorites.length
                // Collect file paths (non-base64 URLs) for deletion
                const filePaths = nonFavorites
                    .map(img => img.url)
                    .filter(url => !url.startsWith('data:'))
                
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: s.images.filter(img => img.isFavorite) }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
                
                return { count: nonFavoriteCount, paths: filePaths }
            },

            clearAllFavorites: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (!scene) return 0
                
                const favoriteCount = scene.images.filter(img => img.isFavorite).length
                
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? {
                                            ...s,
                                            images: s.images.map(img => ({ ...img, isFavorite: false })),
                                        }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
                
                return favoriteCount
            },

            deleteAllImages: (presetId, sceneId) => {
                const preset = get().presets.find(p => p.id === presetId)
                const scene = preset?.scenes.find(s => s.id === sceneId)
                if (!scene) return { count: 0, paths: [] }
                
                const totalCount = scene.images.length
                const filePaths = scene.images
                    .map(img => img.url)
                    .filter(url => !url.startsWith('data:'))
                
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: [] }
                                        : s
                                ),
                            }
                            : p
                    ),
                }))
                
                return { count: totalCount, paths: filePaths }
            },

            getSceneThumbnail: (scene) => {
                // Priority: favorite > newest
                const favorite = scene.images.find(img => img.isFavorite)
                if (favorite) return favorite.url
                if (scene.images.length > 0) return scene.images[0].url
                return undefined
            },

            // Generation Actions
            decrementFirstQueuedScene: (presetId) => {
                const preset = get().presets.find(p => p.id === presetId)
                if (!preset) return null

                const queuedScene = preset.scenes.find(s => s.queueCount > 0)
                if (!queuedScene) return null

                get().setQueueCount(presetId, queuedScene.id, queuedScene.queueCount - 1)
                return queuedScene
            },

            isGenerating: false,
            isCancelling: false,
            setIsGenerating: (isGenerating) => {
                // When stopping generation, increment session ID to invalidate any in-progress operations
                if (!isGenerating) {
                    set({ isGenerating: false, isCancelling: false, generationSessionId: Date.now() })
                } else {
                    set({ isGenerating: true, isCancelling: false })
                }
            },
            cancelSceneGeneration: () => {
                const cancelledSessionId = get().generationSessionId
                set({ isCancelling: true, generationSessionId: Date.now() })
                abortSceneSessionRequests(cancelledSessionId)
            },
            generationSessionId: 0,
            startNewGenerationSession: () => {
                const newSessionId = Date.now()
                set({
                    generationSessionId: newSessionId,
                    isGenerating: true,
                    isCancelling: false,
                    sceneCompositionResults: {},
                })
                return newSessionId
            },

            streamingSceneId: null,
            streamingImage: null,
            streamingProgress: 0,
            setStreamingData: (sceneId, image, progress) => {
                const currentSceneId = get().streamingSceneId
                // If sceneId changed, reset image to prevent showing previous scene's image
                if (sceneId !== currentSceneId) {
                    set({
                        streamingSceneId: sceneId,
                        streamingImage: image,
                        streamingProgress: progress
                    })
                } else {
                    // Same scene - if image is null, keep existing (progress-only update)
                    set({
                        streamingSceneId: sceneId,
                        streamingImage: image ?? get().streamingImage,
                        streamingProgress: progress
                    })
                }
            },

            // Memory cleanup - release streaming data when leaving scene mode
            // This prevents OOM when switching between modes (Issue #6)
            clearRuntimeData: () => {
                console.log('[SceneStore] Clearing runtime data to free memory')
                set({
                    streamingSceneId: null,
                    streamingImage: null,
                    streamingProgress: 0
                })
            },

            // History Refresh Trigger
            historyRefreshTrigger: 0,
            triggerHistoryRefresh: () => set(state => ({ historyRefreshTrigger: state.historyRefreshTrigger + 1 })),

            // File Management Actions
            importPreset: (jsonContent: any) => {
                set(state => {
                    let newName = "Imported Preset"
                    let newScenes: SceneCard[] = []

                    // 1. Detect Format

                    // Case A: Legacy Array Format (scene_preset_export.json)
                    if (Array.isArray(jsonContent)) {
                        newName = `Legacy Import ${new Date().toLocaleDateString()}`
                        newScenes = jsonContent.map((item: any) => ({
                            id: crypto.randomUUID(),
                            name: item.scene_name || "Untitled Scene",
                            scenePrompt: item.scene_prompt || "",
                            queueCount: 0,
                            images: [], // Legacy images not imported automatically
                            excludePinned: Boolean(item.excludePinned),
                            createdAt: Date.now()
                        }))
                    }
                    // Case B: Interaction Share Format (상호작용공유용.json) - New Logic
                    else if (jsonContent.scenes && !Array.isArray(jsonContent.scenes) && typeof jsonContent.scenes === 'object') {
                        newName = jsonContent.name || "Interaction Share"
                        const sceneMap = jsonContent.scenes

                        // Helper to generate prompt combinations
                        const generatePrompts = (slots: any[][]): string[] => {
                            if (slots.length === 0) return [""]

                            const firstSlot = slots[0] || []
                            // enabled 필드가 없으면 기본적으로 활성화된 것으로 간주
                            const enabledItems = firstSlot.filter((item: any) => item.enabled !== false)
                            const remainingPrompts = generatePrompts(slots.slice(1))

                            if (enabledItems.length === 0) return remainingPrompts

                            const results: string[] = []
                            for (const item of enabledItems) {
                                for (const nextPrompt of remainingPrompts) {
                                    const current = item.prompt || ""
                                    // simple join
                                    const combined = nextPrompt ? `${current}, ${nextPrompt}` : current
                                    results.push(combined)
                                }
                            }
                            return results
                        }

                        Object.values(sceneMap).forEach((sceneData: any) => {
                            if (sceneData.slots && Array.isArray(sceneData.slots)) {
                                const combinations = generatePrompts(sceneData.slots)
                                combinations.forEach((fullPrompt, index) => {
                                    // If there are multiple variations, append index to name
                                    const suffix = combinations.length > 1 ? `_${index + 1}` : ""

                                    newScenes.push({
                                        id: crypto.randomUUID(),
                                        name: (sceneData.name || "Untitled") + suffix,
                                        scenePrompt: fullPrompt,
                                        queueCount: 0,
                                        images: [],
                                        excludePinned: Boolean(sceneData.excludePinned),
                                        createdAt: Date.now()
                                    })
                                })
                            }
                        })
                    }
                    // Case C: SDImageGenEasy Presets (Fallback if 'scenes' object missing but has presets)
                    else if (jsonContent.presets && jsonContent.presets.SDImageGenEasy) {
                        // ... (Existing logic for SDImageGenEasy if needed, or remove if B covers it)
                        // Keeping it as fallback for files that might only have presets
                        newName = jsonContent.name || "Interaction Share (Presets)"
                        const presets = jsonContent.presets.SDImageGenEasy
                        if (Array.isArray(presets)) {
                            newScenes = presets.map((item: any) => {
                                const promptParts = []
                                if (item.frontPrompt) promptParts.push(item.frontPrompt)
                                if (item.backPrompt) promptParts.push(item.backPrompt)
                                return {
                                    id: crypto.randomUUID(),
                                    name: item.name || "Untitled",
                                    scenePrompt: promptParts.join(", "),
                                    queueCount: 0,
                                    images: [],
                                    excludePinned: Boolean(item.excludePinned),
                                    createdAt: Date.now()
                                }
                            })
                        }
                    }
                    // Case D: Standard ScenePreset Format (NAIS2)
                    else if (jsonContent.scenes && Array.isArray(jsonContent.scenes)) {
                        newName = jsonContent.name || "Use Preset"
                        newScenes = jsonContent.scenes.map((s: any) => ({
                            ...s,
                            id: s.id || crypto.randomUUID(), // Ensure ID exists
                            images: s.images || [],
                            excludePinned: Boolean(s.excludePinned)
                        }))
                        // If importing a full preset object, try to preserve its ID if unique, otherwise gen new
                        if (jsonContent.id && !state.presets.some(p => p.id === jsonContent.id)) {
                            // ID is unique, use it? No, safer to always generate new ID for imported stuff to avoid conflicts later
                        }
                    } else {
                        console.error("Unknown preset format", jsonContent)
                        return state // No change
                    }

                    if (newScenes.length === 0) {
                        console.warn("No scenes found in import")
                        return state
                    }

                    // Create the new preset
                    const newPreset: ScenePreset = {
                        id: Date.now().toString(), // Generate new ID
                        name: newName,
                        scenes: newScenes,
                        createdAt: Date.now()
                    }

                    // Check for name collision
                    let nameSuffix = 1
                    while (state.presets.some(p => p.name === newPreset.name)) {
                        newPreset.name = `${newName} (${nameSuffix++})`
                    }

                    return {
                        presets: [...state.presets, newPreset],
                        activePresetId: newPreset.id // Switch to imported preset
                    }
                })
            },

            exportPreset: () => {
                // Implementation moved to UI component (SceneMode.tsx) for file saving
            },

            validateSceneImages: (presetId, sceneId, validImageIds) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === presetId
                            ? {
                                ...p,
                                scenes: p.scenes.map(s =>
                                    s.id === sceneId
                                        ? { ...s, images: s.images.filter(img => validImageIds.includes(img.id)) }
                                        : s
                                )
                            }
                            : p
                    )
                }))
            },

            // Multi-Select / Edit Mode Implementation
            isEditMode: false,
            selectedSceneIds: [],
            lastSelectedSceneId: null,

            setEditMode: (isEdit) => set({
                isEditMode: isEdit,
                selectedSceneIds: isEdit ? [] : [],
                lastSelectedSceneId: null
            }),

            toggleSceneSelection: (sceneId, clearOthers = true) => set(state => {
                const isSelected = state.selectedSceneIds.includes(sceneId)
                let newSelection: string[]

                if (clearOthers) {
                    // Single click - toggle single selection
                    newSelection = isSelected ? [] : [sceneId]
                } else {
                    // Ctrl+click - toggle in multi-select
                    newSelection = isSelected
                        ? state.selectedSceneIds.filter(id => id !== sceneId)
                        : [...state.selectedSceneIds, sceneId]
                }

                return {
                    selectedSceneIds: newSelection,
                    lastSelectedSceneId: sceneId
                }
            }),

            selectSceneRange: (fromId, toId) => set(state => {
                const preset = state.presets.find(p => p.id === state.activePresetId)
                if (!preset) return state

                const fromIndex = preset.scenes.findIndex(s => s.id === fromId)
                const toIndex = preset.scenes.findIndex(s => s.id === toId)

                if (fromIndex === -1 || toIndex === -1) return state

                const start = Math.min(fromIndex, toIndex)
                const end = Math.max(fromIndex, toIndex)

                const rangeIds = preset.scenes.slice(start, end + 1).map(s => s.id)

                // Merge with existing selection
                const newSelection = [...new Set([...state.selectedSceneIds, ...rangeIds])]

                return {
                    selectedSceneIds: newSelection,
                    lastSelectedSceneId: toId
                }
            }),

            selectAllScenes: () => set(state => {
                const preset = state.presets.find(p => p.id === state.activePresetId)
                if (!preset) return state
                return { selectedSceneIds: preset.scenes.map(s => s.id) }
            }),

            clearSelection: () => set({ selectedSceneIds: [], lastSelectedSceneId: null }),

            setLastSelectedSceneId: (id) => set({ lastSelectedSceneId: id }),

            deleteSelectedScenes: () => set(state => {
                const preset = state.presets.find(p => p.id === state.activePresetId)
                if (!preset) return state

                return {
                    presets: state.presets.map(p =>
                        p.id === state.activePresetId
                            ? { ...p, scenes: p.scenes.filter(s => !state.selectedSceneIds.includes(s.id)) }
                            : p
                    ),
                    selectedSceneIds: [],
                    lastSelectedSceneId: null,
                    sceneCompositionResults: withoutSceneCompositionResults(
                        state.sceneCompositionResults,
                        state.selectedSceneIds,
                    ),
                }
            }),

            moveSelectedScenesToPreset: (targetPresetId) => set(state => {
                const sourcePreset = state.presets.find(p => p.id === state.activePresetId)
                if (!sourcePreset || targetPresetId === state.activePresetId) return state

                const scenesToMove = sourcePreset.scenes.filter(s => state.selectedSceneIds.includes(s.id))
                if (scenesToMove.length === 0) return state

                return {
                    presets: state.presets.map(p => {
                        if (p.id === state.activePresetId) {
                            // Remove from source
                            return { ...p, scenes: p.scenes.filter(s => !state.selectedSceneIds.includes(s.id)) }
                        }
                        if (p.id === targetPresetId) {
                            // Add to target
                            return { ...p, scenes: [...p.scenes, ...scenesToMove] }
                        }
                        return p
                    }),
                    selectedSceneIds: [],
                    lastSelectedSceneId: null
                }
            }),

            updateSelectedScenesResolution: (width, height) => set(state => ({
                presets: state.presets.map(p =>
                    p.id === state.activePresetId
                        ? {
                            ...p,
                            scenes: p.scenes.map(s =>
                                state.selectedSceneIds.includes(s.id)
                                    ? { ...s, width, height }
                                    : s
                            )
                        }
                        : p
                ),
                sceneCompositionResults: withoutSceneCompositionResults(
                    state.sceneCompositionResults,
                    state.selectedSceneIds,
                ),
            })),

            applyRecipeToSelectedScenes: (recipeId, recipeRevision, selectionKind = 'asset') => set(state => {
                if (!state.activePresetId || state.selectedSceneIds.length === 0) return state
                const selected = new Set(state.selectedSceneIds)
                return {
                    presets: state.presets.map(preset => preset.id === state.activePresetId
                        ? {
                            ...preset,
                            scenes: preset.scenes.map(scene => selected.has(scene.id)
                                ? {
                                    ...scene,
                                    compositionRef: {
                                        ...scene.compositionRef,
                                        recipeId,
                                        recipeRevision,
                                        selectionKind,
                                        migrationMarker: scene.compositionRef?.migrationMarker ?? {
                                            kind: 'legacy-scene-prompt' as const,
                                            schemaVersion: 2 as const,
                                        },
                                    },
                                }
                                : scene),
                        }
                        : preset),
                    sceneCompositionResults: withoutSceneCompositionResults(
                        state.sceneCompositionResults,
                        state.selectedSceneIds,
                    ),
                }
            }),

            // Generation Progress Implementation
            completedCount: 0,
            totalQueuedCount: 0,

            setGenerationProgress: (completed, total) => set({
                completedCount: completed,
                totalQueuedCount: total
            }),

            initGenerationProgress: () => set(state => {
                const total = state.activePresetId ? state.presets.find(p => p.id === state.activePresetId)?.scenes.reduce((sum, s) => sum + s.queueCount, 0) || 0 : 0
                return {
                    completedCount: 0,
                    totalQueuedCount: total
                }
            }),

            // Grid Layout
            gridColumns: 4,
            setGridColumns: (columns) => set({ gridColumns: columns }),
            thumbnailLayout: 'vertical' as const,
            setThumbnailLayout: (layout) => set({ thumbnailLayout: layout }),

            // Scroll Position
            scrollPosition: 0,
            setScrollPosition: (position) => set({ scrollPosition: position }),
        }),
        {
            name: 'nais2-scenes',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => {
                // Images are stored as file paths, not base64 - storage is minimal per entry
                const MAX_IMAGES_PERSIST = 2000

                return {
                    presets: state.presets.map(p => ({
                        ...p,
                        scenes: p.scenes.map(s => {
                            // Fast path: skip expensive sorting if under limit
                            if (s.images.length <= MAX_IMAGES_PERSIST) {
                                return { ...s, queueCount: 0 }
                            }
                            // Over limit: keep favorites + newest non-favorites
                            const favorites = s.images.filter(img => img.isFavorite)
                            const nonFavorites = s.images
                                .filter(img => !img.isFavorite)
                                .sort((a, b) => b.timestamp - a.timestamp)
                            const keepCount = Math.max(0, MAX_IMAGES_PERSIST - favorites.length)
                            return {
                                ...s,
                                queueCount: 0,
                                images: [...favorites, ...nonFavorites.slice(0, keepCount)]
                                    .sort((a, b) => b.timestamp - a.timestamp)
                            }
                        })
                    })),
                    activePresetId: state.activePresetId,
                    gridColumns: state.gridColumns,
                    thumbnailLayout: state.thumbnailLayout,
                    sceneCompositionMode: state.sceneCompositionMode,
                }
            },
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[SceneStore] Hydration failed:', error)
                    return
                }
                
                if (state) {
                    if (!['legacy', 'shadow', 'v2'].includes(state.sceneCompositionMode)) {
                        state.sceneCompositionMode = 'v2'
                    }
                    state.sceneCompositionResults = {}
                    // 복원 로그
                    const presetCount = state.presets?.length || 0
                    const totalScenes = state.presets?.reduce((sum, p) => sum + (p.scenes?.length || 0), 0) || 0
                    const totalImages = state.presets?.reduce((sum, p) => 
                        sum + p.scenes?.reduce((sSum, s) => sSum + (s.images?.length || 0), 0) || 0, 0) || 0
                    console.log(`[SceneStore] Hydrated: ${presetCount} presets, ${totalScenes} scenes, ${totalImages} images`)
                    
                    // MEMORY WARNING: Log if too many images
                    if (totalImages > 500) {
                        console.warn(`[SceneStore] Warning: ${totalImages} images loaded - consider clearing old images`)
                    }
                    
                    // 기본 프리셋 보장
                    if (!state.presets.find(p => p.id === DEFAULT_PRESET_ID)) {
                        console.log('[SceneStore] Adding default preset')
                        state.presets = [createDefaultPreset(), ...state.presets]
                    }
                    if (!state.activePresetId) {
                        state.activePresetId = DEFAULT_PRESET_ID
                    }

                    // Migration for pre-rotation scene records.
                    for (const preset of state.presets) {
                        for (const scene of preset.scenes || []) {
                            if (typeof scene.excludePinned !== 'boolean') {
                                scene.excludePinned = false
                            }
                        }
                    }
                    
                    // 씬 데이터 손실 경고
                    if (presetCount === 1 && totalScenes === 0) {
                        console.warn('[SceneStore] Warning: Only default preset with no scenes - possible data loss')
                    }
                }
            },
        }
    )
)
