import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useGenerationStore } from './generation-store'
import { attachStoreBackup } from '@/lib/auto-backup'

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
    selectedResolution: { label: 'Portrait', width: 832, height: 1216 },
})

interface PresetState {
    presets: Preset[]
    activePresetId: string

    // Actions
    addPreset: (name: string) => void
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
                genStore.setSelectedResolution({ label: 'Portrait', width: 832, height: 1216 })
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

                // Load preset values into generation store
                const genStore = useGenerationStore.getState()
                genStore.setBasePrompt(preset.basePrompt)
                genStore.setAdditionalPrompt(preset.additionalPrompt)
                genStore.setDetailPrompt(preset.detailPrompt)
                genStore.setNegativePrompt(preset.negativePrompt)
                genStore.setModel(preset.model)
                genStore.setSteps(preset.steps)
                genStore.setCfgScale(preset.cfgScale)
                genStore.setCfgRescale(preset.cfgRescale)
                genStore.setSampler(preset.sampler)
                genStore.setScheduler(preset.scheduler)
                genStore.setSmea(preset.smea)
                genStore.setSmeaDyn(preset.smeaDyn)
                genStore.setSelectedResolution(preset.selectedResolution)
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
            // Ensure default preset exists on hydration
            onRehydrateStorage: () => (state) => {
                if (state && !state.presets.find(p => p.id === DEFAULT_PRESET_ID)) {
                    state.presets = [createDefaultPreset(), ...state.presets]
                }
                if (state && !state.activePresetId) {
                    state.activePresetId = DEFAULT_PRESET_ID
                }
            }
        }
    )
)

attachStoreBackup(usePresetStore as any, 'presets')

// ============================================
// Debounced Auto-Sync: generation-store → active preset
// ============================================

let syncTimeout: ReturnType<typeof setTimeout> | null = null
let isLoadingPreset = false

// Hydration tracking — prevents the subscribe callback from firing
// during the initial async hydration of generation-store / preset-store.
// Without this guard, an async IndexedDB hydration that completes AFTER
// the user starts typing would trigger syncFromGenerationStore with the
// (still-empty) generation-store state, wiping out the saved active
// preset's prompts in localStorage. Reproducible on cold-start when the
// IndexedDB read is slow/contended, hence the intermittent symptom.
let genHydrated = false
let presetHydrated = false
const isFullyHydrated = () => genHydrated && presetHydrated

// Subscribe to generation-store changes
useGenerationStore.subscribe((state, prevState) => {
    if (isLoadingPreset) return
    if (!isFullyHydrated()) return

    const fieldsToWatch = [
        'basePrompt', 'additionalPrompt', 'detailPrompt', 'negativePrompt',
        'model', 'steps', 'cfgScale', 'cfgRescale',
        'sampler', 'scheduler', 'smea', 'smeaDyn', 'selectedResolution'
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

// Recovery: if generation-store hydrates with empty prompts but the saved
// active preset has data, restore it. Treats the preset as the source of
// truth for prompts — covers the case where generation-store's IndexedDB
// hydration silently failed or was wiped while the preset-store
// localStorage copy survived.
const tryHydrationRecovery = () => {
    if (!isFullyHydrated()) return

    const presetState = usePresetStore.getState()
    const preset = presetState.getActivePreset()
    if (!preset) return

    const gen = useGenerationStore.getState()
    const presetHasContent =
        !!preset.basePrompt || !!preset.additionalPrompt ||
        !!preset.detailPrompt || !!preset.negativePrompt
    const genIsEmpty =
        !gen.basePrompt && !gen.additionalPrompt &&
        !gen.detailPrompt && !gen.negativePrompt

    if (presetHasContent && genIsEmpty) {
        console.warn(
            '[PresetStore] Generation-store hydrated empty but active preset has content — restoring from preset.'
        )
        // loadPreset wrapper already guards re-entry via isLoadingPreset
        presetState.loadPreset(preset.id)
    }
}

const markGenHydrated = () => {
    genHydrated = true
    tryHydrationRecovery()
}
const markPresetHydrated = () => {
    presetHydrated = true
    tryHydrationRecovery()
}

if (useGenerationStore.persist.hasHydrated()) {
    markGenHydrated()
} else {
    useGenerationStore.persist.onFinishHydration(markGenHydrated)
}

if (usePresetStore.persist.hasHydrated()) {
    markPresetHydrated()
} else {
    usePresetStore.persist.onFinishHydration(markPresetHydrated)
}
