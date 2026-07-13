import { deterministicMigrationId } from '@/lib/composition/legacy-migration-id'

export const DEFAULT_GENERATION_PRESET_ID = 'default'

export interface NormalizedGenerationPreset {
    id: string
    name: string
    createdAt: number
    isDefault?: boolean
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    negativePrompt: string
    model: string
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smeaDyn: boolean
    variety: boolean
    qualityToggle: boolean
    ucPreset: number
    selectedResolution: {
        label: string
        width: number
        height: number
    }
}

export interface MigratedPresetPersistedState {
    presets: NormalizedGenerationPreset[]
    activePresetId: string
    [key: string]: unknown
}

export const createDefaultGenerationPreset = (): NormalizedGenerationPreset => ({
    id: DEFAULT_GENERATION_PRESET_ID,
    name: '기본',
    createdAt: 0,
    isDefault: true,
    basePrompt: '',
    additionalPrompt: '',
    detailPrompt: '',
    negativePrompt: '',
    model: 'nai-diffusion-4-5-full',
    steps: 28,
    cfgScale: 5,
    cfgRescale: 0,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    smea: true,
    smeaDyn: true,
    variety: false,
    qualityToggle: true,
    ucPreset: 0,
    selectedResolution: { label: 'Portrait', width: 832, height: 1216 },
})

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

export function normalizeLegacyGenerationPreset(value: unknown, index = 0): NormalizedGenerationPreset {
    const record = isRecord(value) ? value : {}
    const fallback = createDefaultGenerationPreset()
    const resolution = isRecord(record.selectedResolution) ? record.selectedResolution : {}
    const id = typeof record.id === 'string' && record.id.trim().length > 0
        ? record.id
        : deterministicMigrationId('params-preset', record, String(index))
    const isDefault = id === DEFAULT_GENERATION_PRESET_ID || record.isDefault === true

    return {
        ...record,
        id,
        name: stringOr(record.name, isDefault ? fallback.name : 'Preset'),
        createdAt: numberOr(record.createdAt, 0),
        ...(isDefault ? { isDefault: true } : { isDefault: undefined }),
        basePrompt: stringOr(record.basePrompt, fallback.basePrompt),
        additionalPrompt: stringOr(record.additionalPrompt, fallback.additionalPrompt),
        detailPrompt: stringOr(record.detailPrompt, fallback.detailPrompt),
        negativePrompt: stringOr(record.negativePrompt, fallback.negativePrompt),
        model: stringOr(record.model, fallback.model),
        steps: numberOr(record.steps, fallback.steps),
        cfgScale: numberOr(record.cfgScale, fallback.cfgScale),
        cfgRescale: numberOr(record.cfgRescale, fallback.cfgRescale),
        sampler: stringOr(record.sampler, fallback.sampler),
        scheduler: stringOr(record.scheduler, fallback.scheduler),
        smea: booleanOr(record.smea, fallback.smea),
        smeaDyn: booleanOr(record.smeaDyn, fallback.smeaDyn),
        variety: booleanOr(record.variety, fallback.variety),
        qualityToggle: booleanOr(record.qualityToggle, fallback.qualityToggle),
        ucPreset: numberOr(record.ucPreset, fallback.ucPreset),
        selectedResolution: {
            label: stringOr(resolution.label, fallback.selectedResolution.label),
            width: numberOr(resolution.width, fallback.selectedResolution.width),
            height: numberOr(resolution.height, fallback.selectedResolution.height),
        },
    }
}

export function migrateGenerationPresetPersistedState(value: unknown): MigratedPresetPersistedState {
    const state = isRecord(value) ? value : {}
    const presets = (Array.isArray(state.presets) ? state.presets : [])
        .map((preset, index) => normalizeLegacyGenerationPreset(preset, index))
    if (!presets.some(preset => preset.id === DEFAULT_GENERATION_PRESET_ID)) {
        presets.unshift(createDefaultGenerationPreset())
    }
    const requestedActiveId = typeof state.activePresetId === 'string'
        ? state.activePresetId
        : DEFAULT_GENERATION_PRESET_ID
    return {
        ...state,
        presets,
        activePresetId: presets.some(preset => preset.id === requestedActiveId)
            ? requestedActiveId
            : DEFAULT_GENERATION_PRESET_ID,
    }
}
