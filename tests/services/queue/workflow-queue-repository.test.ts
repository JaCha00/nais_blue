import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { GenerationJobSnapshot } from '@/domain/queue/types'
import {
    IndexedDBQueueRepository,
    type EnqueueGenerationJobInput,
} from '@/services/queue/indexeddb-queue-repository'
import { createGenerationJobSnapshot } from '@/services/queue/job-snapshot'
import { recoverQueueAfterRestart } from '@/services/queue/recovery'

const NOW = '2026-07-14T06:00:00.000Z'
const SECOND = '2026-07-14T06:00:01.000Z'
const LATER = '2026-07-14T06:00:10.000Z'
let databaseCounter = 0

function snapshot(): GenerationJobSnapshot {
    return createGenerationJobSnapshot({
        prompt: { positive: 'immutable queue prompt', negative: 'fixed negative' },
        parameters: { seed: 9, steps: 12, streaming: false },
        outputPolicy: { format: 'png', destination: { kind: 'app-data' } },
        resources: [],
        resumability: 'resumable',
    })
}

function job(overrides: Partial<EnqueueGenerationJobInput> = {}): EnqueueGenerationJobInput {
    return {
        id: 'job:1',
        batchId: 'batch:1',
        workflow: 'scene',
        sceneId: 'scene:1',
        createdAt: NOW,
        priority: 0,
        ordinal: 0,
        snapshot: snapshot(),
        compositionPlanHash: 'sha256:plan',
        maxAttempts: 3,
        idempotencyKey: 'idempotency:1',
        ...overrides,
    }
}

function queueDatabaseName(label: string): string {
    databaseCounter += 1
    return `workflow-queue-${label}-${databaseCounter}`
}

function repositoryWithName(factory: IDBFactory, databaseName: string): IndexedDBQueueRepository {
    return new IndexedDBQueueRepository({
        factory: factory as unknown as globalThis.IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName,
    })
}

function repository(factory: IDBFactory, label: string): IndexedDBQueueRepository {
    return repositoryWithName(factory, queueDatabaseName(label))
}

async function enqueueOne(queue: IndexedDBQueueRepository): Promise<void> {
    await queue.createBatchAndEnqueue({
        batch: {
            id: 'batch:1',
            workflow: 'scene',
            createdAt: NOW,
            failurePolicy: 'continue',
            origin: 'fresh',
            idempotencyKey: 'batch-key:1',
        },
        jobs: [job()],
    })
}

describe('workflow durable queue repository', () => {
    it('registers a batch and all jobs atomically and leaves no batch on validation failure', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, 'atomic')

        await expect(queue.createBatchAndEnqueue({
            batch: {
                id: 'batch:1',
                workflow: 'scene',
                createdAt: NOW,
                failurePolicy: 'continue',
                origin: 'fresh',
                idempotencyKey: 'batch-key:1',
            },
            jobs: [job(), job({ id: 'job:2' })],
        })).rejects.toMatchObject({ code: 'E_QUEUE_IDEMPOTENCY_CONFLICT' })

        expect(await queue.getBatch('batch:1')).toBeNull()
        expect((await queue.listJobs({ batchId: 'batch:1' })).items).toEqual([])

        const created = await queue.createBatchAndEnqueue({
            batch: {
                id: 'batch:1',
                workflow: 'scene',
                createdAt: NOW,
                failurePolicy: 'continue',
                origin: 'fresh',
                idempotencyKey: 'batch-key:1',
            },
            jobs: [job(), job({
                id: 'job:2',
                ordinal: 1,
                idempotencyKey: 'idempotency:2',
            })],
        })
        expect(created.jobs).toHaveLength(2)
        expect(created.batch.state).toBe('active')
    })

    it('reuses content-addressed resources across enqueue operations and records a verified repair', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, 'resource-reuse')
        const requirement = {
            resourceId: 'resource:shared',
            role: 'source' as const,
            persistence: 'managed-app-data' as const,
            digest: 'sha256:shared',
            reference: { relativePath: 'queue-resources/sha256-shared.bin' },
        }
        const sharedSnapshot = createGenerationJobSnapshot({
            prompt: { positive: 'resource-backed prompt', negative: '' },
            parameters: { seed: 10 },
            outputPolicy: { format: 'png' },
            resources: [requirement],
            resumability: 'resumable',
        })
        const resource = {
            id: requirement.resourceId,
            persistence: requirement.persistence,
            digest: requirement.digest,
            reference: requirement.reference,
            availability: 'missing' as const,
            createdAt: NOW,
            updatedAt: NOW,
        }
        await queue.createBatchAndEnqueue({
            batch: {
                id: 'batch:resource:1', workflow: 'main', createdAt: NOW,
                failurePolicy: 'continue', origin: 'fresh', idempotencyKey: 'batch-resource:1',
            },
            jobs: [job({
                id: 'job:resource:1', batchId: 'batch:resource:1', workflow: 'main', sceneId: null,
                snapshot: sharedSnapshot, idempotencyKey: 'job-resource:1',
            })],
            resources: [resource],
        })

        const second = await queue.createBatchAndEnqueue({
            batch: {
                id: 'batch:resource:2', workflow: 'main', createdAt: LATER,
                failurePolicy: 'continue', origin: 'fresh', idempotencyKey: 'batch-resource:2',
            },
            jobs: [job({
                id: 'job:resource:2', batchId: 'batch:resource:2', workflow: 'main', sceneId: null,
                createdAt: LATER, snapshot: sharedSnapshot, idempotencyKey: 'job-resource:2',
            })],
            resources: [{
                ...resource,
                availability: 'available',
                createdAt: LATER,
                updatedAt: LATER,
            }],
        })

        expect(second.jobs).toHaveLength(1)
        expect(await queue.getResource(requirement.resourceId)).toMatchObject({
            availability: 'available',
            createdAt: NOW,
            updatedAt: LATER,
        })
    })

    it('persists pause across repository restart and claim-next resumes without mutating jobs', async () => {
        const factory = new IDBFactory()
        const name = queueDatabaseName('pause')
        const beforeRestart = repositoryWithName(factory, name)
        await enqueueOne(beforeRestart)
        await beforeRestart.setBatchControl({
            batchId: 'batch:1',
            state: 'paused',
            now: SECOND,
            reason: 'user',
        })
        const replayed = await beforeRestart.createBatchAndEnqueue({
            batch: {
                id: 'batch:1',
                workflow: 'scene',
                createdAt: LATER,
                failurePolicy: 'continue',
                origin: 'fresh',
                idempotencyKey: 'batch-key:1',
            },
            jobs: [job()],
        })
        expect(replayed.batch).toMatchObject({ state: 'paused', version: 2 })
        beforeRestart.close()

        const afterRestart = repositoryWithName(factory, name)
        expect((await afterRestart.getBatch('batch:1'))?.state).toBe('paused')
        expect(await afterRestart.claimNext({ owner: 'worker:1', now: SECOND, ttlMs: 5_000 })).toBeNull()

        await afterRestart.setBatchControl({ batchId: 'batch:1', state: 'active', now: LATER })
        expect(await afterRestart.claimNext({ owner: 'worker:1', now: LATER, ttlMs: 5_000 }))
            .toMatchObject({ id: 'job:1', state: 'leased' })
    })

    it('recovers a prior-process lease immediately even before its wall-clock expiry', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, 'process-restart')
        await enqueueOne(queue)
        const leased = await queue.claimNext({ owner: 'old-process:worker', now: NOW, ttlMs: 60_000 })
        await queue.transitionJob({
            jobId: 'job:1',
            to: 'running',
            now: NOW,
            leaseOwner: 'old-process:worker',
            leaseToken: leased?.leaseToken ?? '',
        })

        expect(await queue.recoverExpiredLeases(SECOND)).toEqual([])
        const recovered = await recoverQueueAfterRestart(queue, {
            now: SECOND,
            includeUnexpiredLeases: true,
        })

        expect(recovered).toEqual({ recovering: 1, queued: 1, blocked: 0, failed: 0 })
        expect(await queue.getJob('job:1')).toMatchObject({ state: 'queued', leaseOwner: null })
    })

    it('fences stale executors by lease token and rejects success after durable cancellation', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, 'cancel-fence')
        await enqueueOne(queue)
        const leased = await queue.claimNext({ owner: 'worker:stable-name', now: NOW, ttlMs: 5_000 })
        expect(leased?.leaseToken).toBeTruthy()

        await expect(queue.transitionJob({
            jobId: 'job:1',
            to: 'running',
            now: NOW,
            leaseOwner: 'worker:stable-name',
            leaseToken: 'stale-token',
        })).rejects.toMatchObject({ code: 'E_QUEUE_LEASE_LOST' })

        const running = await queue.transitionJob({
            jobId: 'job:1',
            to: 'running',
            now: NOW,
            leaseOwner: 'worker:stable-name',
            leaseToken: leased?.leaseToken ?? '',
        })
        await expect(queue.transitionJob({
            jobId: 'job:1',
            to: 'running',
            now: SECOND,
            leaseOwner: 'worker:stable-name',
            leaseToken: 'stale-token',
        })).rejects.toMatchObject({ code: 'E_QUEUE_LEASE_LOST' })
        await queue.requestCancel({ jobId: running.id, now: SECOND, reason: 'user' })

        await expect(queue.completeSucceeded({
            jobId: running.id,
            now: LATER,
            leaseOwner: 'worker:stable-name',
            leaseToken: leased?.leaseToken ?? '',
            outputTransactionId: 'txn:cancelled',
            artifactReference: {
                kind: 'output-writer',
                artifactId: 'artifact:cancelled',
                digest: 'sha256:cancelled',
            },
        })).rejects.toMatchObject({ code: 'E_QUEUE_CANCEL_REQUESTED' })
    })

    it('persists 429 ready-at backoff and only claims the item after the bound', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, 'backoff')
        await enqueueOne(queue)
        const leased = await queue.claimNext({ owner: 'worker:1', now: NOW, ttlMs: 5_000 })
        const running = await queue.transitionJob({
            jobId: 'job:1',
            to: 'running',
            now: NOW,
            leaseOwner: 'worker:1',
            leaseToken: leased?.leaseToken ?? '',
        })
        await queue.requeueAfterFailure({
            jobId: running.id,
            now: SECOND,
            readyAt: LATER,
            leaseOwner: 'worker:1',
            leaseToken: leased?.leaseToken ?? '',
            failureKind: 'rate-limited',
        })

        expect(await queue.claimNext({ owner: 'worker:2', now: SECOND, ttlMs: 5_000 })).toBeNull()
        expect(await queue.claimNext({ owner: 'worker:2', now: LATER, ttlMs: 5_000 }))
            .toMatchObject({ id: 'job:1', state: 'leased', attemptCount: 1 })
    })

    it('retries failed jobs as immutable successors and never clones successful jobs', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, 'retry-failed')
        await queue.createBatchAndEnqueue({
            batch: {
                id: 'batch:1', workflow: 'scene', createdAt: NOW,
                failurePolicy: 'continue', origin: 'fresh', idempotencyKey: 'batch-key:1',
            },
            jobs: [
                job(),
                job({ id: 'job:2', ordinal: 1, idempotencyKey: 'idempotency:2' }),
                job({ id: 'job:3', ordinal: 2, idempotencyKey: 'idempotency:3' }),
            ],
        })
        for (const [id, outcome] of [['job:1', 'failed'], ['job:2', 'succeeded']] as const) {
            const lease = await queue.acquireLease({ jobId: id, owner: `worker:${id}`, now: NOW, ttlMs: 5_000 })
            await queue.transitionJob({
                jobId: id,
                to: 'running',
                now: NOW,
                leaseOwner: `worker:${id}`,
                leaseToken: lease?.leaseToken ?? '',
            })
            if (outcome === 'failed') {
                await queue.transitionJob({
                    jobId: id, to: 'failed', now: SECOND,
                    leaseOwner: `worker:${id}`, leaseToken: lease?.leaseToken ?? '',
                })
            } else {
                await queue.completeSucceeded({
                    jobId: id, now: SECOND,
                    leaseOwner: `worker:${id}`, leaseToken: lease?.leaseToken ?? '',
                    outputTransactionId: `txn:${id}`,
                    artifactReference: {
                        kind: 'output-writer', artifactId: `artifact:${id}`, digest: `sha256:${id}`,
                    },
                })
            }
        }

        const retried = await queue.retryFailedJobs({
            sourceBatchId: 'batch:1',
            targetBatch: {
                id: 'batch:retry', workflow: 'scene', createdAt: LATER,
                failurePolicy: 'continue', origin: 'retry', idempotencyKey: 'retry-request:1',
            },
        })
        expect(retried.jobs).toHaveLength(1)
        expect(retried.jobs[0]).toMatchObject({
            state: 'queued',
            retryOfJobId: 'job:1',
            rootJobId: 'job:1',
        })
        expect(await queue.getJob('job:1')).toMatchObject({ state: 'failed' })
        expect(await queue.retryFailedJobs({
            sourceBatchId: 'batch:1',
            targetBatch: {
                id: 'batch:retry', workflow: 'scene', createdAt: LATER,
                failurePolicy: 'continue', origin: 'retry', idempotencyKey: 'retry-request:1',
            },
        })).toEqual(retried)

        const laterLease = await queue.acquireLease({
            jobId: 'job:3', owner: 'worker:job:3', now: SECOND, ttlMs: 20_000,
        })
        await queue.transitionJob({
            jobId: 'job:3', to: 'running', now: SECOND,
            leaseOwner: 'worker:job:3', leaseToken: laterLease?.leaseToken ?? '',
        })
        await queue.transitionJob({
            jobId: 'job:3', to: 'failed', now: LATER,
            leaseOwner: 'worker:job:3', leaseToken: laterLease?.leaseToken ?? '',
        })
        const expandedRetry = await queue.retryFailedJobs({
            sourceBatchId: 'batch:1',
            targetBatch: {
                id: 'batch:retry', workflow: 'scene', createdAt: LATER,
                failurePolicy: 'continue', origin: 'retry', idempotencyKey: 'retry-request:1',
            },
        })
        expect(expandedRetry.jobs).toHaveLength(2)
        expect(expandedRetry.jobs.map(candidate => candidate.retryOfJobId).sort()).toEqual(['job:1', 'job:3'])
    })

    it('returns lightweight state totals without loading snapshots into the projection', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, 'summary')
        await enqueueOne(queue)
        const summary = await queue.getBatchSummary('batch:1')
        const page = await queue.listJobProjections({ batchId: 'batch:1', limit: 10 })

        expect(summary).toMatchObject({ total: 1, states: { queued: 1 }, completed: 0 })
        expect(page.items[0]).not.toHaveProperty('snapshot')
        expect(page.items[0]).toMatchObject({ id: 'job:1', state: 'queued', workflow: 'scene' })
    })
})
