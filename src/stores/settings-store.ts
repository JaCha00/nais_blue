import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { DEFAULT_METADATA_MODE, type MetadataMode } from '@/lib/generation-metadata'
import {
    DEFAULT_GENERATION_FOLDER_ID,
    createDefaultGenerationFolder,
    generationFolderDescendantIds,
    isGenerationFolder,
    isGenerationFolderName,
    type GenerationFolder,
} from '@/domain/generation-folders'
import { isR2BucketName, normalizeR2Prefix } from '@/domain/r2/types'

export interface CustomResolution {
    id: string
    label: string
    width: number
    height: number
}

export interface GenerationFolderPatch {
    readonly name?: string
    readonly rootDirectory?: string | null
    readonly useAbsolutePath?: boolean
    readonly commonPrompt?: string
    readonly r2?: Partial<GenerationFolder['r2']>
}

interface AddGenerationFolderInput {
    readonly name: string
    readonly parentId?: string | null
    readonly rootDirectory?: string | null
    readonly useAbsolutePath?: boolean
}

export interface SettingsState {
    // Save settings
    savePath: string
    useAbsolutePath: boolean  // If true, savePath is absolute path; if false, relative to Pictures folder
    sceneSavePath: string
    useAbsoluteScenePath: boolean
    sceneSubfoldersEnabled: boolean
    styleLabSavePath: string
    useAbsoluteStyleLabPath: boolean
    toolsSavePath: string
    useAbsoluteToolsPath: boolean
    autoSave: boolean

    // Custom resolution presets
    customResolutions: CustomResolution[]

    // UI settings
    promptFontSize: number
    basePromptCollapsed: boolean  // 기본 프롬프트 접기 상태
    additionalPromptCollapsed: boolean  // 추가 프롬프트 접기 상태
    detailPromptCollapsed: boolean  // 세부 프롬프트 접기 상태
    negativePromptCollapsed: boolean  // 네거티브 프롬프트 접기 상태

    // Generation settings
    useStreaming: boolean  // Use streaming API for image generation
    generationDelay: number  // Delay between batch generations in ms (0-5000)

    // Gemini API settings
    geminiApiKey: string

    // Library settings
    libraryPath: string
    useAbsoluteLibraryPath: boolean

    // Image format setting
    imageFormat: 'png' | 'webp'
    metadataMode: MetadataMode
    productGuidanceVersion: number
    remoteImageProcessingConsentVersion: number

    // Output folders shared by Guided, Main, and Scene workflows.
    generationFolders: GenerationFolder[]
    activeGenerationFolderId: string

    // Actions
    setSavePath: (path: string, useAbsolute?: boolean) => void
    setSceneSavePath: (path: string, useAbsolute?: boolean) => void
    setSceneSubfoldersEnabled: (enabled: boolean) => void
    setStyleLabSavePath: (path: string, useAbsolute?: boolean) => void
    setToolsSavePath: (path: string, useAbsolute?: boolean) => void
    setAutoSave: (autoSave: boolean) => void
    addCustomResolution: (resolution: Omit<CustomResolution, 'id'>) => void
    removeCustomResolution: (id: string) => void
    setPromptFontSize: (size: number) => void
    setBasePromptCollapsed: (collapsed: boolean) => void
    setAdditionalPromptCollapsed: (collapsed: boolean) => void
    setDetailPromptCollapsed: (collapsed: boolean) => void
    setNegativePromptCollapsed: (collapsed: boolean) => void
    setUseStreaming: (useStreaming: boolean) => void
    setGenerationDelay: (delay: number) => void
    setGeminiApiKey: (key: string) => void
    setLibraryPath: (path: string, useAbsolute?: boolean) => void
    setImageFormat: (format: 'png' | 'webp') => void
    setMetadataMode: (mode: MetadataMode) => void
    setProductGuidanceVersion: (version: number) => void
    setRemoteImageProcessingConsentVersion: (version: number) => void
    addGenerationFolder: (input: AddGenerationFolderInput) => string
    updateGenerationFolder: (id: string, patch: GenerationFolderPatch) => void
    moveGenerationFolders: (ids: string[], parentId: string | null) => void
    deleteGenerationFolders: (ids: string[]) => void
    copyGenerationFolderPrompt: (sourceId: string, targetIds: string[]) => void
    setActiveGenerationFolder: (id: string) => void
}

function createGenerationFolderId(): string {
    return `generation-folder-${crypto.randomUUID()}`
}

function normalizeGenerationFolderPatch(folder: GenerationFolder, patch: GenerationFolderPatch): GenerationFolder {
    const name = patch.name?.trim() ?? folder.name
    if (!isGenerationFolderName(name)) throw new TypeError('Generation folder name is invalid')
    const commonPrompt = patch.commonPrompt ?? folder.commonPrompt
    if (commonPrompt.length > 20_000) throw new TypeError('Generation folder prompt is too long')
    const bucket = patch.r2?.bucket === undefined ? folder.r2.bucket : patch.r2.bucket?.trim() || null
    if (bucket !== null && !isR2BucketName(bucket)) throw new TypeError('R2 bucket name is invalid')
    const prefix = patch.r2?.prefix === undefined ? folder.r2.prefix : normalizeR2Prefix(patch.r2.prefix)
    const rootDirectory = folder.parentId === null
        ? patch.rootDirectory === undefined
            ? folder.rootDirectory
            : patch.rootDirectory?.trim() || null
        : null
    return {
        ...folder,
        name,
        rootDirectory,
        useAbsolutePath: folder.parentId === null
            ? patch.useAbsolutePath ?? folder.useAbsolutePath
            : false,
        commonPrompt,
        r2: {
            autoUpload: patch.r2?.autoUpload ?? folder.r2.autoUpload,
            bucket,
            prefix,
        },
        updatedAt: new Date().toISOString(),
    }
}

const SETTINGS_PERSIST_VERSION = 1

/**
 * Reconciles the legacy savePath authority with the shared folder model before
 * Zustand exposes hydrated settings. This preserves custom drives across app
 * updates and supplies new settings without overwriting explicit old values.
 */
export function normalizePersistedSettingsState(persistedState: unknown): Partial<SettingsState> {
    const persisted = typeof persistedState === 'object' && persistedState !== null && !Array.isArray(persistedState)
        ? persistedState as Partial<SettingsState>
        : {}
    const savePath = typeof persisted.savePath === 'string' && persisted.savePath.trim()
        ? persisted.savePath
        : 'NAI_Blue_Output'
    const useAbsolutePath = typeof persisted.useAbsolutePath === 'boolean'
        ? persisted.useAbsolutePath
        : false
    const validFolders = Array.isArray(persisted.generationFolders)
        ? persisted.generationFolders.filter(isGenerationFolder)
        : []
    const hasDefaultFolder = validFolders.some(folder => folder.id === DEFAULT_GENERATION_FOLDER_ID)
    const generationFolders = (hasDefaultFolder
        ? validFolders
        : [createDefaultGenerationFolder(savePath, useAbsolutePath), ...validFolders])
        .map(folder => folder.id === DEFAULT_GENERATION_FOLDER_ID
            ? {
                ...folder,
                rootDirectory: savePath,
                useAbsolutePath,
            }
            : folder)
    const activeGenerationFolderId = typeof persisted.activeGenerationFolderId === 'string'
        && generationFolders.some(folder => folder.id === persisted.activeGenerationFolderId)
        ? persisted.activeGenerationFolderId
        : DEFAULT_GENERATION_FOLDER_ID

    return {
        ...persisted,
        savePath,
        useAbsolutePath,
        sceneSubfoldersEnabled: typeof persisted.sceneSubfoldersEnabled === 'boolean'
            ? persisted.sceneSubfoldersEnabled
            : true,
        generationFolders,
        activeGenerationFolderId,
    }
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            savePath: 'NAI_Blue_Output',
            useAbsolutePath: false,  // Default: relative to Pictures folder
            sceneSavePath: 'NAI_Blue_Scene',
            useAbsoluteScenePath: false,
            sceneSubfoldersEnabled: true,
            styleLabSavePath: 'nai-blue-style',
            useAbsoluteStyleLabPath: false,
            toolsSavePath: 'nai-blue-tools',
            useAbsoluteToolsPath: false,
            autoSave: true,
            customResolutions: [],
            promptFontSize: 16, // Default text-base equivalent approximately
            basePromptCollapsed: false, // Default: expanded
            additionalPromptCollapsed: false, // Default: expanded
            detailPromptCollapsed: false, // Default: expanded
            negativePromptCollapsed: false, // Default: expanded
            useStreaming: true, // Default: enabled
            generationDelay: 500, // Default: 500ms delay between batch generations
            geminiApiKey: '', // Default: empty
            libraryPath: 'NAI_Blue_Library', // Default: relative to Pictures folder
            useAbsoluteLibraryPath: false, // Default: relative to Pictures folder
            imageFormat: 'png', // Default: PNG format
            metadataMode: DEFAULT_METADATA_MODE,
            productGuidanceVersion: 0,
            remoteImageProcessingConsentVersion: 0,
            generationFolders: [createDefaultGenerationFolder()],
            activeGenerationFolderId: DEFAULT_GENERATION_FOLDER_ID,

            setSavePath: (savePath, useAbsolute) => set(state => ({
                savePath,
                useAbsolutePath: useAbsolute ?? false,
                generationFolders: state.generationFolders.map(folder => folder.id === DEFAULT_GENERATION_FOLDER_ID
                    ? normalizeGenerationFolderPatch(folder, {
                        rootDirectory: savePath,
                        useAbsolutePath: useAbsolute ?? false,
                    })
                    : folder),
            })),
            setSceneSavePath: (sceneSavePath, useAbsolute) => set({
                sceneSavePath,
                useAbsoluteScenePath: useAbsolute ?? false
            }),
            setSceneSubfoldersEnabled: (sceneSubfoldersEnabled) => set({ sceneSubfoldersEnabled }),
            setStyleLabSavePath: (styleLabSavePath, useAbsolute) => set({
                styleLabSavePath,
                useAbsoluteStyleLabPath: useAbsolute ?? false
            }),
            setToolsSavePath: (toolsSavePath, useAbsolute) => set({
                toolsSavePath,
                useAbsoluteToolsPath: useAbsolute ?? false
            }),
            setAutoSave: (autoSave) => set({ autoSave }),

            addCustomResolution: (resolution) => set((state) => ({
                customResolutions: [
                    ...state.customResolutions,
                    { ...resolution, id: Date.now().toString() }
                ]
            })),

            removeCustomResolution: (id) => set((state) => ({
                customResolutions: state.customResolutions.filter(r => r.id !== id)
            })),
            setPromptFontSize: (size) => set({ promptFontSize: size }),
            setBasePromptCollapsed: (collapsed) => set({ basePromptCollapsed: collapsed }),
            setAdditionalPromptCollapsed: (collapsed) => set({ additionalPromptCollapsed: collapsed }),
            setDetailPromptCollapsed: (collapsed) => set({ detailPromptCollapsed: collapsed }),
            setNegativePromptCollapsed: (collapsed) => set({ negativePromptCollapsed: collapsed }),
            setUseStreaming: (useStreaming) => set({ useStreaming }),
            setGenerationDelay: (delay) => set({ generationDelay: Math.max(0, Math.min(5000, delay)) }),
            setGeminiApiKey: (key) => set({ geminiApiKey: key }),
            setLibraryPath: (libraryPath, useAbsolute) => set({
                libraryPath,
                useAbsoluteLibraryPath: useAbsolute ?? false
            }),
            setImageFormat: (format) => set({ imageFormat: format }),
            setMetadataMode: (metadataMode) => set({ metadataMode }),
            setProductGuidanceVersion: (productGuidanceVersion) => set({ productGuidanceVersion }),
            setRemoteImageProcessingConsentVersion: (remoteImageProcessingConsentVersion) => set({
                remoteImageProcessingConsentVersion: Math.max(0, Math.trunc(remoteImageProcessingConsentVersion)),
            }),
            addGenerationFolder: input => {
                const name = input.name.trim()
                if (!isGenerationFolderName(name)) throw new TypeError('Generation folder name is invalid')
                const state = useSettingsStore.getState()
                const parentId = input.parentId ?? null
                if (parentId !== null && !state.generationFolders.some(folder => folder.id === parentId)) {
                    throw new TypeError('Generation folder parent does not exist')
                }
                const now = new Date().toISOString()
                const id = createGenerationFolderId()
                const folder: GenerationFolder = {
                    schemaVersion: 1,
                    id,
                    name,
                    parentId,
                    rootDirectory: parentId === null
                        ? input.rootDirectory?.trim() || name
                        : null,
                    useAbsolutePath: parentId === null && input.useAbsolutePath === true,
                    commonPrompt: '',
                    r2: { autoUpload: false, bucket: null, prefix: null },
                    createdAt: now,
                    updatedAt: now,
                }
                set(current => ({
                    generationFolders: [...current.generationFolders, folder],
                    activeGenerationFolderId: id,
                }))
                return id
            },
            updateGenerationFolder: (id, patch) => set(state => {
                const generationFolders = state.generationFolders.map(folder => folder.id === id
                    ? normalizeGenerationFolderPatch(folder, patch)
                    : folder)
                const updated = generationFolders.find(folder => folder.id === id)
                return {
                    generationFolders,
                    ...(id === DEFAULT_GENERATION_FOLDER_ID && updated
                        ? {
                            savePath: updated.rootDirectory ?? state.savePath,
                            useAbsolutePath: updated.useAbsolutePath,
                        }
                        : {}),
                }
            }),
            moveGenerationFolders: (ids, parentId) => set(state => {
                const selected = new Set(ids.filter(id => id !== DEFAULT_GENERATION_FOLDER_ID))
                if (selected.size === 0) return state
                if (parentId !== null && !state.generationFolders.some(folder => folder.id === parentId)) return state
                const blockedTargets = new Set(selected)
                for (const id of selected) {
                    generationFolderDescendantIds(state.generationFolders, id).forEach(child => blockedTargets.add(child))
                }
                if (parentId !== null && blockedTargets.has(parentId)) return state
                return {
                    generationFolders: state.generationFolders.map(folder => selected.has(folder.id)
                        ? {
                            ...folder,
                            parentId,
                            rootDirectory: parentId === null ? folder.rootDirectory ?? folder.name : null,
                            useAbsolutePath: parentId === null && folder.useAbsolutePath,
                            updatedAt: new Date().toISOString(),
                        }
                        : folder),
                }
            }),
            deleteGenerationFolders: ids => set(state => {
                const deleted = new Set(ids.filter(id => id !== DEFAULT_GENERATION_FOLDER_ID))
                for (const id of [...deleted]) {
                    generationFolderDescendantIds(state.generationFolders, id).forEach(child => deleted.add(child))
                }
                if (deleted.size === 0) return state
                return {
                    generationFolders: state.generationFolders.filter(folder => !deleted.has(folder.id)),
                    activeGenerationFolderId: deleted.has(state.activeGenerationFolderId)
                        ? DEFAULT_GENERATION_FOLDER_ID
                        : state.activeGenerationFolderId,
                }
            }),
            copyGenerationFolderPrompt: (sourceId, targetIds) => set(state => {
                const prompt = state.generationFolders.find(folder => folder.id === sourceId)?.commonPrompt
                if (prompt === undefined) return state
                const targets = new Set(targetIds.filter(id => id !== sourceId))
                const now = new Date().toISOString()
                return {
                    generationFolders: state.generationFolders.map(folder => targets.has(folder.id)
                        ? { ...folder, commonPrompt: prompt, updatedAt: now }
                        : folder),
                }
            }),
            setActiveGenerationFolder: id => set(state => state.generationFolders.some(folder => folder.id === id)
                ? { activeGenerationFolderId: id }
                : state),
        }),
        {
            name: 'nai-blue-settings',
            storage: createJSONStorage(() => indexedDBStorage),
            version: SETTINGS_PERSIST_VERSION,
            migrate: persistedState => normalizePersistedSettingsState(persistedState) as SettingsState,
            merge: (persistedState, currentState) => ({
                ...currentState,
                ...normalizePersistedSettingsState(persistedState),
            }),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[SettingsStore] Hydration failed:', error)
                    return
                }
                if (state) console.log('[SettingsStore] Hydrated successfully')
            },
        }
    )
)
