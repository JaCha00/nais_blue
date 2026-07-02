import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useGenerationStore } from './generation-store'
import { indexedDBStorage } from '@/lib/indexed-db'

export const DEFAULT_PRESET_ID = 'default'

export interface Preset {
    id: string
    name: string
    createdAt: number
    isDefault?: boolean // Cannot be deleted

    // Prompts
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    negativePrompt: string

    // Model & Settings
    model: string
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smeaDyn: boolean
    variety: boolean

    // Quality & UC
    qualityToggle: boolean
    ucPreset: number

    // Resolution
    selectedResolution: {
        label: string
        width: number
        height: number
    }
}

const createDefaultPreset = (): Preset => ({
    id: DEFAULT_PRESET_ID,
    name: '기본',
    createdAt: 0,
    isDefault: true,
    basePrompt: '',
    additionalPrompt: '',
    detailPrompt: '',
    negativePrompt: '',
    model: 'nai-diffusion-4-5-full',
    steps: 28,
    cfgScale: 5.0,
    cfgRescale: 0.0,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    smea: true,
    smeaDyn: true,
    variety: false,
    qualityToggle: true,
    ucPreset: 0,
    selectedResolution: { label: 'Portrait', width: 832, height: 1216 },
})

interface PresetState {
    presets: Preset[]
    activePresetId: string

    // Actions
    addPreset: (name: string) => void
    duplicatePreset: (id: string) => void
    deletePreset: (id: string) => void
    syncFromGenerationStore: () => void
    loadPreset: (id: string) => void
    renamePreset: (id: string, name: string) => void
    reorderPresets: (oldIndex: number, newIndex: number) => void
    getActivePreset: () => Preset | undefined
}

export const usePresetStore = create<PresetState>()(
    persist(
        (set, get) => ({
            presets: [createDefaultPreset()],
            activePresetId: DEFAULT_PRESET_ID,

            addPreset: (name) => {
                // First sync current state to active preset
                get().syncFromGenerationStore()

                const newPreset: Preset = {
                    id: Date.now().toString(),
                    name,
                    createdAt: Date.now(),
                    // Blank values for new preset
                    basePrompt: '',
                    additionalPrompt: '',
                    detailPrompt: '',
                    negativePrompt: '',
                    model: 'nai-diffusion-4-5-full',
                    steps: 28,
                    cfgScale: 5.0,
                    cfgRescale: 0.0,
                    sampler: 'k_euler_ancestral',
                    scheduler: 'karras',
                    smea: true,
                    smeaDyn: true,
                    variety: false,
                    qualityToggle: true,
                    ucPreset: 0,
                    selectedResolution: { label: 'Portrait', width: 832, height: 1216 },
                }

                set(state => ({
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id
                }))

                // Apply blank preset to generation store
                const genStore = useGenerationStore.getState()
                genStore.setBasePrompt('')
                genStore.setAdditionalPrompt('')
                genStore.setDetailPrompt('')
                genStore.setNegativePrompt('')
                genStore.setModel('nai-diffusion-4-5-full')
                genStore.setSteps(28)
                genStore.setCfgScale(5.0)
                genStore.setCfgRescale(0.0)
                genStore.setSampler('k_euler_ancestral')
                genStore.setScheduler('karras')
                genStore.setSmea(true)
                genStore.setSmeaDyn(true)
                genStore.setVariety(false)
                genStore.setQualityToggle(true)
                genStore.setUcPreset(0)
                genStore.setSelectedResolution({ label: 'Portrait', width: 832, height: 1216 })
            },

            duplicatePreset: (id) => {
                // First sync current state to active preset
                get().syncFromGenerationStore()

                const source = get().presets.find(p => p.id === id)
                if (!source) return

                const newPreset: Preset = {
                    ...source,
                    id: Date.now().toString(),
                    name: `${source.isDefault ? '기본' : source.name} (복사)`,
                    createdAt: Date.now(),
                    isDefault: undefined,
                }

                set(state => ({
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id
                }))

                // Apply duplicated preset to generation store
                useGenerationStore.getState().applyPreset(newPreset)
            },

            deletePreset: (id) => {
                // Cannot delete default preset
                const preset = get().presets.find(p => p.id === id)
                if (preset?.isDefault) return

                const wasActive = get().activePresetId === id

                set(state => ({
                    presets: state.presets.filter(p => p.id !== id),
                    activePresetId: wasActive ? DEFAULT_PRESET_ID : state.activePresetId
                }))

                // If deleted active, load default
                if (wasActive) {
                    get().loadPreset(DEFAULT_PRESET_ID)
                }
            },

            // Sync current generation-store values to active preset
            syncFromGenerationStore: () => {
                const activeId = get().activePresetId
                if (!activeId) return

                const genStore = useGenerationStore.getState()

                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === activeId
                            ? {
                                ...p,
                                basePrompt: genStore.basePrompt,
                                additionalPrompt: genStore.additionalPrompt,
                                detailPrompt: genStore.detailPrompt,
                                negativePrompt: genStore.negativePrompt,
                                model: genStore.model,
                                steps: genStore.steps,
                                cfgScale: genStore.cfgScale,
                                cfgRescale: genStore.cfgRescale,
                                sampler: genStore.sampler,
                                scheduler: genStore.scheduler,
                                smea: genStore.smea,
                                smeaDyn: genStore.smeaDyn,
                                variety: genStore.variety,
                                qualityToggle: genStore.qualityToggle,
                                ucPreset: genStore.ucPreset,
                                selectedResolution: genStore.selectedResolution,
                            }
                            : p
                    )
                }))
            },

            loadPreset: (id) => {
                // First sync current state before switching
                if (get().activePresetId !== id) {
                    get().syncFromGenerationStore()
                }

                const preset = get().presets.find(p => p.id === id)
                if (!preset) return

                // Set active preset
                set({ activePresetId: id })

                // Load preset values into generation store (single batch update)
                useGenerationStore.getState().applyPreset(preset)
            },

            renamePreset: (id, name) => {
                // Cannot rename default preset
                const preset = get().presets.find(p => p.id === id)
                if (preset?.isDefault) return

                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === id ? { ...p, name } : p
                    )
                }))
            },

            reorderPresets: (oldIndex, newIndex) => {
                // Don't allow reordering if involving the default preset at index 0
                if (oldIndex === 0 || newIndex === 0) return

                set(state => {
                    const newPresets = [...state.presets]
                    const [removed] = newPresets.splice(oldIndex, 1)
                    newPresets.splice(newIndex, 0, removed)
                    return { presets: newPresets }
                })
            },

            getActivePreset: () => {
                return get().presets.find(p => p.id === get().activePresetId)
            },
        }),
        {
            name: 'nais2-presets',
            storage: createJSONStorage(() => indexedDBStorage),
            // Ensure default preset exists and migrate old presets missing new fields
            onRehydrateStorage: () => (state) => {
                if (state && !state.presets.find(p => p.id === DEFAULT_PRESET_ID)) {
                    state.presets = [createDefaultPreset(), ...state.presets]
                }
                if (state && !state.activePresetId) {
                    state.activePresetId = DEFAULT_PRESET_ID
                }
                // Migrate old presets missing variety/qualityToggle/ucPreset fields
                if (state) {
                    state.presets = state.presets.map(p => ({
                        ...p,
                        variety: p.variety ?? false,
                        qualityToggle: p.qualityToggle ?? true,
                        ucPreset: p.ucPreset ?? 0,
                    }))
                }
            }
        }
    )
)

// ============================================
// Debounced Auto-Sync: generation-store → active preset
// ============================================

let syncTimeout: ReturnType<typeof setTimeout> | null = null
let isLoadingPreset = false

// Subscribe to generation-store changes
useGenerationStore.subscribe((state, prevState) => {
    if (isLoadingPreset) return

    const fieldsToWatch = [
        'basePrompt', 'additionalPrompt', 'detailPrompt', 'negativePrompt',
        'model', 'steps', 'cfgScale', 'cfgRescale',
        'sampler', 'scheduler', 'smea', 'smeaDyn', 'variety',
        'qualityToggle', 'ucPreset', 'selectedResolution'
    ] as const

    const hasChange = fieldsToWatch.some(field => state[field] !== prevState[field])
    if (!hasChange) return

    if (syncTimeout) clearTimeout(syncTimeout)
    syncTimeout = setTimeout(() => {
        usePresetStore.getState().syncFromGenerationStore()
    }, 500)
})

// Wrapper for loadPreset to set loading flag
const originalLoadPreset = usePresetStore.getState().loadPreset
usePresetStore.setState({
    loadPreset: (id: string) => {
        isLoadingPreset = true
        originalLoadPreset(id)
        setTimeout(() => {
            isLoadingPreset = false
        }, 100)
    }
})
