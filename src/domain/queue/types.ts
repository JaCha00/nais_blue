import type { JsonValue } from '@/domain/composition/types'

export const GENERATION_JOB_STATES = [
    'queued',
    'leased',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'skipped',
    'blocked',
    'recovering',
] as const

export type GenerationJobState = typeof GENERATION_JOB_STATES[number]

export const TERMINAL_JOB_STATES = [
    'succeeded',
    'failed',
    'cancelled',
    'skipped',
] as const satisfies readonly GenerationJobState[]

export type TerminalGenerationJobState = typeof TERMINAL_JOB_STATES[number]
export type GenerationWorkflow = 'main' | 'scene' | 'style-lab'
export type SnapshotResourceRole = 'source' | 'mask' | 'character-reference' | 'vibe-reference' | 'other'
export type SnapshotResourcePersistence = 'managed-app-data' | 'portable' | 'volatile'
export type SnapshotResumability = 'resumable' | 'non-resumable'
export type QueueBlockReason = 'missing-resource' | 'digest-mismatch' | 'non-resumable-resource'

export interface GenerationSnapshotPrompt {
    readonly positive: string
    readonly negative: string
}

export interface GenerationSnapshotResource {
    readonly resourceId: string
    readonly role: SnapshotResourceRole
    readonly persistence: SnapshotResourcePersistence
    readonly digest: string
    /** Stable reference only. Raw bytes, absolute paths, signed URLs, and secrets are prohibited. */
    readonly reference: JsonValue
}

export interface GenerationJobSnapshot {
    readonly schemaVersion: 1
    readonly prompt: GenerationSnapshotPrompt
    readonly parameters: JsonValue
    readonly outputPolicy: JsonValue
    readonly resources: readonly GenerationSnapshotResource[]
    readonly resumability: SnapshotResumability
    readonly nonResumableReason?: 'volatile-resource' | 'runtime-only-capability'
}

export interface GenerationJobProgress {
    readonly stage: string
    readonly current: number
    readonly total: number
}

export interface QueueArtifactReference {
    readonly kind: 'output-writer'
    readonly artifactId: string
    readonly digest: string
    readonly mimeType?: string
}

export interface GenerationJob {
    readonly id: string
    readonly batchId: string
    readonly workflow: GenerationWorkflow
    readonly sceneId: string | null
    readonly state: GenerationJobState
    readonly createdAt: string
    readonly updatedAt: string
    readonly priority: number
    readonly ordinal: number
    readonly snapshotSchemaVersion: number
    readonly snapshot: GenerationJobSnapshot
    readonly snapshotHash: string
    readonly compositionPlanHash: string | null
    readonly attemptCount: number
    readonly maxAttempts: number
    readonly idempotencyKey: string
    readonly leaseOwner: string | null
    readonly leaseToken: string | null
    readonly leaseExpiresAt: string | null
    readonly heartbeatAt: string | null
    readonly progress: GenerationJobProgress
    readonly lastDiagnosticEventId: string | null
    readonly outputTransactionId: string | null
    readonly artifactReference: QueueArtifactReference | null
    readonly blockReason: QueueBlockReason | null
    readonly version: number
}

export interface GenerationBatch {
    readonly id: string
    readonly workflow: GenerationWorkflow
    readonly createdAt: string
    readonly updatedAt: string
}

export type QueueResourceAvailability = 'available' | 'missing' | 'volatile'

export interface QueueResourceRecord {
    readonly id: string
    readonly persistence: SnapshotResourcePersistence
    readonly digest: string
    readonly reference: JsonValue
    readonly availability: QueueResourceAvailability
    readonly createdAt: string
    readonly updatedAt: string
}

export type GenerationAttemptOutcome = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export interface GenerationAttempt {
    readonly id: string
    readonly jobId: string
    readonly attemptNumber: number
    readonly startedAt: string
    readonly finishedAt: string | null
    readonly outcome: GenerationAttemptOutcome
    readonly diagnosticEventId: string | null
}
