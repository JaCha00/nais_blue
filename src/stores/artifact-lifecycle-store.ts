import { create } from 'zustand'

export interface GeneratedArtifactNotice {
    readonly sequence: number
    readonly path: string
    /** Memory-only previews may carry bytes; durable artifacts are re-read by path. */
    readonly data?: string
}

interface ArtifactLifecycleState {
    latestGeneratedArtifact: GeneratedArtifactNotice | null
    publishGeneratedArtifact: (artifact: Omit<GeneratedArtifactNotice, 'sequence'>) => void
}

/**
 * Transient delivery projection between output producers and History UI. The
 * organizer repository remains artifact authority; this store only replaces a
 * stringly-typed window event and is intentionally excluded from persistence.
 */
export const useArtifactLifecycleStore = create<ArtifactLifecycleState>()((set) => ({
    latestGeneratedArtifact: null,
    publishGeneratedArtifact: (artifact) => set(state => ({
        latestGeneratedArtifact: {
            ...artifact,
            sequence: (state.latestGeneratedArtifact?.sequence ?? 0) + 1,
        },
    })),
}))

/** Output services use this command without coupling themselves to React. */
export function publishGeneratedArtifact(
    artifact: Omit<GeneratedArtifactNotice, 'sequence'>,
): void {
    useArtifactLifecycleStore.getState().publishGeneratedArtifact(artifact)
}
