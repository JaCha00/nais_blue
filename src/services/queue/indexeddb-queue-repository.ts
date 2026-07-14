import { canonicalSerialize } from '@/domain/composition/canonical-serialize'
import {
    assertJobTransition,
    isGenerationJobState,
    isTerminalJobState,
    QueueStateTransitionError,
} from '@/domain/queue/state-machine'
import type {
    GenerationAttempt,
    GenerationBatch,
    GenerationJob,
    GenerationJobProgress,
    GenerationJobSnapshot,
    GenerationJobState,
    GenerationWorkflow,
    QueueArtifactReference,
    QueueBlockReason,
    QueueResourceRecord,
} from '@/domain/queue/types'
import {
    assertGenerationJobSnapshotSafe,
    createGenerationJobSnapshot,
    hashGenerationJobSnapshot,
} from './job-snapshot'

export const QUEUE_DATABASE_NAME = 'nais2-durable-generation-queue'
export const QUEUE_DATABASE_VERSION = 2

const STORE_NAMES = ['attempts', 'batches', 'jobs', 'leases', 'resources'] as const
type QueueStoreName = typeof STORE_NAMES[number]

export type QueueRepositoryErrorCode =
    | 'E_QUEUE_DB_UNAVAILABLE'
    | 'E_QUEUE_DB_BLOCKED'
    | 'E_QUEUE_SCHEMA_NEWER'
    | 'E_QUEUE_TRANSACTION_ABORTED'
    | 'E_QUEUE_WRITE_VERIFY'
    | 'E_QUEUE_RECORD_INVALID'
    | 'E_QUEUE_NOT_FOUND'
    | 'E_QUEUE_BATCH_NOT_FOUND'
    | 'E_QUEUE_IDEMPOTENCY_CONFLICT'
    | 'E_QUEUE_INVALID_TRANSITION'
    | 'E_QUEUE_TERMINAL_IMMUTABLE'
    | 'E_QUEUE_LEASE_LOST'

export class QueueRepositoryError extends Error {
    constructor(readonly code: QueueRepositoryErrorCode, message: string) {
        super(message)
        this.name = 'QueueRepositoryError'
    }
}

interface StoredJobRecord {
    recordSchemaVersion: 2
    id: string
    batchId: string
    workflow: GenerationWorkflow
    sceneId: string | null
    state: GenerationJobState
    createdAt: string
    updatedAt: string
    priority: number
    ordinal: number
    snapshotSchemaVersion: number
    snapshot: GenerationJobSnapshot
    snapshotHash: string
    compositionPlanHash: string | null
    attemptCount: number
    maxAttempts: number
    idempotencyKey: string
    progress: GenerationJobProgress
    lastDiagnosticEventId: string | null
    outputTransactionId: string | null
    artifactReference: QueueArtifactReference | null
    blockReason: QueueBlockReason | null
    version: number
    globalOrderKey: IDBValidKey
    batchOrderKey: IDBValidKey
    stateOrderKey: IDBValidKey
}

interface LeaseRecord {
    jobId: string
    owner: string
    token: string
    expiresAt: string
    heartbeatAt: string
}

interface QueuePageCursor {
    index: 'global' | 'batch' | 'state'
    batchId: string | null
    state: GenerationJobState | null
    key: IDBValidKey
}

export interface IndexedDBQueueRepositoryOptions {
    factory?: IDBFactory
    keyRange?: typeof IDBKeyRange
    databaseName?: string
    openTimeoutMs?: number
}

export interface CreateGenerationBatchInput {
    id: string
    workflow: GenerationWorkflow
    createdAt: string
}

export interface EnqueueGenerationJobInput {
    id: string
    batchId: string
    workflow: GenerationWorkflow
    sceneId: string | null
    createdAt: string
    priority: number
    ordinal: number
    snapshot: GenerationJobSnapshot
    compositionPlanHash: string | null
    maxAttempts: number
    idempotencyKey: string
}

export interface AcquireQueueLeaseInput {
    jobId: string
    owner: string
    now: string
    ttlMs: number
}

export interface HeartbeatQueueLeaseInput extends AcquireQueueLeaseInput {
    token: string
}

export interface TransitionGenerationJobInput {
    jobId: string
    to: GenerationJobState
    now: string
    leaseOwner?: string
    expectedVersion?: number
    lastDiagnosticEventId?: string | null
    outputTransactionId?: string | null
    artifactReference?: QueueArtifactReference | null
    blockReason?: QueueBlockReason | null
}

export interface ListGenerationJobsInput {
    batchId?: string
    states?: readonly GenerationJobState[]
    cursor?: string | null
    limit?: number
}

export interface GenerationJobPage {
    items: GenerationJob[]
    nextCursor: string | null
}

export interface QueueRepositorySchemaInspection {
    version: number
    stores: string[]
    indexes: Record<string, string[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertTimestamp(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', `${field} must be an ISO timestamp`)
    }
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', `${field} must be a bounded identifier`)
    }
}

function assertWorkflow(value: unknown): asserts value is GenerationWorkflow {
    if (value !== 'main' && value !== 'scene' && value !== 'style-lab') {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'workflow is invalid')
    }
}

function assertProgress(value: unknown): asserts value is GenerationJobProgress {
    if (!isRecord(value)
        || typeof value.stage !== 'string'
        || typeof value.current !== 'number'
        || typeof value.total !== 'number'
        || !Number.isFinite(value.current)
        || !Number.isFinite(value.total)
        || value.current < 0
        || value.total < 0) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job progress is invalid')
    }
}

function snapshotFromRecord(value: unknown, expectedHash: unknown): GenerationJobSnapshot {
    if (!isRecord(value)
        || value.schemaVersion !== 1
        || !isRecord(value.prompt)
        || typeof value.prompt.positive !== 'string'
        || typeof value.prompt.negative !== 'string'
        || !Array.isArray(value.resources)
        || (value.resumability !== 'resumable' && value.resumability !== 'non-resumable')) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job snapshot is invalid')
    }
    const snapshot = createGenerationJobSnapshot({
        prompt: {
            positive: value.prompt.positive,
            negative: value.prompt.negative,
        },
        parameters: value.parameters,
        outputPolicy: value.outputPolicy,
        resources: value.resources as unknown as GenerationJobSnapshot['resources'],
        resumability: value.resumability,
        ...(value.nonResumableReason === undefined
            ? {}
            : { nonResumableReason: value.nonResumableReason as 'volatile-resource' | 'runtime-only-capability' }),
    })
    if (typeof expectedHash !== 'string' || hashGenerationJobSnapshot(snapshot) !== expectedHash) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job snapshot hash mismatch')
    }
    return snapshot
}

function orderKeys(input: Pick<StoredJobRecord, 'batchId' | 'state' | 'priority' | 'ordinal' | 'createdAt' | 'id'>) {
    const suffix: IDBValidKey[] = [-input.priority, input.ordinal, input.createdAt, input.id]
    return {
        globalOrderKey: suffix,
        batchOrderKey: [input.batchId, ...suffix],
        stateOrderKey: [input.state, ...suffix],
    }
}

function parseStoredJob(value: unknown): StoredJobRecord {
    if (!isRecord(value) || value.recordSchemaVersion !== 2) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job record schema is invalid')
    }
    assertIdentifier(value.id, 'job id')
    assertIdentifier(value.batchId, 'batch id')
    assertWorkflow(value.workflow)
    if (value.sceneId !== null && typeof value.sceneId !== 'string') {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'scene id is invalid')
    }
    if (!isGenerationJobState(value.state)) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job state is invalid')
    }
    assertTimestamp(value.createdAt, 'createdAt')
    assertTimestamp(value.updatedAt, 'updatedAt')
    const numericFields: Record<string, unknown> = {
        priority: value.priority,
        ordinal: value.ordinal,
        snapshotSchemaVersion: value.snapshotSchemaVersion,
        attemptCount: value.attemptCount,
        maxAttempts: value.maxAttempts,
        version: value.version,
    }
    for (const [field, numericValue] of Object.entries(numericFields)) {
        if (!Number.isSafeInteger(numericValue) || (numericValue as number) < 0) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', `${field} is invalid`)
        }
    }
    if ((value.maxAttempts as number) < 1
        || (value.attemptCount as number) > (value.maxAttempts as number)) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'attempt budget is invalid')
    }
    assertIdentifier(value.idempotencyKey, 'idempotency key')
    assertProgress(value.progress)
    const snapshot = snapshotFromRecord(value.snapshot, value.snapshotHash)
    const parsed = {
        ...value,
        snapshot,
    } as unknown as StoredJobRecord
    const expectedOrder = orderKeys(parsed)
    if (canonicalSerialize(parsed.globalOrderKey) !== canonicalSerialize(expectedOrder.globalOrderKey)
        || canonicalSerialize(parsed.batchOrderKey) !== canonicalSerialize(expectedOrder.batchOrderKey)
        || canonicalSerialize(parsed.stateOrderKey) !== canonicalSerialize(expectedOrder.stateOrderKey)) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job ordering index is invalid')
    }
    return parsed
}

function parseLease(value: unknown): LeaseRecord | null {
    if (value === undefined || value === null) return null
    if (!isRecord(value)) throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'lease record is invalid')
    assertIdentifier(value.jobId, 'lease job id')
    assertIdentifier(value.owner, 'lease owner')
    assertIdentifier(value.token, 'lease token')
    assertTimestamp(value.expiresAt, 'lease expiry')
    assertTimestamp(value.heartbeatAt, 'lease heartbeat')
    return value as unknown as LeaseRecord
}

function aggregateJob(stored: StoredJobRecord, lease: LeaseRecord | null): GenerationJob {
    return {
        id: stored.id,
        batchId: stored.batchId,
        workflow: stored.workflow,
        sceneId: stored.sceneId,
        state: stored.state,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        priority: stored.priority,
        ordinal: stored.ordinal,
        snapshotSchemaVersion: stored.snapshotSchemaVersion,
        snapshot: stored.snapshot,
        snapshotHash: stored.snapshotHash,
        compositionPlanHash: stored.compositionPlanHash,
        attemptCount: stored.attemptCount,
        maxAttempts: stored.maxAttempts,
        idempotencyKey: stored.idempotencyKey,
        leaseOwner: lease?.owner ?? null,
        leaseToken: lease?.token ?? null,
        leaseExpiresAt: lease?.expiresAt ?? null,
        heartbeatAt: lease?.heartbeatAt ?? null,
        progress: { ...stored.progress },
        lastDiagnosticEventId: stored.lastDiagnosticEventId,
        outputTransactionId: stored.outputTransactionId,
        artifactReference: stored.artifactReference === null ? null : { ...stored.artifactReference },
        blockReason: stored.blockReason,
        version: stored.version,
    }
}

function storedJobFromInput(input: EnqueueGenerationJobInput): StoredJobRecord {
    assertIdentifier(input.id, 'job id')
    assertIdentifier(input.batchId, 'batch id')
    assertWorkflow(input.workflow)
    assertTimestamp(input.createdAt, 'createdAt')
    assertIdentifier(input.idempotencyKey, 'idempotency key')
    if (!Number.isSafeInteger(input.priority)
        || !Number.isSafeInteger(input.ordinal)
        || input.ordinal < 0
        || !Number.isSafeInteger(input.maxAttempts)
        || input.maxAttempts < 1) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job ordering or attempt budget is invalid')
    }
    assertGenerationJobSnapshotSafe(input.snapshot)
    const base = {
        recordSchemaVersion: 2 as const,
        id: input.id,
        batchId: input.batchId,
        workflow: input.workflow,
        sceneId: input.sceneId,
        state: 'queued' as const,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        priority: input.priority,
        ordinal: input.ordinal,
        snapshotSchemaVersion: input.snapshot.schemaVersion,
        snapshot: input.snapshot,
        snapshotHash: hashGenerationJobSnapshot(input.snapshot),
        compositionPlanHash: input.compositionPlanHash,
        attemptCount: 0,
        maxAttempts: input.maxAttempts,
        idempotencyKey: input.idempotencyKey,
        progress: { stage: 'queued', current: 0, total: 0 },
        lastDiagnosticEventId: null,
        outputTransactionId: null,
        artifactReference: null,
        blockReason: null,
        version: 1,
    }
    return { ...base, ...orderKeys(base) }
}

function migrateV1Job(value: unknown): { job: StoredJobRecord; lease: LeaseRecord | null } {
    if (!isRecord(value) || value.recordSchemaVersion !== 1) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'legacy queue job is invalid')
    }
    const candidate: Record<string, unknown> = {
        ...value,
        recordSchemaVersion: 2,
    }
    delete candidate.leaseOwner
    delete candidate.leaseToken
    delete candidate.leaseExpiresAt
    delete candidate.heartbeatAt
    const orderingCandidate = candidate as Record<string, unknown>
    if (typeof orderingCandidate.batchId === 'string'
        && typeof orderingCandidate.state === 'string'
        && typeof orderingCandidate.priority === 'number'
        && typeof orderingCandidate.ordinal === 'number'
        && typeof orderingCandidate.createdAt === 'string'
        && typeof orderingCandidate.id === 'string') {
        Object.assign(orderingCandidate, orderKeys(orderingCandidate as unknown as StoredJobRecord))
    }
    const job = parseStoredJob(candidate)
    const hasLease = typeof value.leaseOwner === 'string'
        || typeof value.leaseExpiresAt === 'string'
        || typeof value.heartbeatAt === 'string'
    if (!hasLease) return { job, lease: null }
    if (typeof value.leaseOwner !== 'string'
        || typeof value.leaseExpiresAt !== 'string'
        || typeof value.heartbeatAt !== 'string') {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'legacy lease is incomplete')
    }
    return {
        job,
        lease: {
            jobId: job.id,
            owner: value.leaseOwner,
            token: typeof value.leaseToken === 'string' ? value.leaseToken : `migrated:${job.id}`,
            expiresAt: value.leaseExpiresAt,
            heartbeatAt: value.heartbeatAt,
        },
    }
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string, options?: IDBIndexParameters): void {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options)
}

function ensureCurrentIndexes(transaction: IDBTransaction): void {
    const jobs = transaction.objectStore('jobs')
    ensureIndex(jobs, 'by-idempotency-key', 'idempotencyKey', { unique: true })
    ensureIndex(jobs, 'by-global-order', 'globalOrderKey')
    ensureIndex(jobs, 'by-batch-order', 'batchOrderKey')
    ensureIndex(jobs, 'by-state-order', 'stateOrderKey')
    const attempts = transaction.objectStore('attempts')
    ensureIndex(attempts, 'by-job-attempt', 'jobAttemptKey', { unique: true })
    const leases = transaction.objectStore('leases')
    ensureIndex(leases, 'by-expires-at', 'expiresAt')
    const resources = transaction.objectStore('resources')
    ensureIndex(resources, 'by-digest', 'digest')
    const batches = transaction.objectStore('batches')
    ensureIndex(batches, 'by-created-at', 'createdAt')
}

function upgradeQueueDatabase(database: IDBDatabase, transaction: IDBTransaction, oldVersion: number): void {
    if (oldVersion < 1) {
        database.createObjectStore('batches', { keyPath: 'id' })
        database.createObjectStore('jobs', { keyPath: 'id' })
        database.createObjectStore('attempts', { keyPath: 'id' })
    }
    if (oldVersion < 2) {
        if (!database.objectStoreNames.contains('leases')) {
            database.createObjectStore('leases', { keyPath: 'jobId' })
        }
        if (!database.objectStoreNames.contains('resources')) {
            database.createObjectStore('resources', { keyPath: 'id' })
        }
    }
    ensureCurrentIndexes(transaction)

    if (oldVersion === 1) {
        const jobs = transaction.objectStore('jobs')
        const leases = transaction.objectStore('leases')
        const cursorRequest = jobs.openCursor()
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (cursor === null) return
            try {
                const migrated = migrateV1Job(cursor.value)
                cursor.update(migrated.job)
                if (migrated.lease !== null) leases.put(migrated.lease)
                cursor.continue()
            } catch {
                transaction.abort()
            }
        }
        cursorRequest.onerror = () => transaction.abort()
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

function normalizeRepositoryError(error: unknown): QueueRepositoryError {
    if (error instanceof QueueRepositoryError) return error
    if (error instanceof QueueStateTransitionError) {
        return new QueueRepositoryError('E_QUEUE_INVALID_TRANSITION', error.message)
    }
    const name = isRecord(error) && typeof error.name === 'string' ? error.name : ''
    if (name === 'VersionError') {
        return new QueueRepositoryError('E_QUEUE_SCHEMA_NEWER', 'Queue database uses a newer schema')
    }
    if (name === 'AbortError' || name === 'ConstraintError') {
        return new QueueRepositoryError('E_QUEUE_TRANSACTION_ABORTED', 'Queue transaction was aborted')
    }
    return new QueueRepositoryError('E_QUEUE_DB_UNAVAILABLE', 'Queue database operation failed')
}

function encodeCursor(cursor: QueuePageCursor): string {
    return encodeURIComponent(JSON.stringify(cursor))
}

function decodeCursor(value: string): QueuePageCursor {
    let parsed: unknown
    try {
        parsed = JSON.parse(decodeURIComponent(value)) as unknown
    } catch {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Queue page cursor is invalid')
    }
    if (!isRecord(parsed)
        || (parsed.index !== 'global' && parsed.index !== 'batch' && parsed.index !== 'state')
        || !('key' in parsed)) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Queue page cursor is invalid')
    }
    return parsed as unknown as QueuePageCursor
}

function updateJobState(stored: StoredJobRecord, state: GenerationJobState, now: string): StoredJobRecord {
    const next = {
        ...stored,
        state,
        updatedAt: now,
        version: stored.version + 1,
    }
    return { ...next, ...orderKeys(next) }
}

export class IndexedDBQueueRepository {
    private readonly factory: IDBFactory
    private readonly keyRange: typeof IDBKeyRange
    private readonly databaseName: string
    private readonly openTimeoutMs: number
    private databasePromise: Promise<IDBDatabase> | null = null
    private activeDatabase: IDBDatabase | null = null

    constructor(options: IndexedDBQueueRepositoryOptions = {}) {
        const factory = options.factory ?? globalThis.indexedDB
        const keyRange = options.keyRange ?? globalThis.IDBKeyRange
        if (factory === undefined || keyRange === undefined) {
            throw new QueueRepositoryError('E_QUEUE_DB_UNAVAILABLE', 'IndexedDB is unavailable')
        }
        this.factory = factory
        this.keyRange = keyRange
        this.databaseName = options.databaseName ?? QUEUE_DATABASE_NAME
        this.openTimeoutMs = options.openTimeoutMs ?? 10_000
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
        this.databasePromise = new Promise((resolve, reject) => {
            let settled = false
            const timeout = setTimeout(() => {
                if (settled) return
                settled = true
                reject(new QueueRepositoryError('E_QUEUE_DB_UNAVAILABLE', 'Queue database open timed out'))
            }, this.openTimeoutMs)
            const finishResolve = (database: IDBDatabase) => {
                if (settled) return
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
                reject(normalizeRepositoryError(error))
            }
            let request: IDBOpenDBRequest
            try {
                request = this.factory.open(this.databaseName, QUEUE_DATABASE_VERSION)
            } catch (error) {
                finishReject(error)
                return
            }
            request.onupgradeneeded = event => {
                try {
                    upgradeQueueDatabase(request.result, request.transaction as IDBTransaction, event.oldVersion)
                } catch {
                    request.transaction?.abort()
                }
            }
            request.onsuccess = () => finishResolve(request.result)
            request.onerror = () => finishReject(request.error)
            request.onblocked = () => finishReject(
                new QueueRepositoryError('E_QUEUE_DB_BLOCKED', 'Queue database upgrade is blocked'),
            )
        })
        return this.databasePromise
    }

    private async runTransaction<T>(
        stores: readonly QueueStoreName[],
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
                // The transaction may already be complete or aborted.
            }
            await completed.catch(() => undefined)
            throw normalizeRepositoryError(error)
        }
    }

    async inspectSchema(): Promise<QueueRepositorySchemaInspection> {
        const database = await this.open()
        const transaction = database.transaction(STORE_NAMES, 'readonly')
        const completed = transactionDone(transaction)
        const indexes: Record<string, string[]> = {}
        for (const name of STORE_NAMES) {
            indexes[name] = Array.from(transaction.objectStore(name).indexNames).sort()
        }
        await completed
        return {
            version: database.version,
            stores: Array.from(database.objectStoreNames).sort(),
            indexes,
        }
    }

    async createBatch(input: CreateGenerationBatchInput): Promise<GenerationBatch> {
        assertIdentifier(input.id, 'batch id')
        assertWorkflow(input.workflow)
        assertTimestamp(input.createdAt, 'batch createdAt')
        const batch: GenerationBatch = {
            id: input.id,
            workflow: input.workflow,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
        }
        await this.runTransaction(['batches'], 'readwrite', async transaction => {
            const store = transaction.objectStore('batches')
            const existing = await requestResult(store.get(batch.id)) as GenerationBatch | undefined
            if (existing !== undefined && canonicalSerialize(existing) !== canonicalSerialize(batch)) {
                throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Batch identity already has different content')
            }
            if (existing === undefined) await requestResult(store.add(batch))
        })
        const readback = await this.runTransaction(['batches'], 'readonly', transaction => (
            requestResult(transaction.objectStore('batches').get(batch.id))
        ))
        if (canonicalSerialize(readback) !== canonicalSerialize(batch)) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Batch readback mismatch')
        }
        return structuredClone(batch)
    }

    async putResource(resource: QueueResourceRecord): Promise<QueueResourceRecord> {
        assertIdentifier(resource.id, 'resource id')
        assertTimestamp(resource.createdAt, 'resource createdAt')
        assertTimestamp(resource.updatedAt, 'resource updatedAt')
        assertGenerationJobSnapshotSafe({ reference: resource.reference })
        await this.runTransaction(['resources'], 'readwrite', async transaction => {
            await requestResult(transaction.objectStore('resources').put(resource))
        })
        const readback = await this.getResource(resource.id)
        if (readback === null || canonicalSerialize(readback) !== canonicalSerialize(resource)) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Resource readback mismatch')
        }
        return readback
    }

    async getResource(id: string): Promise<QueueResourceRecord | null> {
        const value = await this.runTransaction(['resources'], 'readonly', transaction => (
            requestResult(transaction.objectStore('resources').get(id))
        )) as QueueResourceRecord | undefined
        return value === undefined ? null : structuredClone(value)
    }

    enqueue(input: EnqueueGenerationJobInput): Promise<GenerationJob> {
        return this.enqueueMany([input]).then(jobs => jobs[0])
    }

    async enqueueMany(inputs: readonly EnqueueGenerationJobInput[]): Promise<GenerationJob[]> {
        if (inputs.length === 0) return []
        const candidates = inputs.map(storedJobFromInput)
        if (new Set(candidates.map(job => job.id)).size !== candidates.length
            || new Set(candidates.map(job => job.idempotencyKey)).size !== candidates.length) {
            throw new QueueRepositoryError('E_QUEUE_IDEMPOTENCY_CONFLICT', 'Enqueue batch contains duplicate identity')
        }

        const selected = await this.runTransaction(['batches', 'jobs'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const idempotency = jobs.index('by-idempotency-key')
            const batchIds = [...new Set(candidates.map(job => job.batchId))]
            const batchValues = await Promise.all(batchIds.map(id => requestResult(batches.get(id))))
            const batchById = new Map(batchIds.map((id, index) => [id, batchValues[index] as GenerationBatch | undefined]))
            for (const candidate of candidates) {
                const batch = batchById.get(candidate.batchId)
                if (batch === undefined) {
                    throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
                }
                if (batch.workflow !== candidate.workflow) {
                    throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Job workflow does not match its batch')
                }
            }

            const existingValues = await Promise.all(candidates.map(candidate => (
                requestResult(idempotency.get(candidate.idempotencyKey))
            )))
            const result: StoredJobRecord[] = []
            const additions: StoredJobRecord[] = []
            for (let index = 0; index < candidates.length; index += 1) {
                const candidate = candidates[index]
                const existingValue = existingValues[index]
                if (existingValue === undefined) {
                    additions.push(candidate)
                    result.push(candidate)
                    continue
                }
                const existing = parseStoredJob(existingValue)
                if (existing.snapshotHash !== candidate.snapshotHash
                    || existing.batchId !== candidate.batchId
                    || existing.workflow !== candidate.workflow
                    || existing.sceneId !== candidate.sceneId
                    || existing.compositionPlanHash !== candidate.compositionPlanHash) {
                    throw new QueueRepositoryError(
                        'E_QUEUE_IDEMPOTENCY_CONFLICT',
                        'Idempotency key already represents different immutable work',
                    )
                }
                result.push(existing)
            }
            await Promise.all(additions.map(candidate => requestResult(jobs.add(candidate))))
            return result
        })

        const readback = await this.getJobsByIds(selected.map(job => job.id))
        for (let index = 0; index < selected.length; index += 1) {
            if (readback[index] === null
                || readback[index]?.snapshotHash !== selected[index].snapshotHash
                || readback[index]?.version !== selected[index].version) {
                throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Enqueued job readback mismatch')
            }
        }
        return readback as GenerationJob[]
    }

    private async getJobsByIds(ids: readonly string[]): Promise<(GenerationJob | null)[]> {
        return this.runTransaction(['jobs', 'leases'], 'readonly', async transaction => {
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const [jobValues, leaseValues] = await Promise.all([
                Promise.all(ids.map(id => requestResult(jobs.get(id)))),
                Promise.all(ids.map(id => requestResult(leases.get(id)))),
            ])
            return jobValues.map((value, index) => (
                value === undefined ? null : aggregateJob(parseStoredJob(value), parseLease(leaseValues[index]))
            ))
        })
    }

    async getJob(id: string): Promise<GenerationJob | null> {
        return (await this.getJobsByIds([id]))[0]
    }

    async acquireLease(input: AcquireQueueLeaseInput): Promise<GenerationJob | null> {
        assertIdentifier(input.owner, 'lease owner')
        assertTimestamp(input.now, 'lease time')
        if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Lease ttl is invalid')
        }
        const result = await this.runTransaction(['jobs', 'leases'], 'readwrite', async transaction => {
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const storedValue = await requestResult(jobs.get(input.jobId))
            if (storedValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(storedValue)
            const existing = parseLease(await requestResult(leases.get(input.jobId)))
            if (existing !== null || (stored.state !== 'queued' && stored.state !== 'recovering')) return null
            assertJobTransition(stored.state, 'leased')
            const lease: LeaseRecord = {
                jobId: stored.id,
                owner: input.owner,
                token: `lease:${crypto.randomUUID()}`,
                expiresAt: new Date(Date.parse(input.now) + input.ttlMs).toISOString(),
                heartbeatAt: input.now,
            }
            const next = updateJobState(stored, 'leased', input.now)
            await Promise.all([
                requestResult(jobs.put(next)),
                requestResult(leases.add(lease)),
            ])
            return { next, lease }
        })
        if (result === null) return null
        const readback = await this.getJob(input.jobId)
        if (readback?.version !== result.next.version
            || readback.leaseToken !== result.lease.token
            || readback.leaseOwner !== input.owner) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Lease readback mismatch')
        }
        return readback
    }

    async heartbeatLease(input: HeartbeatQueueLeaseInput): Promise<GenerationJob> {
        assertTimestamp(input.now, 'heartbeat time')
        const expectedExpiry = new Date(Date.parse(input.now) + input.ttlMs).toISOString()
        await this.runTransaction(['jobs', 'leases'], 'readwrite', async transaction => {
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const [jobValue, leaseValue] = await Promise.all([
                requestResult(jobs.get(input.jobId)),
                requestResult(leases.get(input.jobId)),
            ])
            if (jobValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const job = parseStoredJob(jobValue)
            const lease = parseLease(leaseValue)
            if (lease === null
                || lease.owner !== input.owner
                || lease.token !== input.token
                || (job.state !== 'leased' && job.state !== 'running')) {
                throw new QueueRepositoryError('E_QUEUE_LEASE_LOST', 'Queue lease is no longer owned')
            }
            await requestResult(leases.put({
                ...lease,
                expiresAt: expectedExpiry,
                heartbeatAt: input.now,
            }))
        })
        const readback = await this.getJob(input.jobId)
        if (readback === null || readback.heartbeatAt !== input.now || readback.leaseExpiresAt !== expectedExpiry) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Heartbeat readback mismatch')
        }
        return readback
    }

    async transitionJob(input: TransitionGenerationJobInput): Promise<GenerationJob> {
        assertTimestamp(input.now, 'transition time')
        const result = await this.runTransaction(['jobs', 'leases', 'attempts'], 'readwrite', async transaction => {
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const attempts = transaction.objectStore('attempts')
            const storedValue = await requestResult(jobs.get(input.jobId))
            if (storedValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(storedValue)
            const lease = parseLease(await requestResult(leases.get(input.jobId)))
            if (stored.state === input.to) return { stored, lease, idempotent: true }
            if (isTerminalJobState(stored.state)) {
                throw new QueueRepositoryError('E_QUEUE_TERMINAL_IMMUTABLE', 'Terminal queue jobs are immutable')
            }
            if (input.expectedVersion !== undefined && stored.version !== input.expectedVersion) {
                throw new QueueRepositoryError('E_QUEUE_INVALID_TRANSITION', 'Queue job version changed')
            }
            try {
                assertJobTransition(stored.state, input.to)
            } catch (error) {
                throw normalizeRepositoryError(error)
            }
            if (input.to === 'leased') {
                throw new QueueRepositoryError('E_QUEUE_INVALID_TRANSITION', 'Leases must be acquired through CAS')
            }
            if (stored.state === 'leased' || stored.state === 'running') {
                if (lease === null
                    || input.leaseOwner === undefined
                    || lease.owner !== input.leaseOwner
                    || Date.parse(lease.expiresAt) < Date.parse(input.now)) {
                    throw new QueueRepositoryError('E_QUEUE_LEASE_LOST', 'Queue lease is no longer owned')
                }
            }

            let next = updateJobState(stored, input.to, input.now)
            if (stored.state === 'leased' && input.to === 'running') {
                if (stored.attemptCount >= stored.maxAttempts) {
                    throw new QueueRepositoryError('E_QUEUE_INVALID_TRANSITION', 'Queue attempt budget is exhausted')
                }
                const attemptNumber = stored.attemptCount + 1
                next = { ...next, attemptCount: attemptNumber }
                const attempt: GenerationAttempt & { jobAttemptKey: IDBValidKey } = {
                    id: `${stored.id}:${attemptNumber}`,
                    jobId: stored.id,
                    attemptNumber,
                    startedAt: input.now,
                    finishedAt: null,
                    outcome: 'running',
                    diagnosticEventId: null,
                    jobAttemptKey: [stored.id, attemptNumber],
                }
                await requestResult(attempts.add(attempt))
            }

            const finishesAttempt = stored.state === 'running'
                && (input.to === 'succeeded'
                    || input.to === 'failed'
                    || input.to === 'cancelled'
                    || input.to === 'recovering'
                    || input.to === 'blocked')
            if (finishesAttempt) {
                const attemptId = `${stored.id}:${stored.attemptCount}`
                const attemptValue = await requestResult(attempts.get(attemptId))
                if (!isRecord(attemptValue)) {
                    throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Active queue attempt is missing')
                }
                const outcome = input.to === 'recovering' || input.to === 'blocked'
                    ? 'interrupted'
                    : input.to
                await requestResult(attempts.put({
                    ...attemptValue,
                    finishedAt: input.now,
                    outcome,
                    diagnosticEventId: input.lastDiagnosticEventId ?? null,
                }))
            }

            next = {
                ...next,
                ...(input.lastDiagnosticEventId === undefined
                    ? {}
                    : { lastDiagnosticEventId: input.lastDiagnosticEventId }),
                ...(input.outputTransactionId === undefined
                    ? {}
                    : { outputTransactionId: input.outputTransactionId }),
                ...(input.artifactReference === undefined
                    ? {}
                    : { artifactReference: input.artifactReference }),
                blockReason: input.to === 'blocked' ? input.blockReason ?? 'missing-resource' : null,
            }
            await requestResult(jobs.put(next))
            if (input.to !== 'running' && lease !== null) await requestResult(leases.delete(stored.id))
            return { stored: next, lease: input.to === 'running' ? lease : null, idempotent: false }
        })
        if (result.idempotent) return aggregateJob(result.stored, result.lease)
        const readback = await this.getJob(input.jobId)
        if (readback === null || readback.version !== result.stored.version || readback.state !== input.to) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Queue transition readback mismatch')
        }
        return readback
    }

    async updateProgress(input: {
        jobId: string
        leaseOwner: string
        now: string
        progress: GenerationJobProgress
        lastDiagnosticEventId?: string | null
    }): Promise<GenerationJob> {
        assertTimestamp(input.now, 'progress time')
        assertProgress(input.progress)
        const nextVersion = await this.runTransaction(['jobs', 'leases'], 'readwrite', async transaction => {
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const [jobValue, leaseValue] = await Promise.all([
                requestResult(jobs.get(input.jobId)),
                requestResult(leases.get(input.jobId)),
            ])
            if (jobValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(jobValue)
            const lease = parseLease(leaseValue)
            if (isTerminalJobState(stored.state)) {
                throw new QueueRepositoryError('E_QUEUE_TERMINAL_IMMUTABLE', 'Terminal queue jobs are immutable')
            }
            if (lease === null || lease.owner !== input.leaseOwner || stored.state !== 'running') {
                throw new QueueRepositoryError('E_QUEUE_LEASE_LOST', 'Queue lease is no longer owned')
            }
            const next = {
                ...stored,
                updatedAt: input.now,
                progress: { ...input.progress },
                version: stored.version + 1,
                ...(input.lastDiagnosticEventId === undefined
                    ? {}
                    : { lastDiagnosticEventId: input.lastDiagnosticEventId }),
            }
            await requestResult(jobs.put(next))
            return next.version
        })
        const readback = await this.getJob(input.jobId)
        if (readback === null || readback.version !== nextVersion) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Progress readback mismatch')
        }
        return readback
    }

    async recoverExpiredLeases(now: string): Promise<string[]> {
        assertTimestamp(now, 'recovery time')
        const recoveredIds = await this.runTransaction(['jobs', 'leases', 'attempts'], 'readwrite', async transaction => {
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const attempts = transaction.objectStore('attempts')
            const expired = await requestResult(
                leases.index('by-expires-at').getAll(this.keyRange.upperBound(now)),
            ) as LeaseRecord[]
            const values = await Promise.all(expired.map(lease => requestResult(jobs.get(lease.jobId))))
            const ids: string[] = []
            for (let index = 0; index < expired.length; index += 1) {
                const value = values[index]
                if (value === undefined) {
                    await requestResult(leases.delete(expired[index].jobId))
                    continue
                }
                const stored = parseStoredJob(value)
                if (stored.state !== 'leased' && stored.state !== 'running') {
                    await requestResult(leases.delete(stored.id))
                    continue
                }
                const next = updateJobState(stored, 'recovering', now)
                if (stored.state === 'running') {
                    const attemptId = `${stored.id}:${stored.attemptCount}`
                    const attempt = await requestResult(attempts.get(attemptId))
                    if (!isRecord(attempt)) {
                        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Expired running attempt is missing')
                    }
                    await requestResult(attempts.put({
                        ...attempt,
                        finishedAt: now,
                        outcome: 'interrupted',
                    }))
                }
                await Promise.all([
                    requestResult(jobs.put(next)),
                    requestResult(leases.delete(stored.id)),
                ])
                ids.push(stored.id)
            }
            return ids.sort()
        })
        const readback = await this.getJobsByIds(recoveredIds)
        if (readback.some(job => job?.state !== 'recovering' || job.leaseOwner !== null)) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Lease recovery readback mismatch')
        }
        return recoveredIds
    }

    async listAttempts(jobId: string): Promise<GenerationAttempt[]> {
        return this.runTransaction(['attempts'], 'readonly', async transaction => {
            const index = transaction.objectStore('attempts').index('by-job-attempt')
            const range = this.keyRange.bound([jobId], [jobId, []])
            const values = await requestResult(index.getAll(range)) as (GenerationAttempt & { jobAttemptKey: IDBValidKey })[]
            return values
                .sort((left, right) => left.attemptNumber - right.attemptNumber)
                .map(({ jobAttemptKey: _jobAttemptKey, ...attempt }) => structuredClone(attempt))
        })
    }

    async listJobs(input: ListGenerationJobsInput = {}): Promise<GenerationJobPage> {
        const limit = input.limit ?? 100
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Queue page limit is invalid')
        }
        const states = input.states === undefined ? null : new Set(input.states)
        const decoded = input.cursor ? decodeCursor(input.cursor) : null
        const indexKind = input.batchId !== undefined
            ? 'batch'
            : states !== null && states.size === 1
                ? 'state'
                : 'global'
        const singleState = indexKind === 'state' ? [...states as Set<GenerationJobState>][0] : null
        if (decoded !== null
            && (decoded.index !== indexKind
                || decoded.batchId !== (input.batchId ?? null)
                || decoded.state !== singleState)) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Queue page cursor scope changed')
        }

        const selected = await this.runTransaction(['jobs'], 'readonly', transaction => new Promise<{
            records: StoredJobRecord[]
            hasMore: boolean
            lastKey: IDBValidKey | null
        }>((resolve, reject) => {
            const store = transaction.objectStore('jobs')
            const index = indexKind === 'batch'
                ? store.index('by-batch-order')
                : indexKind === 'state'
                    ? store.index('by-state-order')
                    : store.index('by-global-order')
            let range: IDBKeyRange | undefined
            if (indexKind === 'batch') {
                const upper = [input.batchId as string, []]
                range = decoded === null
                    ? this.keyRange.bound([input.batchId as string], upper)
                    : this.keyRange.bound(decoded.key, upper, true, false)
            } else if (indexKind === 'state') {
                const upper = [singleState as string, []]
                range = decoded === null
                    ? this.keyRange.bound([singleState as string], upper)
                    : this.keyRange.bound(decoded.key, upper, true, false)
            } else if (decoded !== null) {
                range = this.keyRange.lowerBound(decoded.key, true)
            }
            const records: StoredJobRecord[] = []
            let lastKey: IDBValidKey | null = null
            const request = index.openCursor(range)
            request.onerror = () => reject(request.error ?? new Error('Queue cursor failed'))
            request.onsuccess = () => {
                const cursor = request.result
                if (cursor === null) {
                    resolve({ records, hasMore: false, lastKey })
                    return
                }
                const record = parseStoredJob(cursor.value)
                if (states !== null && !states.has(record.state)) {
                    cursor.continue()
                    return
                }
                if (records.length === limit) {
                    resolve({ records, hasMore: true, lastKey })
                    return
                }
                records.push(record)
                lastKey = cursor.key
                cursor.continue()
            }
        }))

        const jobs = await this.getJobsByIds(selected.records.map(record => record.id)) as GenerationJob[]
        return {
            items: jobs,
            nextCursor: selected.hasMore && selected.lastKey !== null
                ? encodeCursor({
                    index: indexKind,
                    batchId: input.batchId ?? null,
                    state: singleState,
                    key: selected.lastKey,
                })
                : null,
        }
    }
}
