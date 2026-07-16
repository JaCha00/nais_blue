import { useGenerationStore } from './generation-store'

type GenerationStoreState = ReturnType<typeof useGenerationStore.getState>

/** Runtime-only surface shared by progress, cancellation, and preview UI. */
export type GenerationSessionState = Pick<GenerationStoreState,
    | 'isGenerating' | 'isCancelled' | 'generatingMode' | 'currentBatch'
    | 'previewImage' | 'streamProgress' | 'lastGenerationTime'
    | 'setIsGenerating' | 'setGeneratingMode' | 'setPreviewImage' | 'setStreamProgress'
>

/** Typed runtime projection paired with generation-draft-store. */
export function useGenerationSessionStore<T>(selector: (state: GenerationSessionState) => T): T {
    return useGenerationStore(state => selector(state))
}
