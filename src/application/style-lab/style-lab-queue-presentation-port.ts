export interface StyleLabQueueResultProjection {
    readonly comboId: string
    readonly preview: {
        readonly path: string
        readonly thumbnail?: string
        readonly seed: number
        readonly prompt: string
        readonly contextId: string
    }
    readonly history: {
        readonly id: string
        readonly url: string
        readonly thumbnail?: string
        readonly prompt: string
        readonly seed: number
        readonly timestamp: Date
        readonly sentPayloadSummary?: string
        readonly sourceJobId: string
    }
    readonly artifact: {
        readonly path: string
        readonly sourceJobId: string
    }
}

/**
 * Durable Style Lab execution reports UI read-model facts through this port.
 * The executor owns Queue/Vault/output transactions while the Composition Root
 * supplies a presentation adapter that coordinates current Zustand projections.
 */
export interface StyleLabQueuePresentationPort {
    beginPreview(comboId: string): void
    commitResult(result: StyleLabQueueResultProjection): void
    rollbackResult(comboId: string, historyId: string): void
    clearPreview(comboId: string): void
}
