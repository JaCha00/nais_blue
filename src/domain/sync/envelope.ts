import { canonicalSerialize } from '@/domain/composition/canonical-serialize'
import type { JsonObject } from '@/domain/composition/types'
import { assertSyncPayloadSafe } from './payload-safety'
import {
    SYNC_ENTITY_TYPES,
    SYNC_ENVELOPE_SCHEMA_VERSION,
    type CreateSyncEnvelopeInput,
    type SyncEntityType,
    type SyncEnvelope,
    type SyncOperation,
} from './types'

const MAX_ID_LENGTH = 512
const CREATE_ENVELOPE_KEYS = new Set([
    'opId', 'entityType', 'entityId', 'op', 'baseRevision', 'baseOpId', 'deviceId', 'userId', 'createdAt', 'encrypted',
    'payload',
])
const SYNC_ENVELOPE_KEYS = new Set([
    'schemaVersion', 'opId', 'entityType', 'entityId', 'op', 'revision', 'baseRevision', 'baseOpId', 'deviceId', 'userId',
    'createdAt', 'encrypted', 'payload',
])

export type SyncEnvelopeErrorCode =
    | 'E_SYNC_ENVELOPE_INVALID'
    | 'E_SYNC_SCHEMA_UNSUPPORTED'
    | 'E_SYNC_ENCRYPTION_UNAVAILABLE'

export class SyncEnvelopeError extends Error {
    constructor(readonly code: SyncEnvelopeErrorCode, message: string) {
        super(message)
        this.name = 'SyncEnvelopeError'
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertNoUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
    if (Object.keys(value).some(key => !allowed.has(key))) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Sync envelope contains an unknown field.')
    }
}

function assertEnvelopeSafe(value: unknown): void {
    try {
        assertSyncPayloadSafe(value)
    } catch {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Sync envelope contains forbidden or invalid material.')
    }
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
        || value.trim().length === 0
        || value.length > MAX_ID_LENGTH
        || /[\0\r\n]/.test(value)) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', `${field} must be a bounded stable identifier.`)
    }
}

function assertTimestamp(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        || !Number.isFinite(Date.parse(value))
        || new Date(value).toISOString() !== value) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', `${field} must be a canonical UTC timestamp.`)
    }
}

function assertEntityType(value: unknown): asserts value is SyncEntityType {
    if (typeof value !== 'string' || !(SYNC_ENTITY_TYPES as readonly string[]).includes(value)) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'entityType is not supported by the sync domain.')
    }
}

function assertOperation(value: unknown): asserts value is SyncOperation {
    if (value !== 'upsert' && value !== 'delete') {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'op must be upsert or delete.')
    }
}

function canonicalPayload(value: unknown): JsonObject {
    if (!isRecord(value)) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'payload must be a JSON object.')
    }
    try {
        return JSON.parse(canonicalSerialize(value)) as JsonObject
    } catch {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'payload must contain canonical JSON values only.')
    }
}

function assertDeletePayload(payload: JsonObject, createdAt: string): void {
    const keys = Object.keys(payload)
    if (keys.length !== 1 || keys[0] !== 'deletedAt' || payload.deletedAt !== createdAt) {
        throw new SyncEnvelopeError(
            'E_SYNC_ENVELOPE_INVALID',
            'Delete payloads contain only deletedAt and must match createdAt.',
        )
    }
}

export function nextSyncRevision(baseRevision: number): number {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || baseRevision >= Number.MAX_SAFE_INTEGER) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'baseRevision must be a non-negative safe integer.')
    }
    return baseRevision + 1
}

/** Locale-independent UTF-16 code-unit order used by every sync tie-break. */
export function compareSyncText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0
}

export function syncEntityKey(entityType: SyncEntityType, entityId: string): string {
    assertEntityType(entityType)
    assertIdentifier(entityId, 'entityId')
    return `${entityType}\u0000${entityId}`
}

function buildSyncEnvelope(input: CreateSyncEnvelopeInput, allowUnknownLegacyLineage: boolean): SyncEnvelope {
    assertEnvelopeSafe(input)
    assertNoUnknownKeys(input as unknown as Record<string, unknown>, CREATE_ENVELOPE_KEYS)
    assertIdentifier(input.opId, 'opId')
    assertEntityType(input.entityType)
    assertIdentifier(input.entityId, 'entityId')
    assertOperation(input.op)
    const baseOpId = input.baseOpId ?? null
    if (baseOpId !== null) assertIdentifier(baseOpId, 'baseOpId')
    if (input.baseRevision === 0 && baseOpId !== null) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Root operations cannot identify a predecessor.')
    }
    if (input.baseRevision > 0 && baseOpId === null && !allowUnknownLegacyLineage) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Non-root operations must identify their predecessor.')
    }
    assertIdentifier(input.deviceId, 'deviceId')
    assertIdentifier(input.userId, 'userId')
    assertTimestamp(input.createdAt, 'createdAt')
    if (input.encrypted !== false) {
        throw new SyncEnvelopeError(
            'E_SYNC_ENCRYPTION_UNAVAILABLE',
            'Envelope encryption is reserved until a transport phase provides an audited implementation.',
        )
    }
    const payload = canonicalPayload(input.payload)
    if (input.op === 'delete') assertDeletePayload(payload, input.createdAt)
    const envelope: SyncEnvelope = {
        schemaVersion: SYNC_ENVELOPE_SCHEMA_VERSION,
        opId: input.opId,
        entityType: input.entityType,
        entityId: input.entityId,
        op: input.op,
        revision: nextSyncRevision(input.baseRevision),
        baseRevision: input.baseRevision,
        baseOpId,
        ...(allowUnknownLegacyLineage && input.baseRevision > 0 ? { lineageUnknown: true as const } : {}),
        deviceId: input.deviceId,
        userId: input.userId,
        createdAt: input.createdAt,
        encrypted: false,
        payload,
    }
    assertEnvelopeSafe(envelope)
    return envelope
}

export function createSyncEnvelope(input: CreateSyncEnvelopeInput): SyncEnvelope {
    return buildSyncEnvelope(input, false)
}

/** Upgrade-only path for schema-v0 records whose predecessor identity was never persisted. */
export function upgradeLegacySyncEnvelope(value: unknown): SyncEnvelope {
    if (!isRecord(value) || value.schemaVersion !== 0) {
        throw new SyncEnvelopeError('E_SYNC_SCHEMA_UNSUPPORTED', 'Legacy sync envelope schema is not supported.')
    }
    const candidate = buildSyncEnvelope({
        opId: value.opId as string,
        entityType: value.entityType as SyncEntityType,
        entityId: value.entityId as string,
        op: value.op as SyncOperation,
        baseRevision: value.baseRevision as number,
        baseOpId: null,
        deviceId: value.deviceId as string,
        userId: value.userId as string,
        createdAt: value.createdAt as string,
        encrypted: false,
        payload: value.payload as JsonObject,
    }, true)
    if (value.revision !== candidate.revision) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Legacy revision must equal baseRevision plus one.')
    }
    return candidate
}

/** Stored-record validator for the durable marker emitted by `upgradeLegacySyncEnvelope`. */
export function validateMigratedSyncEnvelope(value: unknown): SyncEnvelope {
    if (!isRecord(value) || value.schemaVersion !== SYNC_ENVELOPE_SCHEMA_VERSION || value.lineageUnknown !== true) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Migrated sync lineage marker is invalid.')
    }
    if (value.baseOpId !== null || !Number.isSafeInteger(value.baseRevision) || Number(value.baseRevision) <= 0) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Migrated sync lineage must be unknown and non-root.')
    }
    assertEnvelopeSafe(value)
    assertNoUnknownKeys(value, new Set([...SYNC_ENVELOPE_KEYS, 'lineageUnknown']))
    const candidate = buildSyncEnvelope({
        opId: value.opId as string,
        entityType: value.entityType as SyncEntityType,
        entityId: value.entityId as string,
        op: value.op as SyncOperation,
        baseRevision: value.baseRevision as number,
        baseOpId: null,
        deviceId: value.deviceId as string,
        userId: value.userId as string,
        createdAt: value.createdAt as string,
        encrypted: value.encrypted as boolean,
        payload: value.payload as JsonObject,
    }, true)
    if (value.revision !== candidate.revision) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Migrated revision must equal baseRevision plus one.')
    }
    return candidate
}

export function validateSyncEnvelope(value: unknown): SyncEnvelope {
    if (!isRecord(value)) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'Sync envelope must be an object.')
    }
    if (value.schemaVersion !== SYNC_ENVELOPE_SCHEMA_VERSION) {
        throw new SyncEnvelopeError('E_SYNC_SCHEMA_UNSUPPORTED', 'Sync envelope schema is not supported.')
    }
    if (value.lineageUnknown === true) return validateMigratedSyncEnvelope(value)
    assertEnvelopeSafe(value)
    assertNoUnknownKeys(value, SYNC_ENVELOPE_KEYS)
    const candidate = createSyncEnvelope({
        opId: value.opId as string,
        entityType: value.entityType as SyncEntityType,
        entityId: value.entityId as string,
        op: value.op as SyncOperation,
        baseRevision: value.baseRevision as number,
        baseOpId: value.baseOpId === undefined ? null : value.baseOpId as string | null,
        deviceId: value.deviceId as string,
        userId: value.userId as string,
        createdAt: value.createdAt as string,
        encrypted: value.encrypted as boolean,
        payload: value.payload as JsonObject,
    })
    if (value.revision !== candidate.revision) {
        throw new SyncEnvelopeError('E_SYNC_ENVELOPE_INVALID', 'revision must equal baseRevision plus one.')
    }
    return candidate
}
