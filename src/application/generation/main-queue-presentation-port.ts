export interface MainQueueHistoryProjection {
    readonly id: string
    readonly url: string
    readonly prompt: string
    readonly seed: number
    readonly timestamp: Date
    readonly sentPayloadSummary?: string
    readonly artifactId?: string
    readonly sourceJobId?: string
    readonly sourceSceneId?: string
}

export interface MainQueueArtifactProjection {
    readonly path: string
    readonly artifactId?: string
    readonly sourceJobId?: string
    readonly sourceSceneId?: string
}

/**
 * Main Queue execution reports presentation facts through this port. The
 * service depends on these operations, while the Composition Root supplies the
 * Zustand-backed implementation that updates current UI read models.
 */
export interface MainQueuePresentationPort {
    beginEnqueueOperation(): string
    completeEnqueueOperation(operationId: string): void
    beginExecution(): void
    reportStreamProgress(progress: number, previewImage?: string): void
    commitHistory(history: MainQueueHistoryProjection, previewImage: string): void
    rollbackHistory(historyId: string, previewImage: string): void
    publishArtifact(artifact: MainQueueArtifactProjection): void
    updateEncodedVibes(encodedVibes: readonly string[]): void
    refreshAnlas(slot: 1 | 2): void
    finishExecution(): void
}
