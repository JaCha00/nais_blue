import { useGenerationStore } from './generation-store'

type GenerationStoreState = ReturnType<typeof useGenerationStore.getState>

/** Input-only surface used by prompt editors during the generation-store split. */
export type GenerationDraftState = Pick<GenerationStoreState,
    | 'basePrompt' | 'additionalPrompt' | 'detailPrompt' | 'negativePrompt'
    | 'seed' | 'seedLocked' | 'selectedResolution' | 'model' | 'steps'
    | 'cfgScale' | 'cfgRescale' | 'sampler' | 'scheduler' | 'smea'
    | 'smeaDyn' | 'variety' | 'qualityToggle' | 'ucPreset' | 'batchCount'
    | 'setBasePrompt' | 'setAdditionalPrompt' | 'setDetailPrompt' | 'setNegativePrompt'
    | 'setSeed' | 'setSeedLocked' | 'setSelectedResolution' | 'setModel' | 'setSteps'
    | 'setCfgScale' | 'setCfgRescale' | 'setSampler' | 'setScheduler' | 'setSmea'
    | 'setSmeaDyn' | 'setVariety' | 'setQualityToggle' | 'setUcPreset' | 'setBatchCount'
>

/**
 * Typed compatibility projection: prompt UI can depend only on draft fields
 * while persistence and execution remain behind generation-store during the
 * staged migration. Moving authority later will not change component imports.
 */
export function useGenerationDraftStore<T>(selector: (state: GenerationDraftState) => T): T {
    return useGenerationStore(state => selector(state))
}
