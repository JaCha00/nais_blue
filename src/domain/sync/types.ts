import type { JsonObject } from '@/domain/composition/types'

export const SYNC_ENVELOPE_SCHEMA_VERSION = 1 as const
export const SYNC_REPOSITORY_RECORD_SCHEMA_VERSION = 2 as const

export const ACTIVE_SYNC_ENTITY_TYPES = [
    'composition.document',
    'composition.profile',
    'composition.recipe',
    'composition.module',
    'scene.preset',
    'scene.card',
    'prompt.preset',
    'prompt.fragment',
    'ui.preference',
    'artifact.metadata',
    'artifact.r2-object',
] as const

/** Conflict policy exists now, but Phase 11 does not enqueue this entity type. */
export const CONFLICT_POLICY_ONLY_SYNC_ENTITY_TYPES = [
    'generation.job-snapshot',
] as const

export const SYNC_ENTITY_TYPES = [
    ...ACTIVE_SYNC_ENTITY_TYPES,
    ...CONFLICT_POLICY_ONLY_SYNC_ENTITY_TYPES,
] as const

export type ActiveSyncEntityType = typeof ACTIVE_SYNC_ENTITY_TYPES[number]
export type SyncEntityType = typeof SYNC_ENTITY_TYPES[number]
export type SyncOperation = 'upsert' | 'delete'

export interface SyncEnvelope {
    readonly schemaVersion: typeof SYNC_ENVELOPE_SCHEMA_VERSION
    readonly opId: string
    readonly entityType: SyncEntityType
    readonly entityId: string
    readonly op: SyncOperation
    readonly revision: number
    readonly baseRevision: number
    /** Exact predecessor operation. `null` is reserved for a root or migrated legacy record. */
    readonly baseOpId: string | null
    /** Emitted only by the schema-v0 upgrader and transported as conservative unknown lineage. */
    readonly lineageUnknown?: true
    readonly deviceId: string
    readonly userId: string
    readonly createdAt: string
    /** Reserved for a later transport phase. Phase 11 accepts `false` only. */
    readonly encrypted: false
    readonly payload: JsonObject
}

export interface CreateSyncEnvelopeInput {
    readonly opId: string
    readonly entityType: SyncEntityType
    readonly entityId: string
    readonly op: SyncOperation
    readonly baseRevision: number
    readonly baseOpId?: string | null
    readonly deviceId: string
    readonly userId: string
    readonly createdAt: string
    readonly encrypted: boolean
    readonly payload: JsonObject
}

export interface SyncEntityRecord {
    readonly recordSchemaVersion: typeof SYNC_REPOSITORY_RECORD_SCHEMA_VERSION
    readonly key: string
    readonly entityType: ActiveSyncEntityType
    readonly entityId: string
    /** Effective monotonic revision, including tombstone dominance. */
    readonly revision: number
    readonly baseRevision: number
    readonly op: SyncOperation
    readonly sourceOpId: string
    readonly sourceEnvelope: SyncEnvelope
    readonly payload: JsonObject | null
    readonly deletedAt: string | null
    readonly conflictOfEntityId: string | null
    readonly conflictSourceOpId: string | null
}

export interface SyncTombstoneRecord {
    readonly recordSchemaVersion: typeof SYNC_REPOSITORY_RECORD_SCHEMA_VERSION
    readonly key: string
    readonly entityType: ActiveSyncEntityType
    readonly entityId: string
    readonly revision: number
    readonly sourceOpId: string
    readonly sourceEnvelope: SyncEnvelope
    readonly deletedAt: string
}

export type SyncOutboxState = 'pending' | 'in-flight' | 'retry' | 'acked'

export interface SyncOutboxRecord {
    readonly recordSchemaVersion: typeof SYNC_REPOSITORY_RECORD_SCHEMA_VERSION
    readonly opId: string
    readonly entityKey: string
    readonly envelope: SyncEnvelope
    readonly state: SyncOutboxState
    readonly attemptCount: number
    readonly nextAttemptAt: string
    readonly lastAttemptAt: string | null
    readonly inFlightUntil: string | null
    readonly lastFailureCode: string | null
    readonly ackedAt: string | null
    readonly checkpointSequence: number | null
}

export type SyncInboxStatus =
    | 'pending'
    | 'deferred'
    | 'applied'
    | 'equivalent'
    | 'conflict-copy'
    | 'tombstone'
    | 'ignored'

export interface SyncInboxRecord {
    readonly recordSchemaVersion: typeof SYNC_REPOSITORY_RECORD_SCHEMA_VERSION
    readonly opId: string
    readonly entityKey: string
    readonly envelope: SyncEnvelope
    readonly envelopeHash: string
    readonly status: SyncInboxStatus
    readonly receivedAt: string
    readonly resolvedAt: string | null
    readonly conflictCopyId: string | null
}

export interface SyncCheckpoint {
    readonly sequence: number
    readonly cursor: string
}

export interface SyncCheckpointRecord extends SyncCheckpoint {
    readonly recordSchemaVersion: typeof SYNC_REPOSITORY_RECORD_SCHEMA_VERSION
    readonly peerId: string
    readonly updatedAt: string
}

export interface SyncRemoteApplyReceipt {
    readonly opId: string
    readonly status: SyncInboxStatus
    readonly duplicateDelivery: boolean
    readonly conflictCopyId: string | null
}
