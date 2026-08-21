import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useGenerationStore } from './generation-store'
import { indexedDBStorage } from '@/lib/indexed-db'
import { DEFAULT_NAI_IMAGE_MODEL } from '@/services/nai/model-catalog'
import {
    DEFAULT_GENERATION_PRESET_ID,
    GENERATION_PRESET_STORE_VERSION,
    createDefaultGenerationPreset,
    migrateGenerationPresetPersistedState,
    normalizeLegacyGenerationPreset,
    type MigratedPresetPersistedState,
    type NormalizedGenerationPreset,
} from '@/lib/composition/preset-store-migration'

export const DEFAULT_PRESET_ID = DEFAULT_GENERATION_PRESET_ID
export const createDefaultPreset = createDefaultGenerationPreset
export const normalizeLegacyPreset = normalizeLegacyGenerationPreset
export const migratePresetPersistedState = migrateGenerationPresetPersistedState
export type Preset = NormalizedGenerationPreset
export type PresetPersistedState = MigratedPresetPersistedState

export type PresetWorkingCopy = Pick<Preset,
    | 'basePrompt'
    | 'additionalPrompt'
    | 'detailPrompt'
    | 'negativePrompt'
    | 'model'
    | 'steps'
    | 'cfgScale'
    | 'cfgRescale'
    | 'sampler'
    | 'scheduler'
    | 'smea'
    | 'smeaDyn'
    | 'variety'
    | 'qualityToggle'
    | 'ucPreset'
    | 'transparentBackground'
    | 'selectedResolution'
>

const WORKING_COPY_FIELDS = [
    'basePrompt', 'additionalPrompt', 'detailPrompt', 'negativePrompt',
    'model', 'steps', 'cfgScale', 'cfgRescale',
    'sampler', 'scheduler', 'smea', 'smeaDyn', 'variety',
    'qualityToggle', 'ucPreset', 'transparentBackground', 'selectedResolution',
] as const

function workingCopyFromPreset(preset: Preset): PresetWorkingCopy {
    return Object.fromEntries(WORKING_COPY_FIELDS.map(field => [field, preset[field]])) as PresetWorkingCopy
}

function workingCopyFromGenerationStore(): PresetWorkingCopy {
    const generation = useGenerationStore.getState()
    return Object.fromEntries(WORKING_COPY_FIELDS.map(field => [field, generation[field]])) as PresetWorkingCopy
}

function workingCopiesEqual(left: PresetWorkingCopy | null, right: PresetWorkingCopy | null): boolean {
    if (left === null || right === null) return left === right
    return WORKING_COPY_FIELDS.every(field => {
        if (field === 'selectedResolution') {
            return left.selectedResolution.label === right.selectedResolution.label
                && left.selectedResolution.width === right.selectedResolution.width
                && left.selectedResolution.height === right.selectedResolution.height
        }
        return left[field] === right[field]
    })
}

interface PresetState {
    presets: Preset[]
    activePresetId: string
    /** The editable generation draft; it never mutates the saved preset by itself. */
    workingCopy: PresetWorkingCopy | null
    /** Last explicitly saved snapshot used by dirty/revert UI. */
    savedSnapshot: PresetWorkingCopy | null
    dirty: boolean

    // Actions
    addPreset: (name: string) => void
    duplicatePreset: (id: string) => void
    deletePreset: (id: string) => void
    syncFromGenerationStore: () => void
    trackWorkingCopy: () => void
    saveActivePreset: () => void
    revertActivePreset: () => void
    saveWorkingCopyAs: (name: string) => void
    loadPreset: (id: string) => void
    renamePreset: (id: string, name: string) => void
    reorderPresets: (oldIndex: number, newIndex: number) => void
    replacePresetFromExternal: (preset: Preset) => void
    upsertPresetFromSync: (preset: Preset) => void
    getActivePreset: () => Preset | undefined
}

export const usePresetStore = create<PresetState>()(
    persist(
        (set, get) => ({
            presets: [createDefaultPreset()],
            activePresetId: DEFAULT_PRESET_ID,
            workingCopy: workingCopyFromPreset(createDefaultPreset()),
            savedSnapshot: workingCopyFromPreset(createDefaultPreset()),
            dirty: false,

            addPreset: (name) => {
                const newPreset: Preset = {
                    id: Date.now().toString(),
                    name,
                    createdAt: Date.now(),
                    // Blank values for new preset
                    basePrompt: '',
                    additionalPrompt: '',
                    detailPrompt: '',
                    negativePrompt: '',
                    model: DEFAULT_NAI_IMAGE_MODEL,
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
                    transparentBackground: false,
                    selectedResolution: { label: 'Portrait', width: 832, height: 1216 },
                }

                set(state => ({
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id,
                    workingCopy: workingCopyFromPreset(newPreset),
                    savedSnapshot: workingCopyFromPreset(newPreset),
                    dirty: false,
                }))

                // One batch update keeps the working-copy subscription from
                // exposing partially applied preset values to prompt controls.
                useGenerationStore.getState().applyPreset(newPreset)
            },

            duplicatePreset: (id) => {
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
                    activePresetId: newPreset.id,
                    workingCopy: workingCopyFromPreset(newPreset),
                    savedSnapshot: workingCopyFromPreset(newPreset),
                    dirty: false,
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

            // Backward-compatible explicit save entry point. Metadata import and
            // older callers intentionally commit only when they invoke this action.
            syncFromGenerationStore: () => {
                const activeId = get().activePresetId
                if (!activeId) return

                const workingCopy = workingCopyFromGenerationStore()

                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === activeId
                            ? {
                                ...p,
                                ...workingCopy,
                            }
                            : p
                    ),
                    workingCopy,
                    savedSnapshot: workingCopy,
                    dirty: false,
                }))
            },

            trackWorkingCopy: () => {
                const workingCopy = workingCopyFromGenerationStore()
                set(state => ({
                    workingCopy,
                    dirty: !workingCopiesEqual(workingCopy, state.savedSnapshot),
                }))
            },

            saveActivePreset: () => get().syncFromGenerationStore(),

            revertActivePreset: () => {
                const snapshot = get().savedSnapshot
                if (snapshot === null) return
                useGenerationStore.getState().applyPreset(snapshot)
                set({ workingCopy: snapshot, dirty: false })
            },

            saveWorkingCopyAs: (name) => {
                const workingCopy = workingCopyFromGenerationStore()
                const newPreset: Preset = {
                    ...createDefaultPreset(),
                    ...workingCopy,
                    id: Date.now().toString(),
                    name,
                    createdAt: Date.now(),
                    isDefault: undefined,
                }
                set(state => ({
                    presets: [...state.presets, newPreset],
                    activePresetId: newPreset.id,
                    workingCopy,
                    savedSnapshot: workingCopy,
                    dirty: false,
                }))
            },

            loadPreset: (id) => {
                const preset = get().presets.find(p => p.id === id)
                if (!preset) return

                const snapshot = workingCopyFromPreset(preset)
                set({
                    activePresetId: id,
                    workingCopy: snapshot,
                    savedSnapshot: snapshot,
                    dirty: false,
                })

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

            /**
             * Agent Workspace validates the full replacement before reaching the
             * store. Preserving identity/default metadata keeps preset persistence
             * and the active generation draft aligned after an external edit.
             */
            replacePresetFromExternal: (preset) => {
                const current = get().presets.find(entry => entry.id === preset.id)
                if (!current) throw new Error(`Preset not found: ${preset.id}`)
                const replacement: Preset = {
                    ...preset,
                    id: current.id,
                    createdAt: current.createdAt,
                    isDefault: current.isDefault,
                }
                const active = get().activePresetId === replacement.id
                const snapshot = workingCopyFromPreset(replacement)
                set(state => ({
                    presets: state.presets.map(entry => entry.id === replacement.id ? replacement : entry),
                    ...(active ? {
                        workingCopy: snapshot,
                        savedSnapshot: snapshot,
                        dirty: false,
                    } : {}),
                }))
                if (active) useGenerationStore.getState().applyPreset(replacement)
            },

            /**
             * LAN sync depends on the same normalized preset schema and
             * generation-store batch apply as local selection. Existing IDs are
             * replaced, remote IDs are appended, and the active draft changes
             * only when its own preset changed.
             */
            upsertPresetFromSync: (preset) => {
                const normalized = normalizeLegacyPreset(preset)
                const active = get().activePresetId === normalized.id
                set(state => {
                    const index = state.presets.findIndex(entry => entry.id === normalized.id)
                    const current = index < 0 ? null : state.presets[index]
                    const replacement: Preset = {
                        ...normalized,
                        ...(current?.isDefault === true || normalized.id === DEFAULT_PRESET_ID
                            ? { isDefault: true }
                            : { isDefault: undefined }),
                    }
                    const presets = [...state.presets]
                    if (index < 0) presets.push(replacement)
                    else presets[index] = replacement
                    const snapshot = active ? workingCopyFromPreset(replacement) : null
                    return {
                        presets,
                        ...(snapshot === null ? {} : {
                            workingCopy: snapshot,
                            savedSnapshot: snapshot,
                            dirty: false,
                        }),
                    }
                })
                if (active) useGenerationStore.getState().applyPreset(normalized)
            },

            getActivePreset: () => {
                return get().presets.find(p => p.id === get().activePresetId)
            },
        }),
        {
            name: 'nai-blue-presets',
            storage: createJSONStorage(() => indexedDBStorage),
            version: GENERATION_PRESET_STORE_VERSION,
            migrate: (persistedState) => (
                migratePresetPersistedState(persistedState) as unknown as PresetState
            ),
            // Ensure default preset exists and migrate old presets missing new fields
            onRehydrateStorage: () => (state) => {
                if (state) {
                    const migrated = migratePresetPersistedState(state)
                    state.presets = migrated.presets
                    state.activePresetId = migrated.activePresetId
                    const activePreset = migrated.presets.find(preset => preset.id === migrated.activePresetId)
                        ?? migrated.presets[0]
                    const snapshot = activePreset ? workingCopyFromPreset(activePreset) : null
                    state.workingCopy = snapshot
                    state.savedSnapshot = snapshot
                    state.dirty = false
                }
            }
        }
    )
)

let stopPresetSync: (() => void) | null = null

/**
 * Startup owns this subscription so importing the store cannot silently mutate
 * saved presets. The listener updates only the working-copy projection and dirty
 * flag; Save/Revert remain explicit user commands.
 */
export function startPresetSync(): () => void {
    stopPresetSync?.()
    usePresetStore.getState().trackWorkingCopy()
    stopPresetSync = useGenerationStore.subscribe((state, previous) => {
        const changed = WORKING_COPY_FIELDS.some(field => state[field] !== previous[field])
        if (changed) usePresetStore.getState().trackWorkingCopy()
    })
    return () => {
        stopPresetSync?.()
        stopPresetSync = null
    }
}
