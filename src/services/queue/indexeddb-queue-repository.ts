import { canonicalSerialize, hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import {
    assertJobTransition,
    isGenerationJobState,
    isTerminalJobState,
    QueueStateTransitionError,
} from '@/domain/queue/state-machine'
import {
    applyGenerationJobProjectionDelta,
    createEmptyGenerationBatchSummary,
} from '@/domain/queue/summary'
import { GENERATION_JOB_STATES } from '@/domain/queue/types'
import type {
    GenerationAttempt,
    GenerationBatch,
    GenerationBatchProjectionMeta,
    GenerationBatchSummary,
    GenerationJob,
    GenerationJobProjection,
    GenerationJobProjectionWindow,
    GenerationJobProgress,
    GenerationJobSnapshot,
    GenerationJobState,
    GenerationWorkflow,
    QueueArtifactReference,
    QueueBatchOrigin,
    QueueBlockReason,
    QueueActivitySummary,
    QueueFailureKind,
    QueueFailurePolicy,
    QueuePauseReason,
    QueueResourceRecord,
} from '@/domain/queue/types'
import {
    assertGenerationJobSnapshotSafe,
    createGenerationJobSnapshot,
    hashGenerationJobSnapshot,
} from './job-snapshot'

// Physical database names stay stable so generation jobs survive the rename.
export const QUEUE_DATABASE_NAME = 'nai-blue-durable-generation-queue'
export const QUEUE_DATABASE_VERSION = 5

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
    | 'E_QUEUE_CANCEL_REQUESTED'

export class QueueRepositoryError extends Error {
    constructor(readonly code: QueueRepositoryErrorCode, message: string) {
        super(message)
        this.name = 'QueueRepositoryError'
    }
}

interface StoredJobRecord {
    recordSchemaVersion: 4
    id: string
    batchId: string
    workflow: GenerationWorkflow
    sceneId: string | null
    state: GenerationJobState
    createdAt: string
    updatedAt: string
    priority: number
    /** Denormalized batch order required by IndexedDB's join-free global index. */
    queueSequence: number
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
    readyAt: string
    cancelRequestedAt: string | null
    cancelReason: 'user' | 'batch' | 'shutdown' | null
    retryOfJobId: string | null
    rootJobId: string
    version: number
    globalOrderKey: IDBValidKey
    batchOrderKey: IDBValidKey
    batchStateOrderKey: IDBValidKey
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
    failurePolicy?: QueueFailurePolicy
    origin?: QueueBatchOrigin
    idempotencyKey?: string
}

export interface DurableGenerationBatchInput extends CreateGenerationBatchInput {
    failurePolicy: QueueFailurePolicy
    origin: QueueBatchOrigin
    idempotencyKey: string
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
    readyAt?: string
    retryOfJobId?: string | null
    rootJobId?: string
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
    leaseToken?: string
    expectedVersion?: number
    lastDiagnosticEventId?: string | null
    outputTransactionId?: string | null
    artifactReference?: QueueArtifactReference | null
    blockReason?: QueueBlockReason | null
    failureKind?: QueueFailureKind | null
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

export interface GenerationJobProjectionPage {
    items: GenerationJobProjection[]
    nextCursor: string | null
}

export interface ListGenerationJobProjectionWindowInput {
    batchId: string
    /** Queue Center has one status filter at a time, enabling an indexed window. */
    state?: GenerationJobState
    offset: number
    limit: number
}

export interface CreateBatchAndEnqueueInput {
    batch: DurableGenerationBatchInput
    jobs: readonly EnqueueGenerationJobInput[]
    resources?: readonly QueueResourceRecord[]
}

export interface CreateBatchAndEnqueueResult {
    batch: GenerationBatch
    jobs: GenerationJob[]
}

export interface QueueRepositorySchemaInspection {
    version: number
    stores: string[]
    indexes: Record<string, string[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function projectionOutputDirectory(snapshot: GenerationJobSnapshot): string | null {
    const policy = snapshot.outputPolicy
    if (!isRecord(policy)) return null
    if (policy.workflow === 'main' && isRecord(policy.output) && typeof policy.output.directory === 'string') {
        return policy.output.directory
    }
    if (policy.workflow !== 'scene' || !isRecord(policy.outputContext)) return null
    if (typeof policy.outputContext.directory === 'string') return policy.outputContext.directory
    if (!isRecord(policy.saveContext) || typeof policy.saveContext.sceneSavePath !== 'string') return null
    const segments = Array.isArray(policy.outputContext.presetPathSegments)
        ? policy.outputContext.presetPathSegments.filter((value): value is string => typeof value === 'string')
        : typeof policy.outputContext.presetName === 'string'
            ? [policy.outputContext.presetName]
            : []
    if (typeof policy.outputContext.sceneName === 'string') segments.push(policy.outputContext.sceneName)
    return [policy.saveContext.sceneSavePath, ...segments].filter(Boolean).join('/')
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

function assertFailurePolicy(value: unknown): asserts value is QueueFailurePolicy {
    if (value !== 'continue' && value !== 'pause-on-fatal' && value !== 'stop-on-first-error') {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'failure policy is invalid')
    }
}

function assertBatchOrigin(value: unknown): asserts value is QueueBatchOrigin {
    if (value !== 'fresh' && value !== 'legacy-conversion' && value !== 'retry') {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch origin is invalid')
    }
}

function parseBatchProjectionSummary(value: unknown, batchId: string): GenerationBatchSummary {
    if (value === undefined) return createEmptyGenerationBatchSummary(batchId)
    if (!isRecord(value)
        || value.batchId !== batchId
        || typeof value.total !== 'number'
        || !Number.isSafeInteger(value.total)
        || typeof value.completed !== 'number'
        || !Number.isSafeInteger(value.completed)
        || typeof value.progressCurrent !== 'number'
        || typeof value.progressTotal !== 'number'
        || !Number.isFinite(value.progressCurrent)
        || !Number.isFinite(value.progressTotal)
        || !isRecord(value.states)
        || !Array.isArray(value.recentCompletedAt)) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch projection summary is invalid')
    }
    const states = {} as Record<GenerationJobState, number>
    for (const state of GENERATION_JOB_STATES) {
        const count = value.states[state]
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch projection state count is invalid')
        }
        states[state] = count
    }
    const recentCompletedAt = value.recentCompletedAt
    if (recentCompletedAt.length > 20 || recentCompletedAt.some(timestamp => (
        typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))
    ))) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch projection completion window is invalid')
    }
    return {
        batchId,
        total: value.total as number,
        completed: value.completed as number,
        progressCurrent: value.progressCurrent as number,
        progressTotal: value.progressTotal as number,
        states,
        recentCompletedAt: [...recentCompletedAt],
    }
}

function parseBatch(value: unknown): GenerationBatch {
    if (!isRecord(value)) throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch record is invalid')
    assertIdentifier(value.id, 'batch id')
    assertWorkflow(value.workflow)
    assertTimestamp(value.createdAt, 'batch createdAt')
    assertTimestamp(value.updatedAt, 'batch updatedAt')
    if (value.state !== 'active' && value.state !== 'paused' && value.state !== 'stopped') {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch state is invalid')
    }
    assertFailurePolicy(value.failurePolicy)
    if (value.pauseReason !== null
        && value.pauseReason !== 'user'
        && value.pauseReason !== 'authentication'
        && value.pauseReason !== 'local-io'
        && value.pauseReason !== 'fatal'
        && value.pauseReason !== 'first-error') {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch pause reason is invalid')
    }
    assertBatchOrigin(value.origin)
    assertIdentifier(value.idempotencyKey, 'batch idempotency key')
    if (!Number.isSafeInteger(value.queueSequence) || (value.queueSequence as number) < 1) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch queue sequence is invalid')
    }
    if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch version is invalid')
    }
    const projectionRevision = value.projectionRevision === undefined ? 0 : value.projectionRevision
    if (!Number.isSafeInteger(projectionRevision) || (projectionRevision as number) < 0) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch projection revision is invalid')
    }
    return {
        ...value,
        projectionRevision,
        projectionSummary: parseBatchProjectionSummary(value.projectionSummary, value.id as string),
    } as unknown as GenerationBatch
}

function batchFromInput(input: CreateGenerationBatchInput, queueSequence: number): GenerationBatch {
    assertIdentifier(input.id, 'batch id')
    assertWorkflow(input.workflow)
    assertTimestamp(input.createdAt, 'batch createdAt')
    const failurePolicy = input.failurePolicy ?? 'continue'
    const origin = input.origin ?? 'fresh'
    const idempotencyKey = input.idempotencyKey ?? `batch:${input.id}`
    assertFailurePolicy(failurePolicy)
    assertBatchOrigin(origin)
    assertIdentifier(idempotencyKey, 'batch idempotency key')
    if (!Number.isSafeInteger(queueSequence) || queueSequence < 1) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch queue sequence is invalid')
    }
    return {
        id: input.id,
        workflow: input.workflow,
        queueSequence,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        state: 'active',
        failurePolicy,
        pauseReason: null,
        origin,
        idempotencyKey,
        version: 1,
        projectionRevision: 0,
        projectionSummary: createEmptyGenerationBatchSummary(input.id),
    }
}

/**
 * Batch controls are intentionally mutable. Replaying an enqueue after pause,
 * resume, or a failure-policy edit must resolve to the original immutable
 * batch identity instead of being mistaken for different work.
 */
function hasSameBatchIdentity(left: GenerationBatch, right: GenerationBatch): boolean {
    return left.id === right.id
        && left.workflow === right.workflow
        && left.origin === right.origin
        && left.idempotencyKey === right.idempotencyKey
}

function hasSameResourceIdentity(left: QueueResourceRecord, right: QueueResourceRecord): boolean {
    return left.id === right.id
        && left.persistence === right.persistence
        && left.digest === right.digest
        && canonicalSerialize(left.reference) === canonicalSerialize(right.reference)
}

function selectResourceRecord(
    existing: QueueResourceRecord,
    candidate: QueueResourceRecord,
): QueueResourceRecord {
    if (!hasSameResourceIdentity(existing, candidate)) {
        throw new QueueRepositoryError(
            'E_QUEUE_IDEMPOTENCY_CONFLICT',
            'Resource identity already represents different content',
        )
    }
    return existing.availability === 'available' || candidate.availability !== 'available'
        ? existing
        : { ...existing, availability: 'available', updatedAt: candidate.updatedAt }
}

function assertProgress(value: unknown): asserts value is GenerationJobProgress {
    if (!isRecord(value)
        || typeof value.stage !== 'string'
        || typeof value.current !== 'number'
        || typeof value.total !== 'number'
        || !Number.isFinite(value.current)
        || !Number.isFinite(value.total)
        || value.current < 0
        || value.total < 0
        || value.current > value.total) {
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

function orderKeys(input: Pick<
    StoredJobRecord,
    'batchId' | 'state' | 'priority' | 'queueSequence' | 'ordinal' | 'createdAt' | 'id'
>) {
    const globalSuffix: IDBValidKey[] = [
        -input.priority,
        input.queueSequence,
        input.ordinal,
        input.createdAt,
        input.id,
    ]
    const batchSuffix: IDBValidKey[] = [-input.priority, input.ordinal, input.createdAt, input.id]
    return {
        globalOrderKey: globalSuffix,
        batchOrderKey: [input.batchId, ...batchSuffix],
        batchStateOrderKey: [input.batchId, input.state, ...batchSuffix],
        stateOrderKey: [input.state, ...globalSuffix],
    }
}

function parseStoredJob(value: unknown): StoredJobRecord {
    if (!isRecord(value) || value.recordSchemaVersion !== 4) {
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
        queueSequence: value.queueSequence,
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
    if ((value.queueSequence as number) < 1
        || (value.maxAttempts as number) < 1
        || (value.attemptCount as number) > (value.maxAttempts as number)) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job queue sequence or attempt budget is invalid')
    }
    assertIdentifier(value.idempotencyKey, 'idempotency key')
    assertProgress(value.progress)
    assertTimestamp(value.readyAt, 'readyAt')
    if (value.cancelRequestedAt !== null) assertTimestamp(value.cancelRequestedAt, 'cancelRequestedAt')
    if (value.cancelReason !== null
        && value.cancelReason !== 'user'
        && value.cancelReason !== 'batch'
        && value.cancelReason !== 'shutdown') {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'cancel reason is invalid')
    }
    if (value.retryOfJobId !== null) assertIdentifier(value.retryOfJobId, 'retry source job id')
    assertIdentifier(value.rootJobId, 'root job id')
    const snapshot = snapshotFromRecord(value.snapshot, value.snapshotHash)
    const parsed = {
        ...value,
        snapshot,
    } as unknown as StoredJobRecord
    const expectedOrder = orderKeys(parsed)
    if (canonicalSerialize(parsed.globalOrderKey) !== canonicalSerialize(expectedOrder.globalOrderKey)
        || canonicalSerialize(parsed.batchOrderKey) !== canonicalSerialize(expectedOrder.batchOrderKey)
        || canonicalSerialize(parsed.batchStateOrderKey) !== canonicalSerialize(expectedOrder.batchStateOrderKey)
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
        readyAt: stored.readyAt,
        cancelRequestedAt: stored.cancelRequestedAt,
        cancelReason: stored.cancelReason,
        retryOfJobId: stored.retryOfJobId,
        rootJobId: stored.rootJobId,
        version: stored.version,
    }
}

function storedJobFromInput(input: EnqueueGenerationJobInput, queueSequence: number): StoredJobRecord {
    assertIdentifier(input.id, 'job id')
    assertIdentifier(input.batchId, 'batch id')
    assertWorkflow(input.workflow)
    assertTimestamp(input.createdAt, 'createdAt')
    assertTimestamp(input.readyAt ?? input.createdAt, 'readyAt')
    assertIdentifier(input.idempotencyKey, 'idempotency key')
    if (input.retryOfJobId !== undefined && input.retryOfJobId !== null) {
        assertIdentifier(input.retryOfJobId, 'retry source job id')
    }
    if (input.rootJobId !== undefined) assertIdentifier(input.rootJobId, 'root job id')
    if (!Number.isSafeInteger(input.priority)
        || !Number.isSafeInteger(input.ordinal)
        || input.ordinal < 0
        || !Number.isSafeInteger(input.maxAttempts)
        || input.maxAttempts < 1
        || !Number.isSafeInteger(queueSequence)
        || queueSequence < 1) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'job ordering or attempt budget is invalid')
    }
    assertGenerationJobSnapshotSafe(input.snapshot)
    const base = {
        recordSchemaVersion: 4 as const,
        id: input.id,
        batchId: input.batchId,
        workflow: input.workflow,
        sceneId: input.sceneId,
        state: 'queued' as const,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        priority: input.priority,
        queueSequence,
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
        readyAt: input.readyAt ?? input.createdAt,
        cancelRequestedAt: null,
        cancelReason: null,
        retryOfJobId: input.retryOfJobId ?? null,
        rootJobId: input.rootJobId ?? input.retryOfJobId ?? input.id,
        version: 1,
    }
    return { ...base, ...orderKeys(base) }
}

function migrateLegacyJob(
    value: unknown,
    queueSequence: number,
): { job: StoredJobRecord; lease: LeaseRecord | null } {
    if (!isRecord(value)
        || (value.recordSchemaVersion !== 1
            && value.recordSchemaVersion !== 2
            && value.recordSchemaVersion !== 3)) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'legacy queue job is invalid')
    }
    const preservesV3RuntimeFields = value.recordSchemaVersion === 3
    const candidate: Record<string, unknown> = {
        ...value,
        recordSchemaVersion: 4,
        queueSequence,
        readyAt: typeof value.readyAt === 'string' ? value.readyAt : value.createdAt,
        cancelRequestedAt: preservesV3RuntimeFields ? value.cancelRequestedAt : null,
        cancelReason: preservesV3RuntimeFields ? value.cancelReason : null,
        retryOfJobId: preservesV3RuntimeFields ? value.retryOfJobId : null,
        rootJobId: preservesV3RuntimeFields ? value.rootJobId : value.id,
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
    const hasLease = value.recordSchemaVersion === 1 && (typeof value.leaseOwner === 'string'
        || typeof value.leaseExpiresAt === 'string'
        || typeof value.heartbeatAt === 'string')
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

function migrateLegacyBatch(value: unknown, queueSequence: number): GenerationBatch {
    if (!isRecord(value)) throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'legacy batch is invalid')
    return parseBatch({
        ...value,
        state: value.state ?? 'active',
        failurePolicy: value.failurePolicy ?? 'continue',
        pauseReason: value.pauseReason ?? null,
        origin: value.origin ?? 'fresh',
        idempotencyKey: value.idempotencyKey ?? `batch:${String(value.id ?? '')}`,
        version: value.version ?? 1,
        queueSequence,
    })
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string, options?: IDBIndexParameters): void {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options)
}

function ensureCurrentIndexes(transaction: IDBTransaction): void {
    const jobs = transaction.objectStore('jobs')
    ensureIndex(jobs, 'by-idempotency-key', 'idempotencyKey', { unique: true })
    ensureIndex(jobs, 'by-global-order', 'globalOrderKey')
    ensureIndex(jobs, 'by-batch-order', 'batchOrderKey')
    ensureIndex(jobs, 'by-batch-state-order', 'batchStateOrderKey')
    ensureIndex(jobs, 'by-state-order', 'stateOrderKey')
    ensureIndex(jobs, 'by-output-transaction', 'outputTransactionId', { unique: true })
    const attempts = transaction.objectStore('attempts')
    ensureIndex(attempts, 'by-job-attempt', 'jobAttemptKey', { unique: true })
    const leases = transaction.objectStore('leases')
    ensureIndex(leases, 'by-expires-at', 'expiresAt')
    const resources = transaction.objectStore('resources')
    ensureIndex(resources, 'by-digest', 'digest')
    const batches = transaction.objectStore('batches')
    ensureIndex(batches, 'by-created-at', 'createdAt')
    ensureIndex(batches, 'by-idempotency-key', 'idempotencyKey', { unique: true })
    ensureIndex(batches, 'by-queue-sequence', 'queueSequence', { unique: true })
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

    if (oldVersion < 5) {
        const batches = transaction.objectStore('batches')
        const jobs = transaction.objectStore('jobs')
        const leases = transaction.objectStore('leases')
        const batchSequenceById = new Map<string, number>()
        const summaries = new Map<string, GenerationBatchSummary>()
        const batchRequest = batches.getAll()
        batchRequest.onsuccess = () => {
            try {
                const orderedBatches = (batchRequest.result as unknown[])
                    .map(value => {
                        if (!isRecord(value)) {
                            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'legacy batch is invalid')
                        }
                        assertIdentifier(value.id, 'batch id')
                        assertTimestamp(value.createdAt, 'batch createdAt')
                        return value
                    })
                    .sort((left, right) => (
                        String(left.createdAt).localeCompare(String(right.createdAt))
                        || String(left.id).localeCompare(String(right.id))
                    ))
                orderedBatches.forEach((value, index) => {
                    const batch = migrateLegacyBatch(value, index + 1)
                    batchSequenceById.set(batch.id, batch.queueSequence)
                    batches.put(batch)
                })

                const jobCursorRequest = jobs.openCursor()
                jobCursorRequest.onsuccess = () => {
                    const cursor = jobCursorRequest.result
                    if (cursor === null) {
                        if (oldVersion >= 4) return
                        const summaryCursorRequest = batches.openCursor()
                        summaryCursorRequest.onsuccess = () => {
                            const batchCursor = summaryCursorRequest.result
                            if (batchCursor === null) return
                            try {
                                const batch = parseBatch(batchCursor.value)
                                const summary = summaries.get(batch.id)
                                    ?? createEmptyGenerationBatchSummary(batch.id)
                                batchCursor.update({
                                    ...batch,
                                    projectionRevision: summary.total > 0 ? 1 : 0,
                                    projectionSummary: summary,
                                })
                                batchCursor.continue()
                            } catch {
                                transaction.abort()
                            }
                        }
                        summaryCursorRequest.onerror = () => transaction.abort()
                        return
                    }
                    try {
                        const value = cursor.value as unknown
                        if (!isRecord(value) || typeof value.batchId !== 'string') {
                            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'legacy queue job is invalid')
                        }
                        const queueSequence = batchSequenceById.get(value.batchId)
                        if (queueSequence === undefined) {
                            throw new QueueRepositoryError(
                                'E_QUEUE_BATCH_NOT_FOUND',
                                'Legacy queue job references a missing batch',
                            )
                        }
                        const migrated = migrateLegacyJob(value, queueSequence)
                        const current = summaries.get(migrated.job.batchId)
                            ?? createEmptyGenerationBatchSummary(migrated.job.batchId)
                        summaries.set(
                            migrated.job.batchId,
                            applyGenerationJobProjectionDelta(current, null, projectStoredJob(migrated.job)),
                        )
                        cursor.update(migrated.job)
                        if (migrated.lease !== null) leases.put(migrated.lease)
                        cursor.continue()
                    } catch {
                        transaction.abort()
                    }
                }
                jobCursorRequest.onerror = () => transaction.abort()
            } catch {
                transaction.abort()
            }
        }
        batchRequest.onerror = () => transaction.abort()
    }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    })
}

async function allocateQueueSequence(store: IDBObjectStore): Promise<number> {
    const cursor = await requestResult(store.index('by-queue-sequence').openCursor(null, 'prev'))
    if (cursor === null) return 1
    const next = parseBatch(cursor.value).queueSequence + 1
    if (!Number.isSafeInteger(next)) {
        throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Queue sequence space is exhausted')
    }
    return next
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
        const identity = batchFromInput(input, 1)
        const selected = await this.runTransaction(['batches'], 'readwrite', async transaction => {
            const store = transaction.objectStore('batches')
            const existingValue = await requestResult(store.get(identity.id))
            const existing = existingValue === undefined ? undefined : parseBatch(existingValue)
            if (existing !== undefined && !hasSameBatchIdentity(existing, identity)) {
                throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Batch identity already has different content')
            }
            if (existing === undefined) {
                const batch = batchFromInput(input, await allocateQueueSequence(store))
                await requestResult(store.add(batch))
                return batch
            }
            return existing
        })
        const readback = await this.runTransaction(['batches'], 'readonly', transaction => (
            requestResult(transaction.objectStore('batches').get(identity.id))
        ))
        if (readback === undefined
            || canonicalSerialize(parseBatch(readback)) !== canonicalSerialize(selected)) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Batch readback mismatch')
        }
        return structuredClone(selected)
    }

    async getBatch(id: string): Promise<GenerationBatch | null> {
        const value = await this.runTransaction(['batches'], 'readonly', transaction => (
            requestResult(transaction.objectStore('batches').get(id))
        ))
        return value === undefined ? null : structuredClone(parseBatch(value))
    }

    async listBatches(): Promise<GenerationBatch[]> {
        const values = await this.runTransaction(['batches'], 'readonly', transaction => (
            requestResult(transaction.objectStore('batches').index('by-created-at').getAll())
        )) as unknown[]
        return values.map(value => structuredClone(parseBatch(value))).reverse()
    }

    async setBatchControl(input: {
        batchId: string
        state: GenerationBatch['state']
        now: string
        reason?: QueuePauseReason | null
        failurePolicy?: QueueFailurePolicy
    }): Promise<GenerationBatch> {
        assertTimestamp(input.now, 'batch control time')
        if (input.state !== 'active' && input.state !== 'paused' && input.state !== 'stopped') {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'batch state is invalid')
        }
        if (input.failurePolicy !== undefined) assertFailurePolicy(input.failurePolicy)
        const version = await this.runTransaction(['batches'], 'readwrite', async transaction => {
            const store = transaction.objectStore('batches')
            const value = await requestResult(store.get(input.batchId))
            if (value === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(value)
            const next: GenerationBatch = {
                ...batch,
                state: input.state,
                updatedAt: input.now,
                pauseReason: input.state === 'active' ? null : input.reason ?? batch.pauseReason ?? 'user',
                failurePolicy: input.failurePolicy ?? batch.failurePolicy,
                version: batch.version + 1,
            }
            await requestResult(store.put(next))
            return next.version
        })
        const readback = await this.getBatch(input.batchId)
        if (readback === null || readback.version !== version || readback.state !== input.state) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Batch control readback mismatch')
        }
        return readback
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

    async ensureResource(resource: QueueResourceRecord): Promise<QueueResourceRecord> {
        assertIdentifier(resource.id, 'resource id')
        assertTimestamp(resource.createdAt, 'resource createdAt')
        assertTimestamp(resource.updatedAt, 'resource updatedAt')
        assertGenerationJobSnapshotSafe({ reference: resource.reference })
        await this.runTransaction(['resources'], 'readwrite', async transaction => {
            const store = transaction.objectStore('resources')
            const existing = await requestResult(store.get(resource.id))
            if (existing === undefined) {
                await requestResult(store.add(resource))
                return
            }
            const selected = selectResourceRecord(existing as QueueResourceRecord, resource)
            if (canonicalSerialize(selected) !== canonicalSerialize(existing)) await requestResult(store.put(selected))
        })
        const readback = await this.getResource(resource.id)
        if (readback === null) throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Resource readback missing')
        return readback
    }

    async getResource(id: string): Promise<QueueResourceRecord | null> {
        const value = await this.runTransaction(['resources'], 'readonly', transaction => (
            requestResult(transaction.objectStore('resources').get(id))
        )) as QueueResourceRecord | undefined
        return value === undefined ? null : structuredClone(value)
    }

    async createBatchAndEnqueue(input: CreateBatchAndEnqueueInput): Promise<CreateBatchAndEnqueueResult> {
        const batchIdentity = batchFromInput(input.batch, 1)
        const validatedCandidates = input.jobs.map(job => storedJobFromInput(job, 1))
        const resources = [...(input.resources ?? [])]
        if (validatedCandidates.length === 0) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'A durable batch must contain at least one job')
        }
        if (new Set(validatedCandidates.map(job => job.id)).size !== validatedCandidates.length
            || new Set(validatedCandidates.map(job => job.idempotencyKey)).size !== validatedCandidates.length) {
            throw new QueueRepositoryError('E_QUEUE_IDEMPOTENCY_CONFLICT', 'Enqueue batch contains duplicate identity')
        }
        if (new Set(resources.map(resource => resource.id)).size !== resources.length) {
            throw new QueueRepositoryError('E_QUEUE_IDEMPOTENCY_CONFLICT', 'Enqueue batch contains duplicate resources')
        }
        for (const candidate of validatedCandidates) {
            if (candidate.batchId !== batchIdentity.id || candidate.workflow !== batchIdentity.workflow) {
                throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Job does not match its atomic batch')
            }
        }
        for (const resource of resources) {
            assertIdentifier(resource.id, 'resource id')
            assertTimestamp(resource.createdAt, 'resource createdAt')
            assertTimestamp(resource.updatedAt, 'resource updatedAt')
            assertGenerationJobSnapshotSafe({ reference: resource.reference })
        }

        const selected = await this.runTransaction(
            ['batches', 'jobs', 'resources'],
            'readwrite',
            async transaction => {
                const batches = transaction.objectStore('batches')
                const jobs = transaction.objectStore('jobs')
                const resourceStore = transaction.objectStore('resources')
                const existingBatchValue = await requestResult(batches.get(batchIdentity.id))
                const existingByBatchKey = await requestResult(
                    batches.index('by-idempotency-key').get(batchIdentity.idempotencyKey),
                )
                if (existingByBatchKey !== undefined
                    && parseBatch(existingByBatchKey).id !== batchIdentity.id) {
                    throw new QueueRepositoryError(
                        'E_QUEUE_IDEMPOTENCY_CONFLICT',
                        'Batch idempotency key already represents different work',
                    )
                }
                if (existingBatchValue !== undefined
                    && !hasSameBatchIdentity(parseBatch(existingBatchValue), batchIdentity)) {
                    throw new QueueRepositoryError(
                        'E_QUEUE_IDEMPOTENCY_CONFLICT',
                        'Batch identity already represents different work',
                    )
                }
                const existingBatch = existingBatchValue === undefined
                    ? undefined
                    : parseBatch(existingBatchValue)
                const selectedBatch = existingBatch
                    ?? batchFromInput(input.batch, await allocateQueueSequence(batches))
                const candidates = input.jobs.map(job => storedJobFromInput(job, selectedBatch.queueSequence))

                const existingResources = new Map<string, QueueResourceRecord>()
                for (const resource of resources) {
                    const existing = await requestResult(resourceStore.get(resource.id)) as QueueResourceRecord | undefined
                    existingResources.set(
                        resource.id,
                        existing === undefined ? resource : selectResourceRecord(existing, resource),
                    )
                }
                const requiredIds = [...new Set(candidates.flatMap(candidate => (
                    candidate.snapshot.resources.map(resource => resource.resourceId)
                )))]
                for (const id of requiredIds) {
                    if (!existingResources.has(id)) {
                        const existing = await requestResult(resourceStore.get(id)) as QueueResourceRecord | undefined
                        if (existing !== undefined) existingResources.set(id, existing)
                    }
                }
                for (const candidate of candidates) {
                    for (const requirement of candidate.snapshot.resources) {
                        const materialized = existingResources.get(requirement.resourceId)
                        if (materialized === undefined
                            || materialized.digest !== requirement.digest
                            || materialized.persistence !== requirement.persistence
                            || canonicalSerialize(materialized.reference) !== canonicalSerialize(requirement.reference)) {
                            throw new QueueRepositoryError(
                                'E_QUEUE_RECORD_INVALID',
                                'Snapshot resource was not materialized with matching immutable content',
                            )
                        }
                    }
                }

                const idempotency = jobs.index('by-idempotency-key')
                const result: StoredJobRecord[] = []
                const additions: StoredJobRecord[] = []
                for (const candidate of candidates) {
                    const existingValue = await requestResult(idempotency.get(candidate.idempotencyKey))
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
                for (const resource of resources) {
                    const existing = await requestResult(resourceStore.get(resource.id)) as QueueResourceRecord | undefined
                    if (existing === undefined) {
                        await requestResult(resourceStore.add(resource))
                    } else {
                        const selectedResource = existingResources.get(resource.id) as QueueResourceRecord
                        if (canonicalSerialize(existing) !== canonicalSerialize(selectedResource)) {
                            await requestResult(resourceStore.put(selectedResource))
                        }
                    }
                }
                await Promise.all(additions.map(candidate => requestResult(jobs.add(candidate))))
                if (additions.length > 0) {
                    const projected = withBatchProjectionAdditions(selectedBatch, additions)
                    if (existingBatch === undefined) await requestResult(batches.add(projected))
                    else await requestResult(batches.put(projected))
                } else if (existingBatch === undefined) {
                    // A replay cannot normally create an empty batch because this
                    // method requires jobs, but preserving this branch keeps the
                    // immutable batch identity valid if all candidates dedupe.
                    await requestResult(batches.add(selectedBatch))
                }
                return result
            },
        )
        const [readbackBatch, readbackJobs] = await Promise.all([
            this.getBatch(batchIdentity.id),
            this.getJobsByIds(selected.map(job => job.id)),
        ])
        if (readbackBatch === null || readbackJobs.some(job => job === null)) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Atomic enqueue readback mismatch')
        }
        return { batch: readbackBatch, jobs: readbackJobs as GenerationJob[] }
    }

    enqueue(input: EnqueueGenerationJobInput): Promise<GenerationJob> {
        return this.enqueueMany([input]).then(jobs => jobs[0])
    }

    async enqueueMany(inputs: readonly EnqueueGenerationJobInput[]): Promise<GenerationJob[]> {
        if (inputs.length === 0) return []
        const validatedCandidates = inputs.map(input => storedJobFromInput(input, 1))
        if (new Set(validatedCandidates.map(job => job.id)).size !== validatedCandidates.length
            || new Set(validatedCandidates.map(job => job.idempotencyKey)).size !== validatedCandidates.length) {
            throw new QueueRepositoryError('E_QUEUE_IDEMPOTENCY_CONFLICT', 'Enqueue batch contains duplicate identity')
        }

        const selected = await this.runTransaction(['batches', 'jobs'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const idempotency = jobs.index('by-idempotency-key')
            const batchIds = [...new Set(validatedCandidates.map(job => job.batchId))]
            const batchValues = await Promise.all(batchIds.map(id => requestResult(batches.get(id))))
            const batchById = new Map(batchIds.map((id, index) => [
                id,
                batchValues[index] === undefined ? undefined : parseBatch(batchValues[index]),
            ]))
            const candidates = inputs.map((input, index) => {
                const batch = batchById.get(validatedCandidates[index].batchId)
                if (batch === undefined) {
                    throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
                }
                return storedJobFromInput(input, batch.queueSequence)
            })
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
            const additionsByBatch = new Map<string, StoredJobRecord[]>()
            for (const addition of additions) {
                const grouped = additionsByBatch.get(addition.batchId) ?? []
                grouped.push(addition)
                additionsByBatch.set(addition.batchId, grouped)
            }
            for (const [batchId, batchAdditions] of additionsByBatch) {
                const existing = batchById.get(batchId)
                if (existing === undefined) {
                    throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
                }
                const projected = withBatchProjectionAdditions(existing, batchAdditions)
                await requestResult(batches.put(projected))
            }
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
        const result = await this.runTransaction(['batches', 'jobs', 'leases'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const storedValue = await requestResult(jobs.get(input.jobId))
            if (storedValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(storedValue)
            const batchValue = await requestResult(batches.get(stored.batchId))
            if (batchValue === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(batchValue)
            const existing = parseLease(await requestResult(leases.get(input.jobId)))
            if (existing !== null
                || stored.state !== 'queued'
                || batch.state !== 'active'
                || stored.cancelRequestedAt !== null
                || Date.parse(stored.readyAt) > Date.parse(input.now)) return null
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
                requestResult(batches.put(withBatchProjectionDelta(batch, stored, next))),
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

    async claimNext(input: {
        owner: string
        now: string
        ttlMs: number
        workflow?: GenerationWorkflow
    }): Promise<GenerationJob | null> {
        let cursor: string | null = null
        do {
            const page = await this.listJobs({ states: ['queued'], cursor, limit: 250 })
            for (const job of page.items) {
                if (input.workflow !== undefined && job.workflow !== input.workflow) continue
                if (job.cancelRequestedAt !== null || Date.parse(job.readyAt) > Date.parse(input.now)) continue
                const claimed = await this.acquireLease({
                    jobId: job.id,
                    owner: input.owner,
                    now: input.now,
                    ttlMs: input.ttlMs,
                })
                if (claimed !== null) return claimed
            }
            cursor = page.nextCursor
        } while (cursor !== null)
        return null
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
        const result = await this.runTransaction(['batches', 'jobs', 'leases', 'attempts'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const attempts = transaction.objectStore('attempts')
            const storedValue = await requestResult(jobs.get(input.jobId))
            if (storedValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(storedValue)
            const lease = parseLease(await requestResult(leases.get(input.jobId)))
            if (stored.state === input.to) {
                if ((stored.state === 'leased' || stored.state === 'running')
                    && (lease === null
                        || input.leaseOwner === undefined
                        || input.leaseToken === undefined
                        || lease.owner !== input.leaseOwner
                        || lease.token !== input.leaseToken
                        || Date.parse(lease.expiresAt) < Date.parse(input.now))) {
                    throw new QueueRepositoryError('E_QUEUE_LEASE_LOST', 'Queue lease is no longer owned')
                }
                if (input.outputTransactionId !== undefined
                    && stored.outputTransactionId !== input.outputTransactionId) {
                    throw new QueueRepositoryError(
                        'E_QUEUE_IDEMPOTENCY_CONFLICT',
                        'Terminal output transaction does not match the committed job',
                    )
                }
                if (input.artifactReference !== undefined
                    && canonicalSerialize(stored.artifactReference) !== canonicalSerialize(input.artifactReference)) {
                    throw new QueueRepositoryError(
                        'E_QUEUE_IDEMPOTENCY_CONFLICT',
                        'Terminal artifact does not match the committed job',
                    )
                }
                return { stored, lease, idempotent: true }
            }
            if (isTerminalJobState(stored.state)) {
                throw new QueueRepositoryError('E_QUEUE_TERMINAL_IMMUTABLE', 'Terminal queue jobs are immutable')
            }
            const batchValue = await requestResult(batches.get(stored.batchId))
            if (batchValue === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(batchValue)
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
            if (input.to === 'succeeded' && stored.cancelRequestedAt !== null) {
                throw new QueueRepositoryError('E_QUEUE_CANCEL_REQUESTED', 'Queue job was cancelled before output commit')
            }
            if (input.to === 'succeeded'
                && (input.outputTransactionId === undefined
                    || input.outputTransactionId === null
                    || input.artifactReference === undefined
                    || input.artifactReference === null)) {
                throw new QueueRepositoryError(
                    'E_QUEUE_RECORD_INVALID',
                    'Succeeded queue jobs require OutputWriter transaction and artifact linkage',
                )
            }
            if (stored.state === 'leased' || stored.state === 'running') {
                if (lease === null
                    || input.leaseOwner === undefined
                    || input.leaseToken === undefined
                    || lease.owner !== input.leaseOwner
                    || lease.token !== input.leaseToken
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
                    failureKind: input.failureKind ?? null,
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
            await requestResult(batches.put(withBatchProjectionDelta(batch, stored, next)))
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
        leaseToken: string
        now: string
        progress: GenerationJobProgress
        expectedVersion?: number
        lastDiagnosticEventId?: string | null
    }): Promise<GenerationJob> {
        assertTimestamp(input.now, 'progress time')
        assertProgress(input.progress)
        const nextVersion = await this.runTransaction(['batches', 'jobs', 'leases'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const [jobValue, leaseValue] = await Promise.all([
                requestResult(jobs.get(input.jobId)),
                requestResult(leases.get(input.jobId)),
            ])
            if (jobValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(jobValue)
            const batchValue = await requestResult(batches.get(stored.batchId))
            if (batchValue === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(batchValue)
            const lease = parseLease(leaseValue)
            if (isTerminalJobState(stored.state)) {
                throw new QueueRepositoryError('E_QUEUE_TERMINAL_IMMUTABLE', 'Terminal queue jobs are immutable')
            }
            if (input.expectedVersion !== undefined && stored.version !== input.expectedVersion) {
                throw new QueueRepositoryError('E_QUEUE_INVALID_TRANSITION', 'Queue job version changed')
            }
            if (lease === null
                || lease.owner !== input.leaseOwner
                || lease.token !== input.leaseToken
                || Date.parse(lease.expiresAt) < Date.parse(input.now)
                || stored.state !== 'running') {
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
            await requestResult(batches.put(withBatchProjectionDelta(batch, stored, next)))
            return next.version
        })
        const readback = await this.getJob(input.jobId)
        if (readback === null || readback.version !== nextVersion) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Progress readback mismatch')
        }
        return readback
    }

    async bindOutputTransaction(input: {
        jobId: string
        leaseOwner: string
        leaseToken: string
        now: string
        outputTransactionId: string
        artifactReference: QueueArtifactReference
    }): Promise<GenerationJob> {
        assertTimestamp(input.now, 'output bind time')
        assertIdentifier(input.outputTransactionId, 'output transaction id')
        const version = await this.runTransaction(['batches', 'jobs', 'leases'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const [jobValue, leaseValue] = await Promise.all([
                requestResult(jobs.get(input.jobId)),
                requestResult(transaction.objectStore('leases').get(input.jobId)),
            ])
            if (jobValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(jobValue)
            const batchValue = await requestResult(batches.get(stored.batchId))
            if (batchValue === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(batchValue)
            const lease = parseLease(leaseValue)
            if (stored.cancelRequestedAt !== null) {
                throw new QueueRepositoryError('E_QUEUE_CANCEL_REQUESTED', 'Queue job was cancelled before output bind')
            }
            if (stored.state !== 'running'
                || lease === null
                || lease.owner !== input.leaseOwner
                || lease.token !== input.leaseToken
                || Date.parse(lease.expiresAt) < Date.parse(input.now)) {
                throw new QueueRepositoryError('E_QUEUE_LEASE_LOST', 'Queue lease is no longer owned')
            }
            if (stored.outputTransactionId !== null) {
                if (stored.outputTransactionId !== input.outputTransactionId) {
                    throw new QueueRepositoryError(
                        'E_QUEUE_IDEMPOTENCY_CONFLICT',
                        'Queue job is already bound to another output transaction',
                    )
                }
                if (canonicalSerialize(stored.artifactReference) !== canonicalSerialize(input.artifactReference)) {
                    throw new QueueRepositoryError(
                        'E_QUEUE_IDEMPOTENCY_CONFLICT',
                        'Queue job is already bound to another output artifact',
                    )
                }
                return stored.version
            }
            const next: StoredJobRecord = {
                ...stored,
                outputTransactionId: input.outputTransactionId,
                artifactReference: { ...input.artifactReference },
                updatedAt: input.now,
                version: stored.version + 1,
            }
            await requestResult(jobs.put(next))
            await requestResult(batches.put(withBatchProjectionDelta(batch, stored, next)))
            return next.version
        })
        const readback = await this.getJob(input.jobId)
        if (readback === null || readback.version !== version
            || readback.outputTransactionId !== input.outputTransactionId
            || canonicalSerialize(readback.artifactReference) !== canonicalSerialize(input.artifactReference)) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Output bind readback mismatch')
        }
        return readback
    }

    async recoverFilesCommittedSuccess(input: {
        jobId: string
        now: string
        outputTransactionId: string
        artifactReference: QueueArtifactReference
    }): Promise<GenerationJob> {
        assertTimestamp(input.now, 'output recovery time')
        const version = await this.runTransaction(['batches', 'jobs', 'leases', 'attempts'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const value = await requestResult(jobs.get(input.jobId))
            if (value === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(value)
            if (stored.state === 'succeeded') {
                if (stored.outputTransactionId !== input.outputTransactionId
                    || canonicalSerialize(stored.artifactReference) !== canonicalSerialize(input.artifactReference)) {
                    throw new QueueRepositoryError(
                        'E_QUEUE_IDEMPOTENCY_CONFLICT',
                        'Recovered output linkage differs from terminal queue state',
                    )
                }
                return stored.version
            }
            if (isTerminalJobState(stored.state)) {
                throw new QueueRepositoryError('E_QUEUE_TERMINAL_IMMUTABLE', 'Terminal queue jobs are immutable')
            }
            const batchValue = await requestResult(batches.get(stored.batchId))
            if (batchValue === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(batchValue)
            if (stored.cancelRequestedAt !== null) {
                throw new QueueRepositoryError('E_QUEUE_CANCEL_REQUESTED', 'Queue job was cancelled before recovery')
            }
            if (stored.outputTransactionId !== input.outputTransactionId
                || canonicalSerialize(stored.artifactReference) !== canonicalSerialize(input.artifactReference)) {
                throw new QueueRepositoryError(
                    'E_QUEUE_IDEMPOTENCY_CONFLICT',
                    'Files-committed journal is not pre-bound to this queue job',
                )
            }
            let next = updateJobState(stored, 'succeeded', input.now)
            next = {
                ...next,
                outputTransactionId: input.outputTransactionId,
                artifactReference: { ...input.artifactReference },
            }
            if (stored.attemptCount > 0) {
                const attemptId = `${stored.id}:${stored.attemptCount}`
                const attempt = await requestResult(transaction.objectStore('attempts').get(attemptId))
                if (isRecord(attempt) && attempt.outcome === 'running') {
                    await requestResult(transaction.objectStore('attempts').put({
                        ...attempt,
                        finishedAt: input.now,
                        outcome: 'succeeded',
                    }))
                }
            }
            await Promise.all([
                requestResult(jobs.put(next)),
                requestResult(transaction.objectStore('leases').delete(stored.id)),
                requestResult(batches.put(withBatchProjectionDelta(batch, stored, next))),
            ])
            return next.version
        })
        const readback = await this.getJob(input.jobId)
        if (readback === null || readback.version !== version || readback.state !== 'succeeded') {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Output recovery readback mismatch')
        }
        return readback
    }

    completeSucceeded(input: {
        jobId: string
        leaseOwner: string
        leaseToken: string
        now: string
        outputTransactionId: string
        artifactReference: QueueArtifactReference
        lastDiagnosticEventId?: string | null
    }): Promise<GenerationJob> {
        return this.transitionJob({ ...input, to: 'succeeded' })
    }

    async requestCancel(input: {
        jobId: string
        now: string
        reason?: 'user' | 'batch' | 'shutdown'
    }): Promise<GenerationJob> {
        assertTimestamp(input.now, 'cancel request time')
        const result = await this.runTransaction(['batches', 'jobs', 'leases'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const value = await requestResult(jobs.get(input.jobId))
            if (value === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(value)
            if (isTerminalJobState(stored.state)) return stored
            if (stored.cancelRequestedAt !== null) return stored
            const batchValue = await requestResult(batches.get(stored.batchId))
            if (batchValue === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(batchValue)
            const reason = input.reason ?? 'user'
            if (stored.state === 'running') {
                const next: StoredJobRecord = {
                    ...stored,
                    cancelRequestedAt: input.now,
                    cancelReason: reason,
                    updatedAt: input.now,
                    version: stored.version + 1,
                }
                await requestResult(jobs.put(next))
                await requestResult(batches.put(withBatchProjectionDelta(batch, stored, next)))
                return next
            }
            const next = {
                ...updateJobState(stored, 'cancelled', input.now),
                cancelRequestedAt: input.now,
                cancelReason: reason,
            }
            if (stored.state === 'leased') await requestResult(leases.delete(stored.id))
            await requestResult(jobs.put(next))
            await requestResult(batches.put(withBatchProjectionDelta(batch, stored, next)))
            return next
        })
        const readback = await this.getJob(input.jobId)
        if (readback === null || readback.version !== result.version) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Cancel request readback mismatch')
        }
        return readback
    }

    async requestCancelBatch(input: {
        batchId?: string
        now: string
        reason?: 'user' | 'batch' | 'shutdown'
    }): Promise<number> {
        let cursor: string | null = null
        let changed = 0
        do {
            const page = await this.listJobs({ batchId: input.batchId, cursor, limit: 250 })
            for (const job of page.items) {
                if (isTerminalJobState(job.state)) continue
                const cancelled = await this.requestCancel({
                    jobId: job.id,
                    now: input.now,
                    reason: input.reason ?? 'batch',
                })
                if (cancelled.cancelRequestedAt !== null) changed += 1
            }
            cursor = page.nextCursor
        } while (cursor !== null)
        return changed
    }

    async skipJob(input: { jobId: string; now: string; expectedVersion?: number }): Promise<GenerationJob> {
        const job = await this.getJob(input.jobId)
        if (job === null) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
        if (job.state === 'running' || job.state === 'leased') {
            return this.requestCancel({ jobId: job.id, now: input.now, reason: 'user' })
        }
        return this.transitionJob({
            jobId: input.jobId,
            to: 'skipped',
            now: input.now,
            expectedVersion: input.expectedVersion,
        })
    }

    async requeueAfterFailure(input: {
        jobId: string
        leaseOwner: string
        leaseToken: string
        now: string
        readyAt: string
        failureKind: QueueFailureKind
        lastDiagnosticEventId?: string | null
    }): Promise<GenerationJob> {
        assertTimestamp(input.now, 'retry transition time')
        assertTimestamp(input.readyAt, 'retry readyAt')
        const version = await this.runTransaction(['batches', 'jobs', 'leases', 'attempts'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const attempts = transaction.objectStore('attempts')
            const [jobValue, leaseValue] = await Promise.all([
                requestResult(jobs.get(input.jobId)),
                requestResult(leases.get(input.jobId)),
            ])
            if (jobValue === undefined) throw new QueueRepositoryError('E_QUEUE_NOT_FOUND', 'Queue job does not exist')
            const stored = parseStoredJob(jobValue)
            const batchValue = await requestResult(batches.get(stored.batchId))
            if (batchValue === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(batchValue)
            const lease = parseLease(leaseValue)
            if (stored.cancelRequestedAt !== null) {
                throw new QueueRepositoryError('E_QUEUE_CANCEL_REQUESTED', 'Queue job was cancelled before retry')
            }
            if (stored.state !== 'running'
                || lease === null
                || lease.owner !== input.leaseOwner
                || lease.token !== input.leaseToken
                || Date.parse(lease.expiresAt) < Date.parse(input.now)) {
                throw new QueueRepositoryError('E_QUEUE_LEASE_LOST', 'Queue lease is no longer owned')
            }
            const attemptId = `${stored.id}:${stored.attemptCount}`
            const attempt = await requestResult(attempts.get(attemptId))
            if (!isRecord(attempt)) {
                throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Active queue attempt is missing')
            }
            await requestResult(attempts.put({
                ...attempt,
                finishedAt: input.now,
                outcome: 'interrupted',
                diagnosticEventId: input.lastDiagnosticEventId ?? null,
                failureKind: input.failureKind,
            }))
            const terminal = stored.attemptCount >= stored.maxAttempts
            let next = updateJobState(stored, terminal ? 'failed' : 'recovering', input.now)
            if (!terminal) next = updateJobState(next, 'queued', input.now)
            next = {
                ...next,
                readyAt: input.readyAt,
                lastDiagnosticEventId: input.lastDiagnosticEventId ?? stored.lastDiagnosticEventId,
            }
            await Promise.all([
                requestResult(jobs.put(next)),
                requestResult(leases.delete(stored.id)),
                requestResult(batches.put(withBatchProjectionDelta(batch, stored, next))),
            ])
            return next.version
        })
        const readback = await this.getJob(input.jobId)
        if (readback === null || readback.version !== version) {
            throw new QueueRepositoryError('E_QUEUE_WRITE_VERIFY', 'Retry transition readback mismatch')
        }
        return readback
    }

    async retryFailedJobs(input: {
        sourceBatchId: string
        targetBatch: DurableGenerationBatchInput
    }): Promise<CreateBatchAndEnqueueResult> {
        const sourceJobs: GenerationJob[] = []
        let cursor: string | null = null
        do {
            const page = await this.listJobs({ batchId: input.sourceBatchId, states: ['failed'], cursor, limit: 250 })
            sourceJobs.push(...page.items)
            cursor = page.nextCursor
        } while (cursor !== null)
        if (sourceJobs.length === 0) {
            const existing = await this.getBatch(input.targetBatch.id)
            if (existing === null) {
                throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'There are no failed jobs to retry')
            }
            return { batch: existing, jobs: [] }
        }
        const jobs = sourceJobs.map((source, index): EnqueueGenerationJobInput => {
            const retryDigest = hashCanonicalValue({ targetBatchId: input.targetBatch.id, sourceJobId: source.id })
            return {
                id: `retry-job-${retryDigest}`,
                batchId: input.targetBatch.id,
                workflow: source.workflow,
                sceneId: source.sceneId,
                createdAt: input.targetBatch.createdAt,
                priority: source.priority,
                ordinal: index,
                snapshot: source.snapshot,
                compositionPlanHash: source.compositionPlanHash,
                maxAttempts: source.maxAttempts,
                idempotencyKey: `retry-enqueue-${retryDigest}`,
                retryOfJobId: source.id,
                rootJobId: source.rootJobId,
            }
        })
        return this.createBatchAndEnqueue({ batch: input.targetBatch, jobs })
    }

    async recoverExpiredLeases(
        now: string,
        options: { includeUnexpired?: boolean } = {},
    ): Promise<string[]> {
        assertTimestamp(now, 'recovery time')
        const recoveredIds = await this.runTransaction(['batches', 'jobs', 'leases', 'attempts'], 'readwrite', async transaction => {
            const batches = transaction.objectStore('batches')
            const jobs = transaction.objectStore('jobs')
            const leases = transaction.objectStore('leases')
            const attempts = transaction.objectStore('attempts')
            const expired = await requestResult(options.includeUnexpired === true
                ? leases.getAll()
                : leases.index('by-expires-at').getAll(this.keyRange.upperBound(now))) as LeaseRecord[]
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
                const batchValue = await requestResult(batches.get(stored.batchId))
                if (batchValue === undefined) {
                    throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
                }
                const batch = parseBatch(batchValue)
                await Promise.all([
                    requestResult(jobs.put(next)),
                    requestResult(leases.delete(stored.id)),
                    requestResult(batches.put(withBatchProjectionDelta(batch, stored, next))),
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

    async listJobProjections(input: ListGenerationJobsInput = {}): Promise<GenerationJobProjectionPage> {
        const page = await this.listJobs(input)
        return {
            items: page.items.map(job => ({
                id: job.id,
                batchId: job.batchId,
                workflow: job.workflow,
                sceneId: job.sceneId,
                outputDirectory: projectionOutputDirectory(job.snapshot),
                state: job.state,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
                priority: job.priority,
                ordinal: job.ordinal,
                attemptCount: job.attemptCount,
                maxAttempts: job.maxAttempts,
                progress: { ...job.progress },
                readyAt: job.readyAt,
                cancelRequestedAt: job.cancelRequestedAt,
                retryOfJobId: job.retryOfJobId,
                lastDiagnosticEventId: job.lastDiagnosticEventId,
                outputTransactionId: job.outputTransactionId,
                version: job.version,
            })),
            nextCursor: page.nextCursor,
        }
    }

    async getBatchProjectionMeta(batchId: string): Promise<GenerationBatchProjectionMeta> {
        assertIdentifier(batchId, 'batch id')
        const batch = await this.getBatch(batchId)
        if (batch === null) {
            throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
        }
        return {
            batchId,
            revision: batch.projectionRevision,
            summary: structuredClone(batch.projectionSummary),
        }
    }

    /**
     * Reads only the rows surrounding Queue Center's virtual range. The batch
     * aggregate and jobs share one readonly transaction, so a returned revision
     * always describes the same durable projection as its items and total.
     */
    async listJobProjectionWindow(
        input: ListGenerationJobProjectionWindowInput,
    ): Promise<GenerationJobProjectionWindow> {
        assertIdentifier(input.batchId, 'batch id')
        if (input.state !== undefined && !isGenerationJobState(input.state)) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Queue projection state is invalid')
        }
        if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Queue projection offset is invalid')
        }
        if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
            throw new QueueRepositoryError('E_QUEUE_RECORD_INVALID', 'Queue projection window limit is invalid')
        }

        return this.runTransaction(['batches', 'jobs'], 'readonly', async transaction => {
            const batchValue = await requestResult(transaction.objectStore('batches').get(input.batchId))
            if (batchValue === undefined) {
                throw new QueueRepositoryError('E_QUEUE_BATCH_NOT_FOUND', 'Queue batch does not exist')
            }
            const batch = parseBatch(batchValue)
            const state = input.state ?? null
            const total = state === null
                ? batch.projectionSummary.total
                : batch.projectionSummary.states[state]
            const jobs = transaction.objectStore('jobs')
            const index = state === null
                ? jobs.index('by-batch-order')
                : jobs.index('by-batch-state-order')
            const range = state === null
                ? this.keyRange.bound([input.batchId], [input.batchId, []])
                : this.keyRange.bound([input.batchId, state], [input.batchId, state, []])
            const items = await new Promise<GenerationJobProjection[]>((resolve, reject) => {
                const selected: GenerationJobProjection[] = []
                let advanced = false
                const request = index.openCursor(range)
                request.onerror = () => reject(request.error ?? new Error('Queue projection cursor failed'))
                request.onsuccess = () => {
                    const cursor = request.result
                    if (cursor === null || selected.length >= input.limit) {
                        resolve(selected)
                        return
                    }
                    if (!advanced && input.offset > 0) {
                        advanced = true
                        cursor.advance(input.offset)
                        return
                    }
                    advanced = true
                    selected.push(projectStoredJob(parseStoredJob(cursor.value)))
                    cursor.continue()
                }
            })
            return {
                batchId: input.batchId,
                revision: batch.projectionRevision,
                summary: structuredClone(batch.projectionSummary),
                state,
                offset: input.offset,
                total,
                items,
            }
        })
    }

    async getBatchSummary(batchId: string): Promise<GenerationBatchSummary> {
        return (await this.getBatchProjectionMeta(batchId)).summary
    }

    async getActivitySummary(): Promise<QueueActivitySummary> {
        return this.runTransaction(['jobs'], 'readonly', async transaction => {
            const stateOrder = transaction.objectStore('jobs').index('by-state-order')
            const countState = (state: GenerationJobState) => (
                requestResult(stateOrder.count(this.keyRange.bound([state], [state, []])))
            )
            // The app shell and Queue Center have different read budgets: this shared
            // indicator counts indexed states only, while Queue Center owns detailed
            // job projections, progress, and retry controls.
            const [queued, leased, running, recovering, failed, blocked] = await Promise.all([
                countState('queued'),
                countState('leased'),
                countState('running'),
                countState('recovering'),
                countState('failed'),
                countState('blocked'),
            ])
            return {
                processing: leased + running + recovering,
                waiting: queued,
                needsAttention: failed + blocked,
            }
        })
    }
}

/**
 * Queue Center never needs snapshots or leases. This shared projection keeps
 * pagination and the new viewport query aligned while avoiding those payloads.
 */
function projectStoredJob(stored: StoredJobRecord): GenerationJobProjection {
    return {
        id: stored.id,
        batchId: stored.batchId,
        workflow: stored.workflow,
        sceneId: stored.sceneId,
        outputDirectory: projectionOutputDirectory(stored.snapshot),
        state: stored.state,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        priority: stored.priority,
        ordinal: stored.ordinal,
        attemptCount: stored.attemptCount,
        maxAttempts: stored.maxAttempts,
        progress: { ...stored.progress },
        readyAt: stored.readyAt,
        cancelRequestedAt: stored.cancelRequestedAt,
        retryOfJobId: stored.retryOfJobId,
        lastDiagnosticEventId: stored.lastDiagnosticEventId,
        outputTransactionId: stored.outputTransactionId,
        version: stored.version,
    }
}

function withBatchProjectionDelta(
    batch: GenerationBatch,
    previous: StoredJobRecord | null,
    next: StoredJobRecord | null,
): GenerationBatch {
    return {
        ...batch,
        projectionRevision: batch.projectionRevision + 1,
        projectionSummary: applyGenerationJobProjectionDelta(
            batch.projectionSummary,
            previous === null ? null : projectStoredJob(previous),
            next === null ? null : projectStoredJob(next),
        ),
    }
}

function withBatchProjectionAdditions(
    batch: GenerationBatch,
    additions: readonly StoredJobRecord[],
): GenerationBatch {
    if (additions.length === 0) return batch
    const projectionSummary = additions.reduce(
        (summary, candidate) => applyGenerationJobProjectionDelta(
            summary,
            null,
            projectStoredJob(candidate),
        ),
        batch.projectionSummary,
    )
    return {
        ...batch,
        // A bulk enqueue is one atomic projection change. Consumers only need
        // to know that their viewport is stale, not how many rows were added.
        projectionRevision: batch.projectionRevision + 1,
        projectionSummary,
    }
}

let runtimeQueueRepository: IndexedDBQueueRepository | null = null

export function getRuntimeQueueRepository(): IndexedDBQueueRepository {
    runtimeQueueRepository ??= new IndexedDBQueueRepository()
    return runtimeQueueRepository
}

export function resetRuntimeQueueRepositoryForTests(): void {
    runtimeQueueRepository?.close()
    runtimeQueueRepository = null
}
