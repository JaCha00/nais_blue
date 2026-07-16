import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

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
        expect(schema.version).toBe(3)
        expect(schema.stores).toEqual(['attempts', 'batches', 'jobs', 'leases', 'resources'])
        expect(schema.indexes.jobs).toEqual([
            'by-batch-order',
            'by-global-order',
            'by-idempotency-key',
            'by-output-transaction',
            'by-state-order',
        ])
        expect(schema.indexes.leases).toContain('by-expires-at')
        queue.close()
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
