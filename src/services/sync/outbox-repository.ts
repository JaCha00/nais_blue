import {
    canonicalSerialize,
    hashCanonicalValue,
} from '@/domain/composition/canonical-serialize'
import type { JsonObject } from '@/domain/composition/types'
import {
    ACTIVE_SYNC_ENTITY_TYPES,
    SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
    SyncEnvelopeError,
    compareSyncText,
    createSyncEnvelope,
    syncEntityKey,
    upgradeLegacySyncEnvelope,
    validateMigratedSyncEnvelope,
    validateSyncEnvelope,
    type ActiveSyncEntityType,
    type SyncCheckpoint,
    type SyncCheckpointRecord,
    type SyncEntityRecord,
    type SyncEntityType,
    type SyncEnvelope,
    type SyncInboxRecord,
    type SyncInboxStatus,
    type SyncOperation,
    type SyncOutboxRecord,
    type SyncOutboxState,
    type SyncRemoteApplyReceipt,
    type SyncTombstoneRecord,
} from '@/domain/sync'
import {
    SyncConflictError,
    resolveSyncOperationSet,
} from './conflict-resolver'
import {
    SyncSanitizationError,
    assertSyncPayloadSafe,
    sanitizeSyncPayload,
} from './sanitizer'

export const SYNC_OUTBOX_DATABASE_NAME = 'nais2-local-sync'
export const SYNC_OUTBOX_DATABASE_VERSION = 2
export const SYNC_IN_FLIGHT_LEASE_MS = 60_000

const STORE_NAMES = ['checkpoints', 'entities', 'inbox', 'outbox', 'tombstones'] as const
type SyncStoreName = typeof STORE_NAMES[number]

const RETRY_FAILURE_CODE = /^E_[A-Z0-9_.:-]{1,96}$/

export type SyncOutboxRepositoryErrorCode =
    | 'E_SYNC_DB_UNAVAILABLE'
    | 'E_SYNC_DB_BLOCKED'
    | 'E_SYNC_SCHEMA_NEWER'
    | 'E_SYNC_SCHEMA_UPGRADE'
    | 'E_SYNC_TRANSACTION_ABORTED'
    | 'E_SYNC_WRITE_VERIFY'
    | 'E_SYNC_RECORD_INVALID'
    | 'E_SYNC_DUPLICATE_CONFLICT'
    | 'E_SYNC_REVISION_CONFLICT'
    | 'E_SYNC_TOMBSTONED'
    | 'E_SYNC_NOT_FOUND'
    | 'E_SYNC_RETRY_INVALID'
    | 'E_SYNC_CHECKPOINT_REGRESSION'
    | 'E_SYNC_PAYLOAD_INVALID'
    | 'E_SYNC_USER_SCOPE'
    | 'E_SYNC_MANUAL_RESOLUTION_REQUIRED'

export class SyncOutboxRepositoryError extends Error {
    constructor(readonly code: SyncOutboxRepositoryErrorCode, message: string) {
        super(message)
        this.name = 'SyncOutboxRepositoryError'
    }
}

export interface SyncOutboxRepositoryOptions {
    readonly userId: string
    readonly factory?: IDBFactory
    readonly keyRange?: typeof IDBKeyRange
    readonly databaseName?: string
    readonly openTimeoutMs?: number
}

export interface ApplyLocalSyncMutationInput {
    readonly opId: string
    readonly entityType: SyncEntityType
    readonly entityId: string
    readonly op: SyncOperation
    readonly deviceId: string
    readonly userId: string
    readonly createdAt: string
    readonly payload?: unknown
    readonly expectedBaseRevision?: number
}

export interface SyncOutboxSchemaInspection {
    readonly version: number
    readonly stores: readonly string[]
    readonly indexes: Readonly<{
        entities: readonly string[]
        inbox: readonly string[]
        outbox: readonly string[]
        tombstones: readonly string[]
    }>
}

export interface ListSyncOutboxOptions {
    readonly includeAcked?: boolean
}

export interface ListReadySyncOutboxOptions {
    readonly now: string
    readonly limit?: number
}

export interface MarkSyncAttemptInput {
    readonly opId: string
    readonly attemptedAt: string
    readonly inFlightUntil?: string
}

export interface ScheduleSyncRetryInput {
    readonly opId: string
    readonly nextAttemptAt: string
    readonly failureCode: string
    readonly expectedAttemptCount: number
    readonly expectedInFlightUntil: string
}

export interface AcknowledgeSyncInput {
    readonly opIds: readonly string[]
    readonly peerId: string
    readonly checkpoint: SyncCheckpoint
    readonly ackedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
    return structuredClone(value)
}

function canonicalEqual(left: unknown, right: unknown): boolean {
    return canonicalSerialize(left) === canonicalSerialize(right)
}

function validTimestamp(value: unknown): value is string {
    return typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value
}

function assertTimestamp(value: unknown, field: string): asserts value is string {
    if (!validTimestamp(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', `${field} must be a canonical UTC timestamp.`)
    }
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512 || /[\0\r\n]/.test(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', `${field} must be a stable identifier.`)
    }
    assertSyncPayloadSafe({ id: value })
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', `${field} must be a non-negative safe integer.`)
    }
}

export function syncDatabaseNameForUser(baseName: string, userId: string): string {
    assertIdentifier(baseName, 'databaseName')
    assertIdentifier(userId, 'userId')
    return `${baseName}--${hashCanonicalValue({ userId })}`
}

function asActiveEntityType(value: unknown): ActiveSyncEntityType {
    if (typeof value !== 'string' || !(ACTIVE_SYNC_ENTITY_TYPES as readonly string[]).includes(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Entity type is not an active local sync target.')
    }
    return value as ActiveSyncEntityType
}

function assertSanitizedEnvelope(envelope: SyncEnvelope): SyncEnvelope {
    const entityType = asActiveEntityType(envelope.entityType)
    assertSyncPayloadSafe(envelope as unknown)
    if (envelope.op === 'delete') {
        assertSyncPayloadSafe(envelope.payload)
        return envelope
    }
    const projected = sanitizeSyncPayload(entityType, envelope.payload)
    if (!canonicalEqual(projected, envelope.payload)) {
        throw new SyncOutboxRepositoryError('E_SYNC_PAYLOAD_INVALID', 'Envelope payload was not pre-sanitized.')
    }
    assertPayloadIdentity(entityType, envelope.entityId, envelope.payload)
    return envelope
}

export function syncR2ObjectEntityId(payload: Readonly<{
    profileId: string
    artifactId: string
    variantId: string
    remoteKey: string
}>): string {
    return `r2-object:${hashCanonicalValue(payload)}`
}

function assertPayloadIdentity(
    entityType: ActiveSyncEntityType,
    entityId: string,
    payload: JsonObject,
): void {
    let projectedId: unknown
    switch (entityType) {
        case 'artifact.metadata': projectedId = payload.artifactId; break
        case 'artifact.r2-object':
            projectedId = syncR2ObjectEntityId({
                profileId: String(payload.profileId),
                artifactId: String(payload.artifactId),
                variantId: String(payload.variantId),
                remoteKey: String(payload.remoteKey),
            })
            break
        case 'ui.preference': projectedId = 'preferences'; break
        default: projectedId = payload.id
    }
    if (projectedId !== entityId) {
        throw new SyncOutboxRepositoryError(
            'E_SYNC_PAYLOAD_INVALID',
            'Envelope entity identity does not match its sanitized payload.',
        )
    }
}

function migrateEnvelope(value: unknown): SyncEnvelope {
    if (!isRecord(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored envelope is invalid.')
    }
    let envelope: SyncEnvelope
    if (value.schemaVersion === 0) {
        envelope = upgradeLegacySyncEnvelope(value)
    } else if (value.lineageUnknown === true) {
        envelope = validateMigratedSyncEnvelope(value)
    } else {
        envelope = validateSyncEnvelope(value)
    }
    return assertSanitizedEnvelope(envelope)
}

function entityFromEnvelope(
    envelope: SyncEnvelope,
    effectiveRevision = envelope.revision,
    conflictCopyId: string | null = null,
    conflictOfEntityId: string | null = null,
): SyncEntityRecord {
    const entityType = asActiveEntityType(envelope.entityType)
    const entityId = conflictCopyId ?? envelope.entityId
    const key = conflictOfEntityId === null
        ? syncEntityKey(entityType, entityId)
        : `sync-conflict\u0000${entityType}\u0000${conflictOfEntityId}\u0000${envelope.opId}`
    return {
        recordSchemaVersion: SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
        key,
        entityType,
        entityId,
        revision: effectiveRevision,
        baseRevision: envelope.baseRevision,
        op: envelope.op,
        sourceOpId: envelope.opId,
        sourceEnvelope: clone(envelope),
        payload: envelope.op === 'delete' ? null : clone(envelope.payload),
        deletedAt: envelope.op === 'delete' ? String(envelope.payload.deletedAt) : null,
        conflictOfEntityId,
        conflictSourceOpId: conflictOfEntityId === null ? null : envelope.opId,
    }
}

function parseEntityRecord(value: unknown): SyncEntityRecord {
    if (!isRecord(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored entity is invalid.')
    }
    const envelope = migrateEnvelope(value.sourceEnvelope)
    const entityType = asActiveEntityType(value.entityType)
    assertIdentifier(value.entityId, 'entityId')
    assertNonNegativeInteger(value.revision, 'revision')
    const conflictOfEntityId = value.conflictOfEntityId === null || value.conflictOfEntityId === undefined
        ? null
        : String(value.conflictOfEntityId)
    const expectedSourceEntityId = conflictOfEntityId ?? value.entityId
    if (envelope.entityType !== entityType
        || envelope.entityId !== expectedSourceEntityId
        || value.sourceOpId !== envelope.opId
        || Number(value.revision) < envelope.revision) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored entity identity is inconsistent.')
    }
    const projected = entityFromEnvelope(
        envelope,
        Number(value.revision),
        String(value.entityId),
        conflictOfEntityId,
    )
    if (value.key !== projected.key
        || value.baseRevision !== projected.baseRevision
        || value.op !== projected.op
        || value.deletedAt !== projected.deletedAt
        || !canonicalEqual(value.payload, projected.payload)
        || value.conflictSourceOpId !== projected.conflictSourceOpId) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored entity fields are inconsistent.')
    }
    return {
        ...projected,
        conflictSourceOpId: conflictOfEntityId === null ? null : envelope.opId,
    }
}

function tombstoneFromEnvelope(envelope: SyncEnvelope, effectiveRevision = envelope.revision): SyncTombstoneRecord {
    if (envelope.op !== 'delete') {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Tombstone source must be a delete envelope.')
    }
    const entityType = asActiveEntityType(envelope.entityType)
    return {
        recordSchemaVersion: SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
        key: syncEntityKey(entityType, envelope.entityId),
        entityType,
        entityId: envelope.entityId,
        revision: effectiveRevision,
        sourceOpId: envelope.opId,
        sourceEnvelope: clone(envelope),
        deletedAt: String(envelope.payload.deletedAt),
    }
}

function parseTombstoneRecord(value: unknown): SyncTombstoneRecord {
    if (!isRecord(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored tombstone is invalid.')
    }
    const envelope = migrateEnvelope(value.sourceEnvelope)
    assertNonNegativeInteger(value.revision, 'tombstone.revision')
    const projected = tombstoneFromEnvelope(envelope, Number(value.revision))
    if (value.key !== projected.key
        || value.entityType !== projected.entityType
        || value.entityId !== projected.entityId
        || value.sourceOpId !== projected.sourceOpId
        || value.deletedAt !== projected.deletedAt) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored tombstone identity is inconsistent.')
    }
    return projected
}

function parseOutboxState(value: unknown): SyncOutboxState {
    if (value !== 'pending' && value !== 'in-flight' && value !== 'retry' && value !== 'acked') {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored outbox state is invalid.')
    }
    return value
}

function parseOutboxRecord(value: unknown): SyncOutboxRecord {
    if (!isRecord(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored outbox record is invalid.')
    }
    const envelope = migrateEnvelope(value.envelope)
    const state = parseOutboxState(value.state ?? 'pending')
    const attemptCount = value.attemptCount ?? 0
    const nextAttemptAt = value.nextAttemptAt ?? envelope.createdAt
    const lastAttemptAt = value.lastAttemptAt ?? null
    const inFlightUntil = value.inFlightUntil ?? null
    const lastFailureCode = value.lastFailureCode ?? null
    const ackedAt = value.ackedAt ?? null
    const checkpointSequence = value.checkpointSequence ?? null
    assertNonNegativeInteger(attemptCount, 'attemptCount')
    assertTimestamp(nextAttemptAt, 'nextAttemptAt')
    if (lastAttemptAt !== null) assertTimestamp(lastAttemptAt, 'lastAttemptAt')
    if (inFlightUntil !== null) assertTimestamp(inFlightUntil, 'inFlightUntil')
    if (ackedAt !== null) assertTimestamp(ackedAt, 'ackedAt')
    if (lastFailureCode !== null && (typeof lastFailureCode !== 'string' || !RETRY_FAILURE_CODE.test(lastFailureCode))) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored retry failure code is invalid.')
    }
    if (checkpointSequence !== null) assertNonNegativeInteger(checkpointSequence, 'checkpointSequence')
    if (state === 'in-flight' && (lastAttemptAt === null || inFlightUntil === null)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'In-flight outbox record is missing its lease.')
    }
    if (state !== 'in-flight' && inFlightUntil !== null) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Only in-flight outbox records may retain a lease.')
    }
    if (state === 'retry' && lastFailureCode === null) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Retry outbox record is missing its failure code.')
    }
    if (state === 'acked' && (ackedAt === null || checkpointSequence === null)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Acknowledged outbox record is incomplete.')
    }
    if (state !== 'acked' && (ackedAt !== null || checkpointSequence !== null)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Unacknowledged outbox record contains ack metadata.')
    }
    const entityKey = syncEntityKey(envelope.entityType, envelope.entityId)
    if (value.opId !== envelope.opId || value.entityKey !== entityKey) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored outbox identity is inconsistent.')
    }
    return {
        recordSchemaVersion: SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
        opId: envelope.opId,
        entityKey,
        envelope,
        state,
        attemptCount: Number(attemptCount),
        nextAttemptAt,
        lastAttemptAt,
        inFlightUntil,
        lastFailureCode,
        ackedAt,
        checkpointSequence: checkpointSequence === null ? null : Number(checkpointSequence),
    }
}

function parseInboxStatus(value: unknown): SyncInboxStatus {
    const states: readonly SyncInboxStatus[] = [
        'pending', 'deferred', 'applied', 'equivalent', 'conflict-copy', 'tombstone', 'ignored',
    ]
    if (typeof value !== 'string' || !states.includes(value as SyncInboxStatus)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored inbox status is invalid.')
    }
    return value as SyncInboxStatus
}

function parseInboxRecord(value: unknown): SyncInboxRecord {
    if (!isRecord(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored inbox record is invalid.')
    }
    const envelope = migrateEnvelope(value.envelope)
    const envelopeHash = `sha256:${hashCanonicalValue(envelope)}`
    assertTimestamp(value.receivedAt, 'receivedAt')
    if (value.resolvedAt !== null) assertTimestamp(value.resolvedAt, 'resolvedAt')
    const entityKey = syncEntityKey(envelope.entityType, envelope.entityId)
    if (value.opId !== envelope.opId || value.entityKey !== entityKey || value.envelopeHash !== envelopeHash) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored inbox identity is inconsistent.')
    }
    return {
        recordSchemaVersion: SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
        opId: envelope.opId,
        entityKey,
        envelope,
        envelopeHash,
        status: parseInboxStatus(value.status),
        receivedAt: value.receivedAt,
        resolvedAt: value.resolvedAt,
        conflictCopyId: value.conflictCopyId === null ? null : String(value.conflictCopyId),
    }
}

function parseCheckpointRecord(value: unknown): SyncCheckpointRecord {
    if (!isRecord(value)) {
        throw new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Stored checkpoint is invalid.')
    }
    assertIdentifier(value.peerId, 'peerId')
    assertNonNegativeInteger(value.sequence, 'checkpoint.sequence')
    assertIdentifier(value.cursor, 'checkpoint.cursor')
    assertTimestamp(value.updatedAt, 'checkpoint.updatedAt')
    return {
        recordSchemaVersion: SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
        peerId: value.peerId,
        sequence: value.sequence,
        cursor: value.cursor,
        updatedAt: value.updatedAt,
    }
}

function ensureIndex(
    store: IDBObjectStore,
    name: string,
    keyPath: string | readonly string[],
    options?: IDBIndexParameters,
): void {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath as string | string[], options)
}

function ensureCurrentIndexes(transaction: IDBTransaction): void {
    const entities = transaction.objectStore('entities')
    ensureIndex(entities, 'by-entity-type', 'entityType')
    ensureIndex(entities, 'by-conflict-parent', ['entityType', 'conflictOfEntityId'])
    ensureIndex(entities, 'by-original-entity', ['entityType', 'conflictOfEntityId', 'entityId'])

    const outbox = transaction.objectStore('outbox')
    ensureIndex(outbox, 'by-entity', 'entityKey')
    ensureIndex(outbox, 'by-entity-revision', ['entityKey', 'envelope.revision', 'opId'])
    ensureIndex(outbox, 'by-next-at', ['nextAttemptAt', 'envelope.createdAt', 'opId'])
    ensureIndex(outbox, 'by-state', 'state')

    const inbox = transaction.objectStore('inbox')
    ensureIndex(inbox, 'by-entity', 'entityKey')
    ensureIndex(inbox, 'by-entity-status', ['entityKey', 'status', 'envelope.baseRevision', 'envelope.revision', 'opId'])
    ensureIndex(inbox, 'by-received-at', ['receivedAt', 'opId'])

    ensureIndex(transaction.objectStore('tombstones'), 'by-entity-type', 'entityType')
}

function migrateStore(
    store: IDBObjectStore,
    migrate: (value: unknown) => unknown,
    abortUpgrade: () => void,
): void {
    const request = store.openCursor()
    request.onsuccess = () => {
        const cursor = request.result
        if (cursor === null) return
        try {
            const update = cursor.update(migrate(cursor.value))
            update.onerror = abortUpgrade
            cursor.continue()
        } catch {
            abortUpgrade()
        }
    }
    request.onerror = abortUpgrade
}

function upgradeSyncDatabase(
    database: IDBDatabase,
    transaction: IDBTransaction,
    oldVersion: number,
    abortUpgrade: () => void,
): void {
    if (!database.objectStoreNames.contains('entities')) database.createObjectStore('entities', { keyPath: 'key' })
    if (!database.objectStoreNames.contains('outbox')) database.createObjectStore('outbox', { keyPath: 'opId' })
    if (!database.objectStoreNames.contains('inbox')) database.createObjectStore('inbox', { keyPath: 'opId' })
    if (!database.objectStoreNames.contains('tombstones')) database.createObjectStore('tombstones', { keyPath: 'key' })
    if (!database.objectStoreNames.contains('checkpoints')) database.createObjectStore('checkpoints', { keyPath: 'peerId' })
    ensureCurrentIndexes(transaction)

    if (oldVersion > 0 && oldVersion < SYNC_OUTBOX_DATABASE_VERSION) {
        // Schema v1 only had these four authoritative stores. Inbox is introduced
        // above as an empty v2 store, so there is no legacy inbox record to migrate.
        migrateStore(transaction.objectStore('entities'), parseEntityRecord, abortUpgrade)
        migrateStore(transaction.objectStore('outbox'), parseOutboxRecord, abortUpgrade)
        migrateStore(transaction.objectStore('tombstones'), parseTombstoneRecord, abortUpgrade)
        migrateStore(transaction.objectStore('checkpoints'), parseCheckpointRecord, abortUpgrade)
    }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new DOMException('Transaction aborted', 'AbortError'))
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    })
}

function normalizeRepositoryError(error: unknown): SyncOutboxRepositoryError {
    if (error instanceof SyncOutboxRepositoryError) return error
    if (error instanceof SyncSanitizationError) {
        return new SyncOutboxRepositoryError('E_SYNC_PAYLOAD_INVALID', 'Sync payload failed its allowlist or safety invariant.')
    }
    if (error instanceof SyncEnvelopeError) {
        return new SyncOutboxRepositoryError('E_SYNC_RECORD_INVALID', 'Sync envelope validation failed.')
    }
    if (error instanceof SyncConflictError) {
        return new SyncOutboxRepositoryError(
            error.message.includes('same opId') ? 'E_SYNC_DUPLICATE_CONFLICT' : 'E_SYNC_RECORD_INVALID',
            'Sync operation set validation failed.',
        )
    }
    const name = isRecord(error) && typeof error.name === 'string' ? error.name : ''
    if (name === 'VersionError') {
        return new SyncOutboxRepositoryError('E_SYNC_SCHEMA_NEWER', 'Sync database uses a newer schema.')
    }
    if (name === 'AbortError' || name === 'ConstraintError') {
        return new SyncOutboxRepositoryError('E_SYNC_TRANSACTION_ABORTED', 'Sync transaction was aborted.')
    }
    return new SyncOutboxRepositoryError('E_SYNC_DB_UNAVAILABLE', 'Sync database operation failed.')
}

function sameLocalMutation(
    envelope: SyncEnvelope,
    input: ApplyLocalSyncMutationInput,
    payload: JsonObject,
): boolean {
    return envelope.entityType === input.entityType
        && envelope.entityId === input.entityId
        && envelope.op === input.op
        && envelope.deviceId === input.deviceId
        && envelope.userId === input.userId
        && envelope.createdAt === input.createdAt
        && canonicalEqual(envelope.payload, payload)
}

function outboxFromEnvelope(envelope: SyncEnvelope): SyncOutboxRecord {
    return {
        recordSchemaVersion: SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
        opId: envelope.opId,
        entityKey: syncEntityKey(envelope.entityType, envelope.entityId),
        envelope: clone(envelope),
        state: 'pending',
        attemptCount: 0,
        nextAttemptAt: envelope.createdAt,
        lastAttemptAt: null,
        inFlightUntil: null,
        lastFailureCode: null,
        ackedAt: null,
        checkpointSequence: null,
    }
}

function inboxFromEnvelope(envelope: SyncEnvelope, receivedAt: string): SyncInboxRecord {
    return {
        recordSchemaVersion: SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
        opId: envelope.opId,
        entityKey: syncEntityKey(envelope.entityType, envelope.entityId),
        envelope: clone(envelope),
        envelopeHash: `sha256:${hashCanonicalValue(envelope)}`,
        status: 'pending',
        receivedAt,
        resolvedAt: null,
        conflictCopyId: null,
    }
}

export class IndexedDBSyncOutboxRepository {
    private readonly factory: IDBFactory
    private readonly databaseName: string
    private readonly userId: string
    private readonly openTimeoutMs: number
    private databasePromise: Promise<IDBDatabase> | null = null
    private activeDatabase: IDBDatabase | null = null

    constructor(options: SyncOutboxRepositoryOptions) {
        const factory = options.factory ?? globalThis.indexedDB
        if (factory === undefined) {
            throw new SyncOutboxRepositoryError('E_SYNC_DB_UNAVAILABLE', 'IndexedDB is unavailable.')
        }
        assertIdentifier(options.userId, 'userId')
        this.factory = factory
        this.userId = options.userId
        this.databaseName = syncDatabaseNameForUser(options.databaseName ?? SYNC_OUTBOX_DATABASE_NAME, options.userId)
        this.openTimeoutMs = options.openTimeoutMs ?? 10_000
    }

    private assertBoundUser(userId: string): void {
        if (userId !== this.userId) {
            throw new SyncOutboxRepositoryError('E_SYNC_USER_SCOPE', 'Sync repository is bound to a different user.')
        }
    }

    initialize(): Promise<void> {
        return this.open().then(() => undefined)
    }

    close(): void {
        this.activeDatabase?.close()
        this.activeDatabase = null
        this.databasePromise = null
    }

    private open(): Promise<IDBDatabase> {
        if (this.databasePromise !== null) return this.databasePromise
        this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
            let settled = false
            let upgradeFailed = false
            const timeout = setTimeout(() => {
                if (settled) return
                settled = true
                this.databasePromise = null
                reject(new SyncOutboxRepositoryError('E_SYNC_DB_UNAVAILABLE', 'Sync database open timed out.'))
            }, this.openTimeoutMs)
            const finishResolve = (database: IDBDatabase) => {
                if (settled) {
                    database.close()
                    return
                }
                settled = true
                clearTimeout(timeout)
                this.activeDatabase = database
                database.onversionchange = () => this.close()
                resolve(database)
            }
            const finishReject = (error: unknown) => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                this.databasePromise = null
                reject(upgradeFailed
                    ? new SyncOutboxRepositoryError('E_SYNC_SCHEMA_UPGRADE', 'Sync database schema upgrade was aborted.')
                    : normalizeRepositoryError(error))
            }
            let request: IDBOpenDBRequest
            try {
                request = this.factory.open(this.databaseName, SYNC_OUTBOX_DATABASE_VERSION)
            } catch (error) {
                finishReject(error)
                return
            }
            request.onupgradeneeded = event => {
                const transaction = request.transaction as IDBTransaction
                const abortUpgrade = () => {
                    upgradeFailed = true
                    try {
                        transaction.abort()
                    } catch {
                        // Upgrade may already be aborting.
                    }
                }
                if (settled) {
                    abortUpgrade()
                    return
                }
                try {
                    upgradeSyncDatabase(request.result, transaction, event.oldVersion, abortUpgrade)
                } catch {
                    abortUpgrade()
                }
            }
            request.onsuccess = () => finishResolve(request.result)
            request.onerror = () => finishReject(request.error)
            request.onblocked = () => finishReject(
                new SyncOutboxRepositoryError('E_SYNC_DB_BLOCKED', 'Sync database upgrade is blocked.'),
            )
        })
        return this.databasePromise
    }

    private async runTransaction<T>(
        stores: readonly SyncStoreName[],
        mode: IDBTransactionMode,
        operation: (transaction: IDBTransaction) => Promise<T>,
    ): Promise<T> {
        const database = await this.open()
        const transaction = database.transaction(stores, mode)
        const completed = transactionDone(transaction)
        try {
            const result = await operation(transaction)
            await completed
            return result
        } catch (error) {
            try {
                transaction.abort()
            } catch {
                // Transaction may already be complete or aborted.
            }
            await completed.catch(() => undefined)
            throw normalizeRepositoryError(error)
        }
    }

    async inspectSchema(): Promise<SyncOutboxSchemaInspection> {
        const database = await this.open()
        const transaction = database.transaction(STORE_NAMES, 'readonly')
        const completed = transactionDone(transaction)
        const inspection = {
            version: database.version,
            stores: Array.from(database.objectStoreNames).sort(),
            indexes: {
                entities: Array.from(transaction.objectStore('entities').indexNames).sort(),
                inbox: Array.from(transaction.objectStore('inbox').indexNames).sort(),
                outbox: Array.from(transaction.objectStore('outbox').indexNames).sort(),
                tombstones: Array.from(transaction.objectStore('tombstones').indexNames).sort(),
            },
        }
        await completed
        return inspection
    }

    async applyLocalMutation(input: ApplyLocalSyncMutationInput): Promise<SyncEnvelope> {
        let entityType: ActiveSyncEntityType
        let sanitizedPayload: JsonObject
        try {
            assertTimestamp(input.createdAt, 'createdAt')
            this.assertBoundUser(input.userId)
            entityType = asActiveEntityType(input.entityType)
            sanitizedPayload = input.op === 'delete'
                ? { deletedAt: input.createdAt }
                : sanitizeSyncPayload(entityType, input.payload)
        } catch (error) {
            throw normalizeRepositoryError(error)
        }
        const selected = await this.runTransaction(
            ['entities', 'inbox', 'outbox', 'tombstones'],
            'readwrite',
            async transaction => {
                const outboxStore = transaction.objectStore('outbox')
                const existingOutboxValue = await requestResult(outboxStore.get(input.opId))
                if (existingOutboxValue !== undefined) {
                    const existing = parseOutboxRecord(existingOutboxValue)
                    this.assertBoundUser(existing.envelope.userId)
                    if (!sameLocalMutation(existing.envelope, input, sanitizedPayload)) {
                        throw new SyncOutboxRepositoryError(
                            'E_SYNC_DUPLICATE_CONFLICT',
                            'The same sync opId cannot identify different local content.',
                        )
                    }
                    await this.recomputeEntityProjection(
                        transaction,
                        entityType,
                        input.entityId,
                        input.createdAt,
                    )
                    return { envelope: existing.envelope, wrote: false }
                }

                const key = syncEntityKey(entityType, input.entityId)
                const entityStore = transaction.objectStore('entities')
                const inboxStore = transaction.objectStore('inbox')
                const tombstoneStore = transaction.objectStore('tombstones')
                const [entityValue, tombstoneValue, inboxValue] = await Promise.all([
                    requestResult(entityStore.get(key)),
                    requestResult(tombstoneStore.get(key)),
                    requestResult(inboxStore.get(input.opId)),
                ])
                const current = entityValue === undefined ? null : parseEntityRecord(entityValue)
                const tombstone = tombstoneValue === undefined ? null : parseTombstoneRecord(tombstoneValue)
                if (current !== null) this.assertBoundUser(current.sourceEnvelope.userId)
                if (tombstone !== null) this.assertBoundUser(tombstone.sourceEnvelope.userId)
                if (input.op === 'upsert' && tombstoneValue !== undefined) {
                    throw new SyncOutboxRepositoryError(
                        'E_SYNC_TOMBSTONED',
                        'A tombstoned entity cannot be resurrected by an ordinary upsert.',
                    )
                }
                const baseRevision = Math.max(current?.revision ?? 0, tombstone?.revision ?? 0)
                if (input.expectedBaseRevision !== undefined && input.expectedBaseRevision !== baseRevision) {
                    throw new SyncOutboxRepositoryError(
                        'E_SYNC_REVISION_CONFLICT',
                        'The local entity revision changed before the outbox transaction committed.',
                    )
                }
                const envelope = inboxValue === undefined
                    ? createSyncEnvelope({
                        opId: input.opId,
                        entityType,
                        entityId: input.entityId,
                        op: input.op,
                        baseRevision,
                        baseOpId: current?.sourceOpId ?? tombstone?.sourceOpId ?? null,
                        deviceId: input.deviceId,
                        userId: input.userId,
                        createdAt: input.createdAt,
                        encrypted: false,
                        payload: sanitizedPayload,
                    })
                    : parseInboxRecord(inboxValue).envelope
                assertSanitizedEnvelope(envelope)
                if (inboxValue !== undefined && (
                    envelope.baseRevision !== baseRevision
                    || envelope.baseOpId !== (current?.sourceOpId ?? tombstone?.sourceOpId ?? null)
                )) {
                    throw new SyncOutboxRepositoryError(
                        'E_SYNC_DUPLICATE_CONFLICT',
                        'Existing inbox operation does not match the current local lineage.',
                    )
                }
                if (!sameLocalMutation(envelope, input, sanitizedPayload)) {
                    throw new SyncOutboxRepositoryError(
                        'E_SYNC_DUPLICATE_CONFLICT',
                        'The same sync opId already identifies different inbox content.',
                    )
                }
                await requestResult(outboxStore.add(outboxFromEnvelope(envelope)))
                await this.recomputeEntityProjection(transaction, entityType, input.entityId, input.createdAt)
                const writtenOutbox = await requestResult(outboxStore.get(envelope.opId))
                if (writtenOutbox === undefined
                    || !canonicalEqual(parseOutboxRecord(writtenOutbox).envelope, envelope)) {
                    throw new SyncOutboxRepositoryError('E_SYNC_WRITE_VERIFY', 'Local outbox write did not match.')
                }
                return { envelope, wrote: true }
            },
        )

        const outbox = await this.getOutbox(selected.envelope.opId)
        if (outbox === null
            || !canonicalEqual(outbox.envelope, selected.envelope)) {
            throw new SyncOutboxRepositoryError('E_SYNC_WRITE_VERIFY', 'Local outbox readback did not match.')
        }
        return clone(selected.envelope)
    }

    async getEntity(entityType: ActiveSyncEntityType, entityId: string): Promise<SyncEntityRecord | null> {
        const value = await this.runTransaction(['entities'], 'readonly', transaction => (
            requestResult(transaction.objectStore('entities').get(syncEntityKey(entityType, entityId)))
        ))
        return value === undefined ? null : clone(parseEntityRecord(value))
    }

    async listConflictCopies(
        entityType: ActiveSyncEntityType,
        originalEntityId: string,
    ): Promise<SyncEntityRecord[]> {
        const values = await this.runTransaction(['entities'], 'readonly', transaction => (
            requestResult(transaction.objectStore('entities').index('by-conflict-parent').getAll([
                entityType,
                originalEntityId,
            ]))
        ))
        return values
            .map(parseEntityRecord)
            .sort((left, right) => compareSyncText(left.sourceOpId, right.sourceOpId))
            .map(clone)
    }

    async getTombstone(
        entityType: ActiveSyncEntityType,
        entityId: string,
    ): Promise<SyncTombstoneRecord | null> {
        const value = await this.runTransaction(['tombstones'], 'readonly', transaction => (
            requestResult(transaction.objectStore('tombstones').get(syncEntityKey(entityType, entityId)))
        ))
        return value === undefined ? null : clone(parseTombstoneRecord(value))
    }

    async getOutbox(opId: string): Promise<SyncOutboxRecord | null> {
        const value = await this.runTransaction(['outbox'], 'readonly', transaction => (
            requestResult(transaction.objectStore('outbox').get(opId))
        ))
        return value === undefined ? null : clone(parseOutboxRecord(value))
    }

    async listOutbox(options: ListSyncOutboxOptions = {}): Promise<SyncOutboxRecord[]> {
        const values = await this.runTransaction(['outbox'], 'readonly', transaction => (
            requestResult(transaction.objectStore('outbox').getAll())
        ))
        return values
            .map(parseOutboxRecord)
            .filter(record => options.includeAcked === true || record.state !== 'acked')
            .sort((left, right) => (
                compareSyncText(left.envelope.createdAt, right.envelope.createdAt)
                || compareSyncText(left.opId, right.opId)
            ))
            .map(clone)
    }

    async listReadyOutbox(options: ListReadySyncOutboxOptions): Promise<SyncOutboxRecord[]> {
        assertTimestamp(options.now, 'now')
        const limit = Math.max(1, Math.min(1_000, Math.trunc(options.limit ?? 100)))
        return (await this.listOutbox())
            .filter(record => (
                (record.state === 'pending' || record.state === 'retry')
                && record.nextAttemptAt <= options.now
            ) || (
                record.state === 'in-flight'
                && record.inFlightUntil !== null
                && record.inFlightUntil <= options.now
            ))
            .sort((left, right) => (
                compareSyncText(left.nextAttemptAt, right.nextAttemptAt)
                || compareSyncText(left.envelope.createdAt, right.envelope.createdAt)
                || compareSyncText(left.opId, right.opId)
            ))
            .slice(0, limit)
    }

    async markAttempt(input: MarkSyncAttemptInput): Promise<SyncOutboxRecord> {
        assertTimestamp(input.attemptedAt, 'attemptedAt')
        const inFlightUntil = input.inFlightUntil
            ?? new Date(Date.parse(input.attemptedAt) + SYNC_IN_FLIGHT_LEASE_MS).toISOString()
        assertTimestamp(inFlightUntil, 'inFlightUntil')
        if (inFlightUntil <= input.attemptedAt) {
            throw new SyncOutboxRepositoryError('E_SYNC_RETRY_INVALID', 'In-flight lease must end after the attempt.')
        }
        return this.mutateOutbox(input.opId, record => {
            if (record.state === 'acked') {
                throw new SyncOutboxRepositoryError('E_SYNC_RETRY_INVALID', 'Acknowledged operations cannot be attempted.')
            }
            if (record.state === 'in-flight'
                && record.inFlightUntil !== null
                && record.inFlightUntil > input.attemptedAt) {
                throw new SyncOutboxRepositoryError('E_SYNC_RETRY_INVALID', 'An unexpired in-flight attempt is already claimed.')
            }
            if (record.state === 'retry' && record.nextAttemptAt > input.attemptedAt) {
                throw new SyncOutboxRepositoryError('E_SYNC_RETRY_INVALID', 'Retry operation is not ready yet.')
            }
            return {
                ...record,
                state: 'in-flight',
                attemptCount: record.attemptCount + 1,
                lastAttemptAt: input.attemptedAt,
                inFlightUntil,
                lastFailureCode: null,
            }
        })
    }

    async scheduleRetry(input: ScheduleSyncRetryInput): Promise<SyncOutboxRecord> {
        assertTimestamp(input.nextAttemptAt, 'nextAttemptAt')
        if (!Number.isSafeInteger(input.expectedAttemptCount) || input.expectedAttemptCount < 1
            || !validTimestamp(input.expectedInFlightUntil)) {
            throw new SyncOutboxRepositoryError(
                'E_SYNC_RETRY_INVALID',
                'Retry persistence requires the current bounded attempt and lease identity.',
            )
        }
        if (!RETRY_FAILURE_CODE.test(input.failureCode)) {
            throw new SyncOutboxRepositoryError(
                'E_SYNC_RETRY_INVALID',
                'Retry persistence accepts a bounded typed failure code only.',
            )
        }
        return this.mutateOutbox(input.opId, record => {
            if (record.state !== 'in-flight'
                || record.attemptCount !== input.expectedAttemptCount
                || record.inFlightUntil !== input.expectedInFlightUntil) {
                throw new SyncOutboxRepositoryError(
                    'E_SYNC_RETRY_INVALID',
                    'Retry persistence lost the current attempt lease race.',
                )
            }
            if (record.lastAttemptAt === null || input.nextAttemptAt < record.lastAttemptAt) {
                throw new SyncOutboxRepositoryError(
                    'E_SYNC_RETRY_INVALID',
                    'Retry scheduling cannot precede the current attempt.',
                )
            }
            return {
                ...record,
                state: 'retry',
                nextAttemptAt: input.nextAttemptAt,
                inFlightUntil: null,
                lastFailureCode: input.failureCode,
            }
        })
    }

    private async mutateOutbox(
        opId: string,
        update: (record: SyncOutboxRecord) => SyncOutboxRecord,
    ): Promise<SyncOutboxRecord> {
        const selected = await this.runTransaction(['outbox'], 'readwrite', async transaction => {
            const store = transaction.objectStore('outbox')
            const value = await requestResult(store.get(opId))
            if (value === undefined) {
                throw new SyncOutboxRepositoryError('E_SYNC_NOT_FOUND', 'Outbox operation was not found.')
            }
            const next = parseOutboxRecord(update(parseOutboxRecord(value)))
            await requestResult(store.put(next))
            const readback = await requestResult(store.get(opId))
            if (readback === undefined || !canonicalEqual(parseOutboxRecord(readback), next)) {
                throw new SyncOutboxRepositoryError('E_SYNC_WRITE_VERIFY', 'Outbox mutation readback did not match.')
            }
            return next
        })
        return clone(selected)
    }

    async acknowledge(input: AcknowledgeSyncInput): Promise<SyncCheckpointRecord> {
        assertIdentifier(input.peerId, 'peerId')
        assertIdentifier(input.checkpoint.cursor, 'checkpoint.cursor')
        assertNonNegativeInteger(input.checkpoint.sequence, 'checkpoint.sequence')
        assertTimestamp(input.ackedAt, 'ackedAt')
        const checkpoint = await this.runTransaction(
            ['checkpoints', 'outbox'],
            'readwrite',
            async transaction => {
                const checkpointStore = transaction.objectStore('checkpoints')
                const outboxStore = transaction.objectStore('outbox')
                const existingValue = await requestResult(checkpointStore.get(input.peerId))
                const existing = existingValue === undefined ? null : parseCheckpointRecord(existingValue)
                if (existing !== null && (
                    input.checkpoint.sequence < existing.sequence
                    || (input.checkpoint.sequence === existing.sequence && input.checkpoint.cursor !== existing.cursor)
                )) {
                    throw new SyncOutboxRepositoryError(
                        'E_SYNC_CHECKPOINT_REGRESSION',
                        'Sync checkpoints are monotonic and cannot be rewritten at the same sequence.',
                    )
                }
                for (const opId of [...new Set(input.opIds)].sort()) {
                    const value = await requestResult(outboxStore.get(opId))
                    if (value === undefined) {
                        throw new SyncOutboxRepositoryError('E_SYNC_NOT_FOUND', 'Acknowledged outbox operation was not found.')
                    }
                    const record = parseOutboxRecord(value)
                    const next: SyncOutboxRecord = record.state === 'acked'
                        ? record
                        : {
                            ...record,
                            state: 'acked',
                            ackedAt: input.ackedAt,
                            inFlightUntil: null,
                            checkpointSequence: input.checkpoint.sequence,
                        }
                    await requestResult(outboxStore.put(next))
                }
                const nextCheckpoint: SyncCheckpointRecord = existing !== null
                    && existing.sequence === input.checkpoint.sequence
                    ? existing
                    : {
                        recordSchemaVersion: SYNC_REPOSITORY_RECORD_SCHEMA_VERSION,
                        peerId: input.peerId,
                        sequence: input.checkpoint.sequence,
                        cursor: input.checkpoint.cursor,
                        updatedAt: input.ackedAt,
                    }
                await requestResult(checkpointStore.put(nextCheckpoint))
                return nextCheckpoint
            },
        )
        return clone(checkpoint)
    }

    async getCheckpoint(peerId: string): Promise<SyncCheckpointRecord | null> {
        const value = await this.runTransaction(['checkpoints'], 'readonly', transaction => (
            requestResult(transaction.objectStore('checkpoints').get(peerId))
        ))
        return value === undefined ? null : clone(parseCheckpointRecord(value))
    }

    async getInbox(opId: string): Promise<SyncInboxRecord | null> {
        const value = await this.runTransaction(['inbox'], 'readonly', transaction => (
            requestResult(transaction.objectStore('inbox').get(opId))
        ))
        return value === undefined ? null : clone(parseInboxRecord(value))
    }

    async receiveRemote(value: unknown, receivedAt?: string): Promise<SyncRemoteApplyReceipt> {
        let envelope: SyncEnvelope
        let entityType: ActiveSyncEntityType
        let arrival: string
        try {
            const validated = validateSyncEnvelope(value)
            this.assertBoundUser(validated.userId)
            entityType = asActiveEntityType(validated.entityType)
            const payload = validated.op === 'delete'
                ? validated.payload
                : sanitizeSyncPayload(entityType, validated.payload)
            if (!canonicalEqual(payload, validated.payload)) {
                throw new SyncOutboxRepositoryError('E_SYNC_PAYLOAD_INVALID', 'Remote envelope was not pre-sanitized.')
            }
            envelope = assertSanitizedEnvelope(validated)
            arrival = receivedAt ?? envelope.createdAt
            assertTimestamp(arrival, 'receivedAt')
        } catch (error) {
            throw normalizeRepositoryError(error)
        }
        const selected = await this.runTransaction(
            ['entities', 'inbox', 'outbox', 'tombstones'],
            'readwrite',
            async transaction => {
                const inboxStore = transaction.objectStore('inbox')
                const outboxValue = await requestResult(transaction.objectStore('outbox').get(envelope.opId))
                if (outboxValue !== undefined
                    && !canonicalEqual(parseOutboxRecord(outboxValue).envelope, envelope)) {
                    throw new SyncOutboxRepositoryError(
                        'E_SYNC_DUPLICATE_CONFLICT',
                        'The same sync opId already identifies different local content.',
                    )
                }
                const existingValue = await requestResult(inboxStore.get(envelope.opId))
                let duplicateDelivery = false
                if (existingValue !== undefined) {
                    const existing = parseInboxRecord(existingValue)
                    if (existing.envelopeHash !== `sha256:${hashCanonicalValue(envelope)}`) {
                        throw new SyncOutboxRepositoryError(
                            'E_SYNC_DUPLICATE_CONFLICT',
                            'The same remote opId cannot identify different content.',
                        )
                    }
                    duplicateDelivery = true
                } else {
                    await requestResult(inboxStore.add(inboxFromEnvelope(envelope, arrival)))
                }
                await this.recomputeEntityProjection(
                    transaction,
                    entityType,
                    envelope.entityId,
                    arrival,
                )
                const resolvedValue = await requestResult(inboxStore.get(envelope.opId))
                if (resolvedValue === undefined) {
                    throw new SyncOutboxRepositoryError('E_SYNC_WRITE_VERIFY', 'Remote inbox record disappeared.')
                }
                return { record: parseInboxRecord(resolvedValue), duplicateDelivery }
            },
        )
        return {
            opId: selected.record.opId,
            status: selected.record.status,
            duplicateDelivery: selected.duplicateDelivery,
            conflictCopyId: selected.record.conflictCopyId,
        }
    }

    private async recomputeEntityProjection(
        transaction: IDBTransaction,
        entityType: ActiveSyncEntityType,
        entityId: string,
        resolvedAt: string,
    ): Promise<void> {
        const entityKey = syncEntityKey(entityType, entityId)
        const entityStore = transaction.objectStore('entities')
        const inboxStore = transaction.objectStore('inbox')
        const outboxStore = transaction.objectStore('outbox')
        const tombstoneStore = transaction.objectStore('tombstones')
        const [primaryValue, conflictValues, inboxValues, outboxValues, tombstoneValue] = await Promise.all([
            requestResult(entityStore.get(entityKey)),
            requestResult(entityStore.index('by-conflict-parent').getAll([entityType, entityId])),
            requestResult(inboxStore.index('by-entity').getAll(entityKey)),
            requestResult(outboxStore.index('by-entity').getAll(entityKey)),
            requestResult(tombstoneStore.get(entityKey)),
        ])
        const entities = [
            ...(primaryValue === undefined ? [] : [parseEntityRecord(primaryValue)]),
            ...conflictValues.map(parseEntityRecord),
        ]
        const inbox = inboxValues.map(parseInboxRecord)
        const outbox = outboxValues.map(parseOutboxRecord)
        const tombstone = tombstoneValue === undefined ? null : parseTombstoneRecord(tombstoneValue)
        const envelopes = [
            ...entities.map(record => record.sourceEnvelope),
            ...inbox.map(record => record.envelope),
            ...outbox.map(record => record.envelope),
            ...(tombstone === null ? [] : [tombstone.sourceEnvelope]),
        ]
        envelopes.forEach(envelope => this.assertBoundUser(envelope.userId))

        const projection = resolveSyncOperationSet(envelopes)
        if (projection === null && (entities.length > 0 || tombstone !== null)) {
            throw new SyncOutboxRepositoryError(
                'E_SYNC_RECORD_INVALID',
                'Existing sync projection has no applicable retained operation.',
            )
        }
        for (const entity of entities) await requestResult(entityStore.delete(entity.key))
        if (projection !== null) {
            await requestResult(entityStore.put(entityFromEnvelope(
                projection.primary,
                projection.effectiveRevision,
            )))
            for (const copy of projection.conflictCopies) {
                await requestResult(entityStore.put(entityFromEnvelope(
                    copy.envelope,
                    copy.envelope.revision,
                    copy.conflictCopyId,
                    copy.envelope.entityId,
                )))
            }
            if (projection.primary.op === 'delete') {
                await requestResult(tombstoneStore.put(tombstoneFromEnvelope(
                    projection.primary,
                    projection.effectiveRevision,
                )))
            }
        }
        for (const record of inbox) {
            const projected = projection?.statusByOpId.get(record.opId)
                ?? { status: 'deferred' as const, conflictCopyId: null }
            await requestResult(inboxStore.put({
                ...record,
                status: projected.status,
                resolvedAt: projected.status === 'deferred' ? null : (record.resolvedAt ?? resolvedAt),
                conflictCopyId: projected.conflictCopyId,
            }))
        }
    }
}
