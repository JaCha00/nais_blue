import type { MetadataMode } from '@/domain/composition/types'

export interface SceneResultOutputDefaults {
    readonly useAbsoluteScenePath: boolean
    readonly metadataMode: MetadataMode
    readonly presetName: string
    readonly presetPathSegments: readonly string[]
    readonly fallbackPromptParts: {
        readonly base: string
        readonly additional: string
        readonly detail: string
        readonly negative: string
        readonly inpainting: string
    }
}

export interface SceneResultProjection {
    readonly historyId: string
    readonly presetId: string
    readonly sceneId: string
    readonly path: string
    readonly thumbnail?: string
    readonly prompt: string
    readonly seed: number
    readonly sentPayloadSummary?: string
    readonly artifactId?: string
    readonly sourceJobId?: string
    readonly sourceSceneId?: string
}

export interface SceneResultRollbackProjection {
    readonly presetId: string
    readonly sceneId: string
    readonly path: string
    readonly historyId: string | null
}

/**
 * Scene output reports read-model facts through this port. The output
 * transaction stays independent of Zustand and UI notifications while the
 * Presentation implementation preserves the existing legacy projections.
 */
export interface SceneResultPresentationPort {
    readOutputDefaults(presetId: string): SceneResultOutputDefaults
    commitResult(result: SceneResultProjection): void
    rollbackResult(result: SceneResultRollbackProjection): void
    reportCapabilityFallback(reason?: string, alternative?: string): void
    updateEncodedVibes(encodedVibes: readonly string[]): void
}
