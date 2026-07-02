import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { attachStoreBackup } from '@/lib/auto-backup'

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
    negativePromptCollapsed: boolean  // 네거티브 프롬프트 접기 상태

    // Generation settings
    useStreaming: boolean  // Use streaming API for image generation
    generationDelay: number  // Delay between batch generations in ms (0-5000)

    // Library settings
    libraryPath: string
    useAbsoluteLibraryPath: boolean

    // Actions
    setSavePath: (path: string, useAbsolute?: boolean) => void
    setAutoSave: (autoSave: boolean) => void
    addCustomResolution: (resolution: Omit<CustomResolution, 'id'>) => void
    removeCustomResolution: (id: string) => void
    setPromptFontSize: (size: number) => void
    setNegativePromptCollapsed: (collapsed: boolean) => void
    setUseStreaming: (useStreaming: boolean) => void
    setGenerationDelay: (delay: number) => void
    setLibraryPath: (path: string, useAbsolute?: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            savePath: 'NAIS_Output',
            useAbsolutePath: false,  // Default: relative to Pictures folder
            autoSave: true,
            customResolutions: [],
            promptFontSize: 16, // Default text-base equivalent approximately
            negativePromptCollapsed: false, // Default: expanded
            useStreaming: true, // Default: enabled
            generationDelay: 500, // Default: 500ms delay between batch generations
            libraryPath: 'NAIS_Library', // Default: relative to Pictures folder
            useAbsoluteLibraryPath: false, // Default: relative to Pictures folder

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
            setNegativePromptCollapsed: (collapsed) => set({ negativePromptCollapsed: collapsed }),
            setUseStreaming: (useStreaming) => set({ useStreaming }),
            setGenerationDelay: (delay) => set({ generationDelay: Math.max(0, Math.min(5000, delay)) }),
            setLibraryPath: (libraryPath, useAbsolute) => set({
                libraryPath,
                useAbsoluteLibraryPath: useAbsolute ?? false
            }),
        }),
        {
            name: 'nais2-settings',
        }
    )
)

attachStoreBackup(useSettingsStore as any, 'settings')
