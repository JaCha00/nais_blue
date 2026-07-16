import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { GenerationJobSnapshot, QueueArtifactReference } from '@/domain/queue/types'
import {
    DurableQueueCoordinator,
    QueueExecutionError,
    type QueueExecutorContext,
} from '@/services/queue/durable-queue-coordinator'
import { OutputWriterError } from '@/services/output/output-writer'
import {
    IndexedDBQueueRepository,
    type EnqueueGenerationJobInput,
} from '@/services/queue/indexeddb-queue-repository'
import { createGenerationJobSnapshot } from '@/services/queue/job-snapshot'

const NOW = '2026-07-14T08:00:00.000Z'
let databaseCounter = 0

function snapshot(streaming = false, sourceEdit = false): GenerationJobSnapshot {
    return createGenerationJobSnapshot({
        prompt: { positive: 'durable executor prompt', negative: '' },
        parameters: { queueExecution: { streaming, sourceEdit } },
        outputPolicy: { format: 'png' },
        resources: [],
        resumability: 'resumable',
    })
}

function sequentialMainSnapshot(ordinal: number): GenerationJobSnapshot {
    return createGenerationJobSnapshot({
        prompt: { positive: 'sequential durable prompt', negative: '' },
        parameters: {
            queueExecution: { streaming: false, sourceEdit: false },
            mainWorkflow: {
                sequenceCommitProposal: {
                    expectedRevision: ordinal,
                    changes: [{
                        fragmentId: 'fragment:sequential',
                        fragmentPath: 'sequential',
                        expectedCounter: ordinal,
                        nextCounter: ordinal + 1,
                    }],
                },
            },
        },
        outputPolicy: { format: 'png' },
        resources: [],
        resumability: 'resumable',
    })
}

function repository(label: string): IndexedDBQueueRepository {
    databaseCounter += 1
    const factory = new IDBFactory()
    return new IndexedDBQueueRepository({
        factory: factory as unknown as globalThis.IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName: `coordinator-${label}-${databaseCounter}`,
    })
}

function jobs(count: number, options: { streaming?: boolean; sourceEdit?: boolean } = {}): EnqueueGenerationJobInput[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `job:${index}`,
        batchId: 'batch:1',
        workflow: 'scene' as const,
        sceneId: `scene:${index}`,
        createdAt: NOW,
        priority: 0,
        ordinal: index,
        snapshot: snapshot(options.streaming, options.sourceEdit),
        compositionPlanHash: null,
        maxAttempts: 3,
        idempotencyKey: `job-key:${index}`,
    }))
}

function sequentialMainJobs(count: number): EnqueueGenerationJobInput[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `job:${index}`,
        batchId: 'batch:1',
        workflow: 'main' as const,
        sceneId: null,
        createdAt: NOW,
        priority: 0,
        ordinal: index,
        snapshot: sequentialMainSnapshot(index),
        compositionPlanHash: null,
        maxAttempts: 3,
        idempotencyKey: `job-key:${index}`,
    }))
}

async function enqueue(queue: IndexedDBQueueRepository, inputs: EnqueueGenerationJobInput[]): Promise<void> {
    await queue.createBatchAndEnqueue({
        batch: {
            id: 'batch:1', workflow: inputs[0]?.workflow ?? 'scene', createdAt: NOW,
            failurePolicy: 'continue', origin: 'fresh', idempotencyKey: 'batch-key:1',
        },
        jobs: inputs,
    })
}

function artifact(jobId: string): QueueArtifactReference {
    return {
        kind: 'output-writer',
        artifactId: `artifact:${jobId}`,
        digest: `sha256:${jobId}`,
        mimeType: 'image/png',
    }
}

async function commit(context: QueueExecutorContext, jobId: string): Promise<void> {
    const transactionId = `txn-${jobId.replace(/[^A-Za-z0-9-]/g, '-')}`
    const reference = artifact(jobId)
    await context.bindOutput(transactionId, reference)
    await context.commitOutput(transactionId, reference)
}

function coordinator(
    queue: IndexedDBQueueRepository,
    execute: (context: QueueExecutorContext, jobId: string) => Promise<void>,
    now: () => string = () => NOW,
): DurableQueueCoordinator {
    return new DurableQueueCoordinator({
        repository: queue,
        tokenProvider: () => [
            { slotId: 'slot-1', token: 'runtime-token-one' },
            { slotId: 'slot-2', token: 'runtime-token-two' },
        ],
        executor: {
            execute: (job, context) => execute(context, job.id),
        },
        now,
        leaseTtlMs: 60_000,
    })
}

async function waitUntil(predicate: () => boolean): Promise<void> {
    for (let index = 0; index < 100; index += 1) {
        if (predicate()) return
        await new Promise(resolve => setTimeout(resolve, 0))
    }
    throw new Error('condition did not become true')
}

describe('durable queue coordinator', () => {
    it('preserves the Scene dual-token maximum concurrency', async () => {
        const queue = repository('dual')
        await enqueue(queue, jobs(5))
        let active = 0
        let maximum = 0
        const runtime = coordinator(queue, async (context, jobId) => {
            active += 1
            maximum = Math.max(maximum, active)
            await new Promise(resolve => setTimeout(resolve, 5))
            await commit(context, jobId)
            active -= 1
        })

        await runtime.drain()
        expect(maximum).toBe(2)
        expect((await queue.getBatchSummary('batch:1')).states.succeeded).toBe(5)
    })

    it('runs streaming text-to-image work in exactly one slot', async () => {
        const queue = repository('streaming')
        await enqueue(queue, jobs(3, { streaming: true }))
        let active = 0
        let maximum = 0
        const runtime = coordinator(queue, async (context, jobId) => {
            active += 1
            maximum = Math.max(maximum, active)
            await new Promise(resolve => setTimeout(resolve, 0))
            await commit(context, jobId)
            active -= 1
        })

        await runtime.drain()
        expect(maximum).toBe(1)
    })

    it('pauses the durable batch on 401 and preserves the current job for resume', async () => {
        const queue = repository('auth')
        await enqueue(queue, jobs(2))
        const runtime = coordinator(queue, async () => {
            throw new QueueExecutionError('authentication', 'credential rejected')
        })

        await runtime.drain()
        expect(await queue.getBatch('batch:1')).toMatchObject({
            state: 'paused',
            pauseReason: 'authentication',
        })
        expect((await queue.getBatchSummary('batch:1')).states.queued).toBe(2)
    })

    it('persists 429 backoff and does not turn it into a global pause', async () => {
        const queue = repository('rate-limit')
        await enqueue(queue, jobs(1))
        const runtime = coordinator(queue, async () => {
            throw new QueueExecutionError('rate-limited', 'provider asked to retry', { retryAfterMs: 5_000 })
        })

        await runtime.drain()
        expect(await queue.getBatch('batch:1')).toMatchObject({ state: 'active' })
        expect(await queue.getJob('job:0')).toMatchObject({
            state: 'queued',
            readyAt: '2026-07-14T08:00:05.000Z',
            attemptCount: 1,
        })
    })

    it('keeps a sequential Main tail queued while its predecessor retry is not ready', async () => {
        const queue = repository('main-sequence-retry')
        await enqueue(queue, sequentialMainJobs(2))
        const providerCalls: string[] = []
        const runtime = coordinator(queue, async (context, jobId) => {
            providerCalls.push(jobId)
            if (jobId === 'job:0') {
                throw new QueueExecutionError('rate-limited', 'retry the sequence head later', { retryAfterMs: 5_000 })
            }
            await commit(context, jobId)
        })

        await runtime.drain()
        expect(providerCalls).toEqual(['job:0'])
        expect(await queue.getJob('job:0')).toMatchObject({
            state: 'queued',
            readyAt: '2026-07-14T08:00:05.000Z',
            attemptCount: 1,
        })
        expect(await queue.getJob('job:1')).toMatchObject({ state: 'queued', attemptCount: 0 })
    })

    it('skips a sequential Main tail without provider calls after a terminal predecessor failure', async () => {
        const queue = repository('main-sequence-failure')
        await enqueue(queue, sequentialMainJobs(3))
        const providerCalls: string[] = []
        const runtime = coordinator(queue, async (context, jobId) => {
            providerCalls.push(jobId)
            if (jobId === 'job:0') throw new QueueExecutionError('decode', 'sequence head failed')
            await commit(context, jobId)
        })

        await runtime.drain()
        expect(providerCalls).toEqual(['job:0'])
        expect(await queue.getJob('job:0')).toMatchObject({ state: 'failed', attemptCount: 1 })
        expect(await queue.getJob('job:1')).toMatchObject({ state: 'skipped', attemptCount: 0 })
        expect(await queue.getJob('job:2')).toMatchObject({ state: 'skipped', attemptCount: 0 })
    })

    it('continues after one decode error and commits the next item', async () => {
        const queue = repository('decode')
        await enqueue(queue, jobs(2))
        const runtime = coordinator(queue, async (context, jobId) => {
            if (jobId === 'job:0') throw new QueueExecutionError('decode', 'invalid image archive')
            await commit(context, jobId)
        })

        await runtime.drain()
        expect(await queue.getJob('job:0')).toMatchObject({
            state: 'failed',
            lastDiagnosticEventId: expect.any(String),
        })
        expect(await queue.getJob('job:1')).toMatchObject({ state: 'succeeded' })
        expect(await queue.getBatch('batch:1')).toMatchObject({ state: 'active' })
    })

    it('blocks a missing managed resource and continues with the next item', async () => {
        const queue = repository('missing-resource')
        await enqueue(queue, jobs(2))
        const runtime = coordinator(queue, async (context, jobId) => {
            if (jobId === 'job:0') {
                throw Object.assign(new Error('managed resource unavailable'), {
                    code: 'E_QUEUE_RESOURCE_MISSING',
                })
            }
            await commit(context, jobId)
        })

        await runtime.drain()
        expect(await queue.getJob('job:0')).toMatchObject({
            state: 'blocked',
            blockReason: 'missing-resource',
            lastDiagnosticEventId: expect.any(String),
        })
        expect(await queue.getJob('job:1')).toMatchObject({ state: 'succeeded' })
    })

    it('pauses on disk-full and never marks the item successful', async () => {
        const queue = repository('disk-full')
        await enqueue(queue, jobs(1))
        const runtime = coordinator(queue, async () => {
            const cause = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
            throw new OutputWriterError('atomic-commit', 'Output commit failed', { cause })
        })

        await runtime.drain()
        expect(await queue.getBatch('batch:1')).toMatchObject({ state: 'paused', pauseReason: 'local-io' })
        expect(await queue.getJob('job:0')).toMatchObject({ state: 'queued' })
    })

    it('aborts an active item and rejects a late output commit after cancel', async () => {
        const queue = repository('late-cancel')
        await enqueue(queue, jobs(1))
        let context: QueueExecutorContext | null = null
        let release: (() => void) | null = null
        const runtime = coordinator(queue, async (activeContext, jobId) => {
            context = activeContext
            await new Promise<void>(resolve => { release = resolve })
            expect(activeContext.canCommit()).toBe(false)
            await expect(commit(activeContext, jobId)).rejects.toMatchObject({ code: 'E_QUEUE_CANCEL_REQUESTED' })
        })

        const draining = runtime.drain()
        await waitUntil(() => context !== null)
        await runtime.cancelJob('job:0')
        expect(context?.signal.aborted).toBe(true)
        release?.()
        await draining
        expect(await queue.getJob('job:0')).toMatchObject({
            state: 'cancelled',
            artifactReference: null,
        })
    })
})
