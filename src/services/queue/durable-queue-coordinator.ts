import { evaluateQueueRetry } from '@/domain/queue/retry-policy'
import { isTerminalJobState } from '@/domain/queue/state-machine'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import type {
    GenerationJob,
    GenerationWorkflow,
    QueueArtifactReference,
    QueueBlockReason,
    QueueFailureKind,
} from '@/domain/queue/types'
import type { IndexedDBQueueRepository } from './indexeddb-queue-repository'

export interface QueueTokenSlot {
    slotId: string
    /** Execution-only secret. It is never copied into a job, attempt, diagnostic, or log. */
    token: string
}

export interface QueueExecutorContext {
    readonly tokenSlotId: string
    readonly token: string
    readonly signal: AbortSignal
    canCommit(): boolean
    updateProgress(stage: string, current: number, total: number): Promise<void>
    bindOutput(transactionId: string, artifactReference: QueueArtifactReference): Promise<void>
    commitOutput(transactionId: string, artifactReference: QueueArtifactReference): Promise<void>
}

export interface DurableQueueJobExecutor {
    execute(job: GenerationJob, context: QueueExecutorContext): Promise<void>
}

export class QueueExecutionError extends Error {
    constructor(
        readonly kind: QueueFailureKind,
        message: string,
        readonly options: { retryAfterMs?: number; diagnosticEventId?: string } = {},
    ) {
        super(message)
        this.name = 'QueueExecutionError'
    }
}

export interface DurableQueueCoordinatorOptions {
    repository: IndexedDBQueueRepository
    tokenProvider: () => readonly QueueTokenSlot[]
    executor: DurableQueueJobExecutor
    now?: () => string
    leaseTtlMs?: number
    startup?: () => Promise<unknown>
}

interface ActiveExecution {
    job: GenerationJob
    slotId: string
    singleWorker: boolean
    controller: AbortController
    abortMode: 'none' | 'cancel' | 'shutdown'
    promise: Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failureText(value: unknown, depth = 0, seen = new Set<object>()): string {
    if (depth > 4 || value === null || typeof value !== 'object' || seen.has(value)) return ''
    seen.add(value)
    const record = value as Record<string, unknown>
    const own = [record.name, record.message, record.code]
        .filter(part => typeof part === 'string')
        .join(' ')
    const nested = ['cause', 'transactionError', 'cleanupError']
        .map(key => failureText(record[key], depth + 1, seen))
        .filter(Boolean)
        .join(' ')
    return `${own} ${nested}`.trim()
}

function requiresSingleWorker(job: GenerationJob): boolean {
    const parameters = job.snapshot.parameters
    if (!isRecord(parameters) || !isRecord(parameters.queueExecution)) return false
    return parameters.queueExecution.streaming === true && parameters.queueExecution.sourceEdit !== true
}

function isMainSequenceDependent(job: GenerationJob): boolean {
    if (job.workflow !== 'main') return false
    const parameters = job.snapshot.parameters
    if (!isRecord(parameters) || !isRecord(parameters.mainWorkflow)) return false
    const proposal = parameters.mainWorkflow.sequenceCommitProposal
    // Main snapshot parameters own the durable proposal; a non-empty change list links
    // this job to lower-ordinal proposals whose CAS commits must complete first.
    return isRecord(proposal) && Array.isArray(proposal.changes) && proposal.changes.length > 0
}

type SequenceDependencyDisposition = 'ready' | 'wait' | 'skip'

function sequenceDependencyDisposition(
    candidate: GenerationJob,
    batchJobs: readonly GenerationJob[],
): SequenceDependencyDisposition {
    let waitsForPredecessor = false
    for (const predecessor of batchJobs) {
        if (predecessor.ordinal >= candidate.ordinal || !isMainSequenceDependent(predecessor)) continue
        if (predecessor.state === 'failed'
            || predecessor.state === 'cancelled'
            || predecessor.state === 'skipped') return 'skip'
        if (predecessor.state !== 'succeeded') waitsForPredecessor = true
    }
    return waitsForPredecessor ? 'wait' : 'ready'
}

function executionLimit(workflow: GenerationWorkflow, singleWorker: boolean): number {
    if (workflow !== 'scene' || singleWorker) return 1
    return 2
}

function classifyFailure(error: unknown): QueueExecutionError {
    if (error instanceof QueueExecutionError) return error
    if (isRecord(error) && error.status === 401) {
        return new QueueExecutionError('authentication', 'Provider authentication failed')
    }
    if (isRecord(error) && error.status === 429) {
        return new QueueExecutionError('rate-limited', 'Provider rate limit reached')
    }
    const message = failureText(error)
    if (/(?:enospc|disk\s*full|no\s*space\s*left)/i.test(message)) {
        return new QueueExecutionError('local-io', 'Output storage is unavailable')
    }
    if (/(?:decode|invalid image|invalid zip|archive)/i.test(message)) {
        return new QueueExecutionError('decode', 'Provider image response could not be decoded')
    }
    if (isRecord(error) && error.name === 'TimeoutError') {
        return new QueueExecutionError('timeout', 'Provider request reached its bounded timeout')
    }
    return new QueueExecutionError('fatal', 'Generation executor failed')
}

function classifyBlockReason(error: unknown): QueueBlockReason | null {
    if (!isRecord(error)) return null
    if (error.code === 'E_QUEUE_RESOURCE_MISSING') return 'missing-resource'
    if (error.code === 'E_QUEUE_RESOURCE_DIGEST_MISMATCH') return 'digest-mismatch'
    return null
}

export class DurableQueueCoordinator {
    private readonly repository: IndexedDBQueueRepository
    private readonly tokenProvider: () => readonly QueueTokenSlot[]
    private readonly executor: DurableQueueJobExecutor
    private readonly now: () => string
    private readonly leaseTtlMs: number
    private readonly startup: () => Promise<unknown>
    private readonly ownerPrefix: string
    private readonly active = new Map<string, ActiveExecution>()
    private drainPromise: Promise<void> | null = null
    private polling = false
    private pollTimer: ReturnType<typeof setTimeout> | null = null

    constructor(options: DurableQueueCoordinatorOptions) {
        this.repository = options.repository
        this.tokenProvider = options.tokenProvider
        this.executor = options.executor
        this.now = options.now ?? (() => new Date().toISOString())
        this.leaseTtlMs = options.leaseTtlMs ?? 60_000
        this.startup = options.startup ?? (() => this.repository.initialize())
        this.ownerPrefix = `queue-worker:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
    }

    get activeCount(): number {
        return this.active.size
    }

    async cancelJob(jobId: string): Promise<void> {
        const execution = this.active.get(jobId)
        if (execution !== undefined) {
            execution.abortMode = 'cancel'
            execution.controller.abort('durable-queue-cancelled')
        }
        await this.repository.requestCancel({ jobId, now: this.now(), reason: 'user' })
    }

    async cancelBatch(batchId: string): Promise<void> {
        for (const execution of this.active.values()) {
            if (execution.job.batchId === batchId) {
                execution.abortMode = 'cancel'
                execution.controller.abort('durable-queue-batch-cancelled')
            }
        }
        await this.repository.requestCancelBatch({ batchId, now: this.now(), reason: 'batch' })
    }

    async cancelWorkflow(workflow: GenerationWorkflow): Promise<void> {
        for (const execution of this.active.values()) {
            if (execution.job.workflow === workflow) {
                execution.abortMode = 'cancel'
                execution.controller.abort('durable-queue-workflow-cancelled')
            }
        }
        let cursor: string | null = null
        do {
            const page = await this.repository.listJobs({ cursor, limit: 250 })
            for (const job of page.items) {
                if (job.workflow !== workflow || isTerminalJobState(job.state)) continue
                await this.repository.requestCancel({ jobId: job.id, now: this.now(), reason: 'user' })
            }
            cursor = page.nextCursor
        } while (cursor !== null)
    }

    async pauseBatch(batchId: string): Promise<void> {
        await this.repository.setBatchControl({ batchId, state: 'paused', now: this.now(), reason: 'user' })
    }

    async resumeBatch(batchId: string): Promise<void> {
        await this.repository.setBatchControl({ batchId, state: 'active', now: this.now() })
        if (this.polling) void this.drain()
    }

    async drain(): Promise<void> {
        this.drainPromise ??= this.drainInternal().finally(() => {
            this.drainPromise = null
        })
        return this.drainPromise
    }

    start(pollIntervalMs = 750): void {
        if (this.polling) return
        this.polling = true
        const poll = async (): Promise<void> => {
            if (!this.polling) return
            await this.drain().catch(() => undefined)
            if (!this.polling) return
            this.pollTimer = setTimeout(() => void poll(), pollIntervalMs)
        }
        void poll()
    }

    stop(): void {
        this.polling = false
        if (this.pollTimer !== null) clearTimeout(this.pollTimer)
        this.pollTimer = null
        for (const execution of this.active.values()) {
            execution.abortMode = 'shutdown'
            execution.controller.abort('durable-queue-stopped')
        }
    }

    private async drainInternal(): Promise<void> {
        await this.startup()
        let cycles = 0
        while (cycles < 100_000) {
            cycles += 1
            await this.scheduleAvailable()
            if (this.active.size === 0) return
            await Promise.race([...this.active.values()].map(execution => execution.promise))
        }
        throw new Error('Durable queue drain exceeded its bounded scheduling cycle count')
    }

    private async scheduleAvailable(): Promise<void> {
        const slots = this.tokenProvider()
            .filter(slot => slot.token.trim().length > 0)
            .filter(slot => ![...this.active.values()].some(active => active.slotId === slot.slotId))

        let cursor: string | null = null
        let slotIndex = 0
        const batchJobsById = new Map<string, GenerationJob[]>()
        do {
            const page = await this.repository.listJobs({ states: ['queued'], cursor, limit: 250 })
            for (const candidate of page.items) {
                if (candidate.cancelRequestedAt !== null) continue
                if (isMainSequenceDependent(candidate)) {
                    let batchJobs = batchJobsById.get(candidate.batchId)
                    if (batchJobs === undefined) {
                        batchJobs = await this.listBatchJobs(candidate.batchId)
                        batchJobsById.set(candidate.batchId, batchJobs)
                    }
                    const disposition = sequenceDependencyDisposition(candidate, batchJobs)
                    if (disposition === 'wait') continue
                    if (disposition === 'skip') {
                        // IndexedDB's queued->skipped transition terminalizes the dependent tail
                        // without leasing a provider token; later jobs observe the same failed ancestor.
                        await this.repository.transitionJob({
                            jobId: candidate.id,
                            to: 'skipped',
                            now: this.now(),
                            expectedVersion: candidate.version,
                        })
                        continue
                    }
                }
                if (Date.parse(candidate.readyAt) > Date.parse(this.now())) continue
                if (slotIndex >= slots.length) continue
                const activeExecutions = [...this.active.values()]
                const activeWorkflow = activeExecutions[0]?.job.workflow
                const activeSingle = activeExecutions.some(execution => execution.singleWorker)
                if (activeWorkflow !== undefined && candidate.workflow !== activeWorkflow) continue
                const singleWorker = requiresSingleWorker(candidate)
                const current = this.active.size
                if (activeSingle || (singleWorker && current > 0)) continue
                if (current >= executionLimit(candidate.workflow, singleWorker)) return

                const slot = slots[slotIndex]
                const owner = `${this.ownerPrefix}:${slot.slotId}`
                const leased = await this.repository.acquireLease({
                    jobId: candidate.id,
                    owner,
                    now: this.now(),
                    ttlMs: this.leaseTtlMs,
                })
                if (leased === null) continue
                slotIndex += 1
                this.launch(leased, slot, owner, singleWorker)
                if (singleWorker || leased.workflow !== 'scene') return
            }
            cursor = page.nextCursor
        } while (cursor !== null)
    }

    private async listBatchJobs(batchId: string): Promise<GenerationJob[]> {
        const jobs: GenerationJob[] = []
        let cursor: string | null = null
        do {
            // The repository batch index is the durable authority across retries and restarts;
            // paging it prevents a readyAt-filtered queue scan from hiding a predecessor.
            const page = await this.repository.listJobs({ batchId, cursor, limit: 250 })
            jobs.push(...page.items)
            cursor = page.nextCursor
        } while (cursor !== null)
        return jobs
    }

    private launch(job: GenerationJob, slot: QueueTokenSlot, owner: string, singleWorker: boolean): void {
        const controller = new AbortController()
        const active: ActiveExecution = {
            job,
            slotId: slot.slotId,
            singleWorker,
            controller,
            abortMode: 'none',
            promise: Promise.resolve(),
        }
        this.active.set(job.id, active)
        active.promise = this.executeClaimed(job, slot, owner, controller)
            .catch(() => undefined)
            .finally(() => {
                this.active.delete(job.id)
            })
    }

    private async executeClaimed(
        leased: GenerationJob,
        slot: QueueTokenSlot,
        owner: string,
        controller: AbortController,
    ): Promise<void> {
        const token = leased.leaseToken
        if (token === null) return
        let terminalCommitted = false
        const running = await this.repository.transitionJob({
            jobId: leased.id,
            to: 'running',
            now: this.now(),
            leaseOwner: owner,
            leaseToken: token,
        })
        const heartbeatMs = Math.max(1_000, Math.min(30_000, Math.floor(this.leaseTtlMs / 3)))
        const heartbeat = setInterval(() => {
            void this.repository.heartbeatLease({
                jobId: leased.id,
                owner,
                token,
                now: this.now(),
                ttlMs: this.leaseTtlMs,
            }).catch(() => controller.abort('durable-queue-lease-lost'))
        }, heartbeatMs)

        const context: QueueExecutorContext = {
            tokenSlotId: slot.slotId,
            token: slot.token,
            signal: controller.signal,
            canCommit: () => !controller.signal.aborted && !terminalCommitted,
            updateProgress: async (stage, current, total) => {
                await this.repository.updateProgress({
                    jobId: leased.id,
                    leaseOwner: owner,
                    leaseToken: token,
                    now: this.now(),
                    progress: { stage, current, total },
                })
            },
            bindOutput: async (transactionId, artifactReference) => {
                await this.repository.bindOutputTransaction({
                    jobId: leased.id,
                    leaseOwner: owner,
                    leaseToken: token,
                    now: this.now(),
                    outputTransactionId: transactionId,
                    artifactReference,
                })
            },
            commitOutput: async (transactionId, artifactReference) => {
                await this.repository.completeSucceeded({
                    jobId: leased.id,
                    leaseOwner: owner,
                    leaseToken: token,
                    now: this.now(),
                    outputTransactionId: transactionId,
                    artifactReference,
                })
                terminalCommitted = true
            },
        }

        try {
            await this.executor.execute(running, context)
            const current = await this.repository.getJob(leased.id)
            if (current?.state === 'succeeded') return
            if (controller.signal.aborted || current?.cancelRequestedAt !== null) {
                if (current?.state === 'running') {
                    await this.finishAbortedExecution(current, owner, token)
                }
                return
            }
            throw new QueueExecutionError('fatal', 'Executor returned without an OutputWriter commit')
        } catch (error) {
            const current = await this.repository.getJob(leased.id)
            if (current === null || isTerminalJobState(current.state)) return
            if (controller.signal.aborted || current.cancelRequestedAt !== null) {
                if (current.state === 'running') {
                    await this.finishAbortedExecution(current, owner, token)
                }
                return
            }
            const diagnostic = reportDiagnostic(error, {
                operation: `queue.execute.${current.workflow}`,
                stage: 'executor',
            })
            const blockReason = classifyBlockReason(error)
            if (blockReason !== null) {
                await this.repository.transitionJob({
                    jobId: current.id,
                    to: 'blocked',
                    now: this.now(),
                    leaseOwner: owner,
                    leaseToken: token,
                    blockReason,
                    lastDiagnosticEventId: diagnostic.eventId,
                })
                return
            }
            const classified = classifyFailure(error)
            await this.handleFailure(current, owner, token, classified.options.diagnosticEventId === undefined
                ? new QueueExecutionError(classified.kind, classified.message, {
                    ...classified.options,
                    diagnosticEventId: diagnostic.eventId,
                })
                : classified)
        } finally {
            clearInterval(heartbeat)
        }
    }

    private async finishAbortedExecution(job: GenerationJob, owner: string, token: string): Promise<void> {
        const mode = this.active.get(job.id)?.abortMode ?? 'cancel'
        if (mode === 'shutdown' && job.cancelRequestedAt === null) {
            const now = this.now()
            await this.repository.requeueAfterFailure({
                jobId: job.id,
                leaseOwner: owner,
                leaseToken: token,
                now,
                readyAt: now,
                failureKind: 'transient',
            })
            return
        }
        await this.repository.transitionJob({
            jobId: job.id,
            to: 'cancelled',
            now: this.now(),
            leaseOwner: owner,
            leaseToken: token,
        })
    }

    private async handleFailure(
        job: GenerationJob,
        owner: string,
        token: string,
        failure: QueueExecutionError,
    ): Promise<void> {
        const now = this.now()
        const diagnostic = failure.options.diagnosticEventId
        if (failure.kind === 'authentication' || failure.kind === 'local-io') {
            await this.repository.requeueAfterFailure({
                jobId: job.id,
                leaseOwner: owner,
                leaseToken: token,
                now,
                readyAt: now,
                failureKind: failure.kind,
                lastDiagnosticEventId: diagnostic,
            })
            await this.repository.setBatchControl({
                batchId: job.batchId,
                state: 'paused',
                now,
                reason: failure.kind === 'authentication' ? 'authentication' : 'local-io',
            })
            return
        }

        if (failure.kind === 'rate-limited' || failure.kind === 'timeout' || failure.kind === 'transient') {
            const policy = evaluateQueueRetry({
                attemptCount: job.attemptCount,
                maxAttempts: job.maxAttempts,
                failureKind: failure.kind,
                now,
            })
            if (policy.decision === 'retry') {
                const readyAt = failure.options.retryAfterMs === undefined
                    ? policy.nextAttemptAt
                    : new Date(Date.parse(now) + Math.max(0, failure.options.retryAfterMs)).toISOString()
                await this.repository.requeueAfterFailure({
                    jobId: job.id,
                    leaseOwner: owner,
                    leaseToken: token,
                    now,
                    readyAt,
                    failureKind: failure.kind,
                    lastDiagnosticEventId: diagnostic,
                })
                return
            }
        }

        await this.repository.transitionJob({
            jobId: job.id,
            to: 'failed',
            now,
            leaseOwner: owner,
            leaseToken: token,
            lastDiagnosticEventId: diagnostic,
            failureKind: failure.kind,
        })
        const batch = await this.repository.getBatch(job.batchId)
        if (batch?.failurePolicy === 'stop-on-first-error') {
            await this.repository.setBatchControl({
                batchId: job.batchId,
                state: 'stopped',
                now,
                reason: 'first-error',
            })
        } else if (batch?.failurePolicy === 'pause-on-fatal' && failure.kind === 'fatal') {
            await this.repository.setBatchControl({
                batchId: job.batchId,
                state: 'paused',
                now,
                reason: 'fatal',
            })
        }
    }
}
