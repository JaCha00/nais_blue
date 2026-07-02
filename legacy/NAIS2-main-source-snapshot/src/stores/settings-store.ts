import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

export interface CustomResolution {
    id: string
    label: string
    width: number
    height: number
}

interface SettingsState {
    // Save settings
    savePath: string
    useAbsolutePath: boolean  // If true, savePath is absolute path; if false, relative to Pictures folder
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

    // Actions
    setSavePath: (path: string, useAbsolute?: boolean) => void
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
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            savePath: 'NAIS_Output',
            useAbsolutePath: false,  // Default: relative to Pictures folder
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
            libraryPath: 'NAIS_Library', // Default: relative to Pictures folder
            useAbsoluteLibraryPath: false, // Default: relative to Pictures folder
            imageFormat: 'png', // Default: PNG format

            setSavePath: (savePath, useAbsolute) => set({
                savePath,
                useAbsolutePath: useAbsolute ?? false
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
        }),
        {
            name: 'nais2-settings',
            storage: createJSONStorage(() => indexedDBStorage),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[SettingsStore] Hydration failed:', error)
                    return
                }
                if (state) {
                    console.log('[SettingsStore] Hydrated successfully')
                }
            },
        }
    )
)
