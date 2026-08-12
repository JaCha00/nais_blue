import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmptyGenerationBatchSummary } from '@/domain/queue/summary'
import type { GenerationJobSnapshot } from '@/domain/queue/types'
import {
    IndexedDBQueueRepository,
    QueueRepositoryError,
    type EnqueueGenerationJobInput,
} from '@/services/queue/indexeddb-queue-repository'
import { createGenerationJobSnapshot, hashGenerationJobSnapshot } from '@/services/queue/job-snapshot'
import { recoverQueueAfterRestart } from '@/services/queue/recovery'

const NOW = '2026-07-14T04:00:00.000Z'
const LATER = '2026-07-14T04:00:02.000Z'
let databaseCounter = 0

function databaseName(label: string): string {
    databaseCounter += 1
    return `nais2-queue-test-${label}-${databaseCounter}`
}

function snapshot(resources: GenerationJobSnapshot['resources'] = []): GenerationJobSnapshot {
    return createGenerationJobSnapshot({
        prompt: { positive: 'fixed queue prompt', negative: 'fixed negative' },
        parameters: { seed: 7, steps: 12 },
        outputPolicy: { format: 'webp', destination: { kind: 'app-data' } },
        resources,
        resumability: 'resumable',
    })
}

function repository(factory: IDBFactory, name: string): IndexedDBQueueRepository {
    return new IndexedDBQueueRepository({
        factory: factory as unknown as globalThis.IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName: name,
    })
}

function jobInput(overrides: Partial<EnqueueGenerationJobInput> = {}): EnqueueGenerationJobInput {
    return {
        id: 'job:1',
        batchId: 'batch:1',
        workflow: 'main',
        sceneId: null,
        createdAt: NOW,
        priority: 0,
        ordinal: 0,
        snapshot: snapshot(),
        compositionPlanHash: 'sha256:composition-plan',
        maxAttempts: 3,
        idempotencyKey: 'idempotency:1',
        ...overrides,
    }
}

async function createV1Database(
    factory: IDBFactory,
    name: string,
    record: Record<string, unknown>,
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const request = factory.open(name, 1)
        request.onupgradeneeded = () => {
            request.result.createObjectStore('batches', { keyPath: 'id' })
            request.result.createObjectStore('jobs', { keyPath: 'id' })
            request.result.createObjectStore('attempts', { keyPath: 'id' })
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction(['batches', 'jobs'], 'readwrite')
            transaction.objectStore('batches').put({
                id: 'batch:1',
                workflow: 'main',
                createdAt: NOW,
                updatedAt: NOW,
            })
            transaction.objectStore('jobs').put(record)
            transaction.oncomplete = () => {
                db.close()
                resolve()
            }
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error ?? new Error('v1 fixture aborted'))
        }
    })
}

async function createV3Database(factory: IDBFactory, name: string): Promise<void> {
    const fixedSnapshot = snapshot()
    await new Promise<void>((resolve, reject) => {
        const request = factory.open(name, 3)
        request.onupgradeneeded = () => {
            const database = request.result
            const batches = database.createObjectStore('batches', { keyPath: 'id' })
            batches.createIndex('by-created-at', 'createdAt')
            batches.createIndex('by-idempotency-key', 'idempotencyKey', { unique: true })
            const jobs = database.createObjectStore('jobs', { keyPath: 'id' })
            jobs.createIndex('by-idempotency-key', 'idempotencyKey', { unique: true })
            jobs.createIndex('by-global-order', 'globalOrderKey')
            jobs.createIndex('by-batch-order', 'batchOrderKey')
            jobs.createIndex('by-state-order', 'stateOrderKey')
            jobs.createIndex('by-output-transaction', 'outputTransactionId', { unique: true })
            const attempts = database.createObjectStore('attempts', { keyPath: 'id' })
            attempts.createIndex('by-job-attempt', 'jobAttemptKey', { unique: true })
            const leases = database.createObjectStore('leases', { keyPath: 'jobId' })
            leases.createIndex('by-expires-at', 'expiresAt')
            const resources = database.createObjectStore('resources', { keyPath: 'id' })
            resources.createIndex('by-digest', 'digest')
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const database = request.result
            const transaction = database.transaction(['batches', 'jobs'], 'readwrite')
            transaction.objectStore('batches').put({
                id: 'batch:1',
                workflow: 'main',
                createdAt: NOW,
                updatedAt: NOW,
                state: 'active',
                failurePolicy: 'continue',
                pauseReason: null,
                origin: 'fresh',
                idempotencyKey: 'batch:1',
                version: 1,
            })
            transaction.objectStore('jobs').put({
                recordSchemaVersion: 3,
                id: 'job:1',
                batchId: 'batch:1',
                workflow: 'main',
                sceneId: null,
                state: 'queued',
                createdAt: NOW,
                updatedAt: NOW,
                priority: 0,
                ordinal: 0,
                snapshotSchemaVersion: fixedSnapshot.schemaVersion,
                snapshot: fixedSnapshot,
                snapshotHash: hashGenerationJobSnapshot(fixedSnapshot),
                compositionPlanHash: null,
                attemptCount: 0,
                maxAttempts: 3,
                idempotencyKey: 'idempotency:1',
                progress: { stage: 'queued', current: 0, total: 0 },
                lastDiagnosticEventId: null,
                outputTransactionId: null,
                artifactReference: null,
                blockReason: null,
                readyAt: NOW,
                cancelRequestedAt: null,
                cancelReason: null,
                retryOfJobId: null,
                rootJobId: 'job:1',
                version: 1,
                globalOrderKey: [0, 0, NOW, 'job:1'],
                batchOrderKey: ['batch:1', 0, 0, NOW, 'job:1'],
                stateOrderKey: ['queued', 0, 0, NOW, 'job:1'],
            })
            transaction.oncomplete = () => {
                database.close()
                resolve()
            }
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error ?? new Error('v3 fixture aborted'))
        }
    })
}

async function createV4Database(factory: IDBFactory, name: string): Promise<string> {
    await createV3Database(factory, name)
    const fixedSnapshot = snapshot()
    const snapshotHash = hashGenerationJobSnapshot(fixedSnapshot)
    await new Promise<void>((resolve, reject) => {
        const request = factory.open(name, 4)
        request.onupgradeneeded = () => {
            const jobs = request.transaction?.objectStore('jobs')
            if (jobs !== undefined && !jobs.indexNames.contains('by-batch-state-order')) {
                jobs.createIndex('by-batch-state-order', 'batchStateOrderKey')
            }
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const database = request.result
            const transaction = database.transaction(['attempts', 'batches', 'jobs', 'leases'], 'readwrite')
            const emptyFirst = createEmptyGenerationBatchSummary('batch:0')
            const emptySecond = createEmptyGenerationBatchSummary('batch:1')
            transaction.objectStore('batches').put({
                id: 'batch:0',
                workflow: 'main',
                createdAt: NOW,
                updatedAt: NOW,
                state: 'active',
                failurePolicy: 'continue',
                pauseReason: null,
                origin: 'fresh',
                idempotencyKey: 'batch:0',
                version: 3,
                projectionRevision: 9,
                projectionSummary: emptyFirst,
            })
            transaction.objectStore('batches').put({
                id: 'batch:1',
                workflow: 'main',
                createdAt: NOW,
                updatedAt: NOW,
                state: 'active',
                failurePolicy: 'continue',
                pauseReason: null,
                origin: 'fresh',
                idempotencyKey: 'batch:1',
                version: 4,
                projectionRevision: 7,
                projectionSummary: {
                    ...emptySecond,
                    total: 1,
                    progressCurrent: 1 / 3,
                    progressTotal: 1,
                    states: { ...emptySecond.states, running: 1 },
                },
            })
            transaction.objectStore('jobs').put({
                recordSchemaVersion: 3,
                id: 'job:1',
                batchId: 'batch:1',
                workflow: 'main',
                sceneId: null,
                state: 'running',
                createdAt: NOW,
                updatedAt: NOW,
                priority: 0,
                ordinal: 0,
                snapshotSchemaVersion: fixedSnapshot.schemaVersion,
                snapshot: fixedSnapshot,
                snapshotHash,
                compositionPlanHash: null,
                attemptCount: 1,
                maxAttempts: 3,
                idempotencyKey: 'idempotency:1',
                progress: { stage: 'request', current: 1, total: 3 },
                lastDiagnosticEventId: 'diagnostic:v4',
                outputTransactionId: null,
                artifactReference: null,
                blockReason: null,
                readyAt: NOW,
                cancelRequestedAt: null,
                cancelReason: null,
                retryOfJobId: 'job:source',
                rootJobId: 'job:source',
                version: 5,
                globalOrderKey: [0, 0, NOW, 'job:1'],
                batchOrderKey: ['batch:1', 0, 0, NOW, 'job:1'],
                batchStateOrderKey: ['batch:1', 'running', 0, 0, NOW, 'job:1'],
                stateOrderKey: ['running', 0, 0, NOW, 'job:1'],
            })
            transaction.objectStore('attempts').put({
                id: 'job:1:1',
                jobId: 'job:1',
                attemptNumber: 1,
                startedAt: NOW,
                finishedAt: null,
                outcome: 'running',
                diagnosticEventId: null,
                jobAttemptKey: ['job:1', 1],
            })
            transaction.objectStore('leases').put({
                jobId: 'job:1',
                owner: 'worker:v4',
                token: 'lease:v4',
                expiresAt: LATER,
                heartbeatAt: NOW,
            })
            transaction.oncomplete = () => {
                database.close()
                resolve()
            }
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error ?? new Error('v4 fixture aborted'))
        }
    })
    return snapshotHash
}

async function readRawJob(factory: IDBFactory, name: string, version: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const request = factory.open(name, version)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('jobs', 'readonly')
            const get = transaction.objectStore('jobs').get('job:1')
            get.onsuccess = () => resolve(get.result)
            get.onerror = () => reject(get.error)
            transaction.oncomplete = () => db.close()
        }
    })
}

describe('normalized IndexedDB durable queue repository', () => {
    beforeEach(() => {
        databaseCounter = 0
    })

    it('creates normalized stores and deterministic indexes without a Zustand job blob', async () => {
        const factory = new IDBFactory()
        const name = databaseName('schema')
        const queue = repository(factory, name)
        await queue.initialize()

        const schema = await queue.inspectSchema()
        expect(schema.version).toBe(5)
        expect(schema.stores).toEqual(['attempts', 'batches', 'jobs', 'leases', 'resources'])
        expect(schema.indexes.jobs).toEqual([
            'by-batch-order',
            'by-batch-state-order',
            'by-global-order',
            'by-idempotency-key',
            'by-output-transaction',
            'by-state-order',
        ])
        expect(schema.indexes.leases).toContain('by-expires-at')
        expect(schema.indexes.batches).toContain('by-queue-sequence')
        queue.close()
    })

    it('projects the immutable output folder without exposing the full snapshot', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, databaseName('output-directory-projection'))
        const fixedSnapshot = createGenerationJobSnapshot({
            prompt: { positive: 'prompt', negative: '' },
            parameters: { seed: 7 },
            outputPolicy: {
                workflow: 'main',
                output: { directory: 'D:\\Images\\Prime\\01' },
            },
            resources: [],
            resumability: 'resumable',
        })
        await queue.createBatchAndEnqueue({
            batch: {
                id: 'batch:1', workflow: 'main', createdAt: NOW,
                failurePolicy: 'continue', origin: 'fresh', idempotencyKey: 'batch:1',
            },
            jobs: [jobInput({ snapshot: fixedSnapshot })],
        })

        const page = await queue.listJobProjections({ batchId: 'batch:1' })
        expect(page.items[0]).toMatchObject({ outputDirectory: 'D:\\Images\\Prime\\01' })
        expect(page.items[0]).not.toHaveProperty('snapshot')
        queue.close()
    })

    it('orders the oldest batch before a newer batch ordinal while preserving priority', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, databaseName('cross-batch-order'))
        const oldBatchId = 'batch:z-old'
        const newBatchId = 'batch:a-new'
        await queue.createBatchAndEnqueue({
            batch: {
                id: oldBatchId, workflow: 'main', createdAt: NOW,
                failurePolicy: 'continue', origin: 'fresh', idempotencyKey: oldBatchId,
            },
            jobs: [0, 1].map(ordinal => jobInput({
                id: `job:old:${ordinal}`,
                batchId: oldBatchId,
                ordinal,
                idempotencyKey: `job:old:${ordinal}`,
            })),
        })
        await queue.createBatchAndEnqueue({
            batch: {
                id: newBatchId, workflow: 'main', createdAt: NOW,
                failurePolicy: 'continue', origin: 'fresh', idempotencyKey: newBatchId,
            },
            jobs: [
                jobInput({
                    id: 'job:new:normal', batchId: newBatchId, priority: 0, ordinal: 0,
                    idempotencyKey: 'job:new:normal',
                }),
                jobInput({
                    id: 'job:new:urgent', batchId: newBatchId, priority: 1, ordinal: 1,
                    idempotencyKey: 'job:new:urgent',
                }),
            ],
        })

        expect(await queue.getBatch(oldBatchId)).toMatchObject({ queueSequence: 1 })
        expect(await queue.getBatch(newBatchId)).toMatchObject({ queueSequence: 2 })
        expect((await queue.listJobs({ states: ['queued'] })).items.map(job => job.id)).toEqual([
            'job:new:urgent',
            'job:old:0',
            'job:old:1',
            'job:new:normal',
        ])
    })

    it('allocates unique monotonic batch sequences across repository instances', async () => {
        const factory = new IDBFactory()
        const name = databaseName('sequence-race')
        const first = repository(factory, name)
        const second = repository(factory, name)
        await Promise.all([first.initialize(), second.initialize()])

        const batches = await Promise.all([
            first.createBatch({ id: 'batch:a', workflow: 'main', createdAt: NOW }),
            second.createBatch({ id: 'batch:b', workflow: 'main', createdAt: NOW }),
        ])
        expect(batches.map(batch => batch.queueSequence).sort((left, right) => left - right)).toEqual([1, 2])
    })

    it('migrates v4 order deterministically without rewriting snapshot or runtime records', async () => {
        const factory = new IDBFactory()
        const name = databaseName('v5-order-upgrade')
        const snapshotHash = await createV4Database(factory, name)
        const queue = repository(factory, name)
        await queue.initialize()

        expect(await queue.getBatch('batch:0')).toMatchObject({
            queueSequence: 1,
            version: 3,
            projectionRevision: 9,
        })
        expect(await queue.getBatch('batch:1')).toMatchObject({
            queueSequence: 2,
            version: 4,
            projectionRevision: 7,
            projectionSummary: { total: 1, states: { running: 1 } },
        })
        expect(await queue.getJob('job:1')).toMatchObject({
            state: 'running',
            snapshotSchemaVersion: 1,
            snapshotHash,
            leaseOwner: 'worker:v4',
            attemptCount: 1,
            retryOfJobId: 'job:source',
            rootJobId: 'job:source',
            version: 5,
        })
        expect(await queue.listAttempts('job:1')).toEqual([
            expect.objectContaining({ attemptNumber: 1, outcome: 'running', finishedAt: null }),
        ])
    })

    it('deduplicates the same idempotency key and rejects conflicting content', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, databaseName('idempotency'))
        await queue.initialize()
        await queue.createBatch({ id: 'batch:1', workflow: 'main', createdAt: NOW })

        const first = await queue.enqueue(jobInput())
        const duplicate = await queue.enqueue(jobInput({ id: 'job:duplicate' }))
        expect(duplicate.id).toBe(first.id)

        await expect(queue.enqueue(jobInput({
            id: 'job:conflict',
            snapshot: createGenerationJobSnapshot({
                prompt: { positive: 'different fixed prompt', negative: '' },
                parameters: { seed: 8 },
                outputPolicy: { format: 'png' },
                resources: [],
                resumability: 'resumable',
            }),
        }))).rejects.toMatchObject({ code: 'E_QUEUE_IDEMPOTENCY_CONFLICT' })
    })

    it('grants exactly one competing CAS lease and preserves owner checks', async () => {
        const factory = new IDBFactory()
        const name = databaseName('lease-race')
        const first = repository(factory, name)
        const second = repository(factory, name)
        await Promise.all([first.initialize(), second.initialize()])
        await first.createBatch({ id: 'batch:1', workflow: 'main', createdAt: NOW })
        await first.enqueue(jobInput())

        const leases = await Promise.all([
            first.acquireLease({ jobId: 'job:1', owner: 'worker:a', now: NOW, ttlMs: 1_000 }),
            second.acquireLease({ jobId: 'job:1', owner: 'worker:b', now: NOW, ttlMs: 1_000 }),
        ])
        expect(leases.filter(Boolean)).toHaveLength(1)
        const winner = leases.find(Boolean)
        expect(winner?.state).toBe('leased')
        expect(winner?.leaseOwner).toMatch(/^worker:[ab]$/)

        const loser = winner?.leaseOwner === 'worker:a' ? 'worker:b' : 'worker:a'
        await expect(first.transitionJob({
            jobId: 'job:1',
            to: 'running',
            now: NOW,
            leaseOwner: loser,
        })).rejects.toMatchObject({ code: 'E_QUEUE_LEASE_LOST' })
    })

    it('recovers an expired running lease after an app restart', async () => {
        const factory = new IDBFactory()
        const name = databaseName('restart')
        const beforeRestart = repository(factory, name)
        await beforeRestart.initialize()
        await beforeRestart.createBatch({ id: 'batch:1', workflow: 'main', createdAt: NOW })
        await beforeRestart.enqueue(jobInput())
        const lease = await beforeRestart.acquireLease({ jobId: 'job:1', owner: 'worker:old', now: NOW, ttlMs: 1_000 })
        await beforeRestart.transitionJob({
            jobId: 'job:1',
            to: 'running',
            now: NOW,
            leaseOwner: 'worker:old',
            leaseToken: lease?.leaseToken ?? '',
        })
        beforeRestart.close()

        const afterRestart = repository(factory, name)
        const recovered = await recoverQueueAfterRestart(afterRestart, { now: LATER })
        expect(recovered).toMatchObject({ recovering: 1, queued: 1, blocked: 0, failed: 0 })
        expect(await afterRestart.getJob('job:1')).toMatchObject({
            state: 'queued',
            attemptCount: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
        })
    })

    it('blocks recovery when a required managed resource is missing', async () => {
        const factory = new IDBFactory()
        const name = databaseName('missing-resource')
        const queue = repository(factory, name)
        await queue.initialize()
        await queue.createBatch({ id: 'batch:1', workflow: 'scene', createdAt: NOW })
        await queue.enqueue(jobInput({
            workflow: 'scene',
            sceneId: 'scene:1',
            snapshot: snapshot([{
                resourceId: 'resource:missing',
                role: 'source',
                persistence: 'managed-app-data',
                digest: 'sha256:missing',
                reference: { relativePath: 'queue-resources/missing.bin' },
            }]),
        }))
        await queue.acquireLease({ jobId: 'job:1', owner: 'worker:old', now: NOW, ttlMs: 1_000 })
        queue.close()

        const restarted = repository(factory, name)
        const recovered = await recoverQueueAfterRestart(restarted, { now: LATER })
        expect(recovered).toMatchObject({ recovering: 1, queued: 0, blocked: 1, failed: 0 })
        expect(await restarted.getJob('job:1')).toMatchObject({
            state: 'blocked',
            blockReason: 'missing-resource',
        })
    })

    it('paginates 10,000 jobs in stable indexed order without gaps or duplicates', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, databaseName('pagination'))
        await queue.initialize()
        await queue.createBatch({ id: 'batch:1', workflow: 'main', createdAt: NOW })
        const fixedSnapshot = snapshot()
        const jobs: EnqueueGenerationJobInput[] = Array.from({ length: 10_000 }, (_, index) => ({
            id: `job:${index.toString().padStart(5, '0')}`,
            batchId: 'batch:1',
            workflow: 'main',
            sceneId: null,
            createdAt: new Date(Date.parse(NOW) + index).toISOString(),
            priority: index % 7,
            ordinal: 10_000 - index,
            snapshot: fixedSnapshot,
            compositionPlanHash: null,
            maxAttempts: 3,
            idempotencyKey: `idempotency:${index}`,
        }))
        await queue.enqueueMany(jobs)

        const ids: string[] = []
        let cursor: string | null = null
        do {
            const page = await queue.listJobs({ batchId: 'batch:1', cursor, limit: 137 })
            ids.push(...page.items.map(job => job.id))
            cursor = page.nextCursor
        } while (cursor !== null)

        const expected = [...jobs]
            .sort((left, right) => (
                right.priority - left.priority
                || left.ordinal - right.ordinal
                || left.createdAt.localeCompare(right.createdAt)
                || left.id.localeCompare(right.id)
            ))
            .map(job => job.id)
        expect(ids).toEqual(expected)
        expect(new Set(ids).size).toBe(10_000)
    }, 30_000)

    it('backfills v3 batch aggregates and reads bounded indexed projection windows', async () => {
        const factory = new IDBFactory()
        const name = databaseName('projection-upgrade')
        await createV3Database(factory, name)
        const queue = repository(factory, name)
        await queue.initialize()

        const projectionReads = vi.spyOn(queue, 'listJobProjections')
        await expect(queue.getBatchSummary('batch:1')).resolves.toMatchObject({
            total: 1,
            states: { queued: 1 },
        })
        expect(projectionReads).not.toHaveBeenCalled()

        const firstWindow = await queue.listJobProjectionWindow({
            batchId: 'batch:1',
            offset: 0,
            limit: 1,
        })
        expect(firstWindow).toMatchObject({
            revision: 1,
            total: 1,
            state: null,
            items: [expect.objectContaining({ id: 'job:1', state: 'queued' })],
        })
        expect(firstWindow.items[0]).not.toHaveProperty('snapshot')
        expect((await queue.inspectSchema()).indexes.jobs).toContain('by-batch-state-order')
    })

    it('advances the durable summary revision for queue-visible mutations and windows', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, databaseName('projection-delta'))
        await queue.createBatch({ id: 'batch:1', workflow: 'main', createdAt: NOW })
        await queue.enqueueMany(Array.from({ length: 8 }, (_, index) => jobInput({
            id: `job:${index}`,
            ordinal: index,
            idempotencyKey: `idempotency:${index}`,
        })))

        const initial = await queue.getBatchProjectionMeta('batch:1')
        expect(initial).toMatchObject({ revision: 1, summary: { total: 8, states: { queued: 8 } } })
        const middle = await queue.listJobProjectionWindow({ batchId: 'batch:1', offset: 3, limit: 2 })
        expect(middle.items.map(job => job.id)).toEqual(['job:3', 'job:4'])

        const lease = await queue.acquireLease({ jobId: 'job:3', owner: 'worker:projection', now: NOW, ttlMs: 60_000 })
        const leased = await queue.getBatchProjectionMeta('batch:1')
        expect(leased).toMatchObject({ revision: 2, summary: { states: { queued: 7, leased: 1 } } })
        await queue.transitionJob({
            jobId: 'job:3',
            to: 'running',
            now: NOW,
            leaseOwner: 'worker:projection',
            leaseToken: lease?.leaseToken ?? '',
        })
        await queue.updateProgress({
            jobId: 'job:3',
            leaseOwner: 'worker:projection',
            leaseToken: lease?.leaseToken ?? '',
            now: NOW,
            progress: { stage: 'sampling', current: 1, total: 4 },
        })
        const running = await queue.getBatchProjectionMeta('batch:1')
        expect(running).toMatchObject({
            revision: 4,
            summary: { states: { queued: 7, running: 1 }, progressCurrent: 0.25, progressTotal: 8 },
        })
        const runningWindow = await queue.listJobProjectionWindow({
            batchId: 'batch:1', state: 'running', offset: 0, limit: 4,
        })
        expect(runningWindow).toMatchObject({ total: 1, items: [expect.objectContaining({ id: 'job:3' })] })

        await queue.bindOutputTransaction({
            jobId: 'job:3',
            leaseOwner: 'worker:projection',
            leaseToken: lease?.leaseToken ?? '',
            now: LATER,
            outputTransactionId: 'output:projection',
            artifactReference: { kind: 'output-writer', artifactId: 'artifact:projection', digest: 'sha256:projection' },
        })
        await queue.completeSucceeded({
            jobId: 'job:3',
            leaseOwner: 'worker:projection',
            leaseToken: lease?.leaseToken ?? '',
            now: LATER,
            outputTransactionId: 'output:projection',
            artifactReference: { kind: 'output-writer', artifactId: 'artifact:projection', digest: 'sha256:projection' },
        })
        await expect(queue.getBatchProjectionMeta('batch:1')).resolves.toMatchObject({
            revision: 6,
            summary: {
                completed: 1,
                progressCurrent: 1,
                states: { queued: 7, succeeded: 1 },
                recentCompletedAt: [LATER],
            },
        })
    })

    it('records attempts, output references, and terminal idempotency while rejecting terminal mutation', async () => {
        const factory = new IDBFactory()
        const queue = repository(factory, databaseName('terminal'))
        await queue.initialize()
        await queue.createBatch({ id: 'batch:1', workflow: 'main', createdAt: NOW })
        await queue.enqueue(jobInput())
        const lease = await queue.acquireLease({ jobId: 'job:1', owner: 'worker:1', now: NOW, ttlMs: 5_000 })
        await queue.transitionJob({
            jobId: 'job:1',
            to: 'running',
            now: NOW,
            leaseOwner: 'worker:1',
            leaseToken: lease?.leaseToken ?? '',
        })
        const succeeded = await queue.transitionJob({
            jobId: 'job:1',
            to: 'succeeded',
            now: LATER,
            leaseOwner: 'worker:1',
            leaseToken: lease?.leaseToken ?? '',
            outputTransactionId: 'output-transaction:1',
            artifactReference: {
                kind: 'output-writer',
                artifactId: 'artifact:1',
                digest: 'sha256:artifact',
            },
        })
        const repeated = await queue.transitionJob({
            jobId: 'job:1',
            to: 'succeeded',
            now: '2026-07-14T04:00:03.000Z',
            leaseOwner: 'worker:1',
        })
        expect(repeated).toEqual(succeeded)
        expect(await queue.listAttempts('job:1')).toEqual([
            expect.objectContaining({ attemptNumber: 1, outcome: 'succeeded', finishedAt: LATER }),
        ])
        await expect(queue.transitionJob({
            jobId: 'job:1',
            to: 'queued',
            now: LATER,
        })).rejects.toMatchObject({ code: 'E_QUEUE_TERMINAL_IMMUTABLE' })
    })

    it('upgrades a v1 denormalized lease without losing the job', async () => {
        const factory = new IDBFactory()
        const name = databaseName('upgrade')
        const fixedSnapshot = snapshot()
        await createV1Database(factory, name, {
            recordSchemaVersion: 1,
            id: 'job:1',
            batchId: 'batch:1',
            workflow: 'main',
            sceneId: null,
            state: 'running',
            createdAt: NOW,
            updatedAt: NOW,
            priority: 0,
            ordinal: 0,
            snapshotSchemaVersion: fixedSnapshot.schemaVersion,
            snapshot: fixedSnapshot,
            snapshotHash: hashGenerationJobSnapshot(fixedSnapshot),
            compositionPlanHash: null,
            attemptCount: 1,
            maxAttempts: 3,
            idempotencyKey: 'idempotency:1',
            leaseOwner: 'worker:legacy',
            leaseExpiresAt: LATER,
            heartbeatAt: NOW,
            progress: { stage: 'request', current: 1, total: 3 },
            lastDiagnosticEventId: null,
            outputTransactionId: null,
            artifactReference: null,
            blockReason: null,
            version: 3,
        })

        const queue = repository(factory, name)
        await queue.initialize()
        expect(await queue.getJob('job:1')).toMatchObject({
            state: 'running',
            leaseOwner: 'worker:legacy',
            attemptCount: 1,
        })
        expect((await queue.inspectSchema()).stores).toContain('resources')
    })

    it('aborts a malformed schema upgrade and preserves the v1 record', async () => {
        const factory = new IDBFactory()
        const name = databaseName('abort')
        await createV1Database(factory, name, { id: 'job:1', malformed: true })
        const queue = repository(factory, name)

        await expect(queue.initialize()).rejects.toMatchObject({
            name: 'QueueRepositoryError',
            code: 'E_QUEUE_TRANSACTION_ABORTED',
        } satisfies Partial<QueueRepositoryError>)
        expect(await readRawJob(factory, name, 1)).toEqual({ id: 'job:1', malformed: true })
    })
})
