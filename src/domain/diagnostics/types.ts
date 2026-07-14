export const DIAGNOSTIC_SCHEMA_VERSION = 1 as const

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'fatal'

export type DiagnosticCategory =
    | 'auth'
    | 'network'
    | 'rate_limit'
    | 'novelai_api'
    | 'response_decode'
    | 'image_processing'
    | 'local_io'
    | 'persistence'
    | 'r2_auth'
    | 'r2_upload'
    | 'r2_conflict'
    | 'sync'
    | 'cancelled'
    | 'timeout'
    | 'stalled'
    | 'unknown'

export interface DiagnosticPromptSummary {
    hash: string
    chars: number
    estimatedTokens?: number
}

export interface DiagnosticCause {
    name: string
    message: string
    stack?: string
}

export interface DiagnosticBreadcrumb {
    occurredAt: string
    operation: string
    stage: string
    message?: string
}

/**
 * Persistable diagnostic projection. This intentionally has no raw prompt,
 * provider body, image bytes, token, or absolute path field.
 */
export interface DiagnosticEvent {
    schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION
    eventId: string
    occurredAt: string
    appVersion: string
    platform: string
    architecture: string
    severity: DiagnosticSeverity
    code: string
    category: DiagnosticCategory
    operation: string
    stage: string
    correlationId?: string
    userActionId?: string
    jobId?: string
    sceneId?: string
    attemptId?: string
    httpStatus?: number
    providerRequestId?: string
    startedAt?: string
    elapsedMs?: number
    lastProgressAt?: string
    retryAttempt?: number
    maxAttempts?: number
    cancelled: boolean
    timeout: boolean
    stalled: boolean
    recoverable: boolean
    userSummary: string
    recommendedAction: string
    prompt?: DiagnosticPromptSummary
    redactedDeveloperMessage: string
    redactedCauseChain: DiagnosticCause[]
    recentBreadcrumbs: DiagnosticBreadcrumb[]
}

export interface DiagnosticContext {
    operation: string
    stage?: string
    category?: DiagnosticCategory
    severity?: DiagnosticSeverity
    code?: string
    correlationId?: string
    userActionId?: string
    jobId?: string
    sceneId?: string
    attemptId?: string
    httpStatus?: number
    providerRequestId?: string
    startedAt?: Date | string
    elapsedMs?: number
    lastProgressAt?: Date | string
    retryAttempt?: number
    maxAttempts?: number
    cancelled?: boolean
    timeout?: boolean
    stalled?: boolean
    recoverable?: boolean
    fatal?: boolean
    prompt?: string
}

export interface DiagnosticEventInput extends DiagnosticContext {
    category: DiagnosticCategory
    code: string
    severity: DiagnosticSeverity
    userSummary: string
    recommendedAction?: string
    developerMessage?: string
    cause?: unknown
}
