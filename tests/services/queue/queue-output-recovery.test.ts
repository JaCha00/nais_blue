import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import type { QueueArtifactReference } from '@/domain/queue/types'
import type { OutputWriter } from '@/services/output/output-writer'
import {
    IndexedDBQueueRepository,
    type EnqueueGenerationJobInput,
} from '@/services/queue/indexeddb-queue-repository'
import { createGenerationJobSnapshot } from '@/services/queue/job-snapshot'
import { recoverQueueLinkedOutputs } from '@/services/queue/queue-output-recovery'

const NOW = '2026-07-14T09:00:00.000Z'
const LATER = '2026-07-14T09:01:00.000Z'

function queue(): IndexedDBQueueRepository {
    const factory = new IDBFactory()
    return new IndexedDBQueueRepository({
        factory: factory as unknown as globalThis.IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName: 'queue-output-recovery',
    })
}

function job(): EnqueueGenerationJobInput {
    return {
        id: 'job:1', batchId: 'batch:1', workflow: 'main', sceneId: null,
        createdAt: NOW, priority: 0, ordinal: 0, compositionPlanHash: null,
        maxAttempts: 3, idempotencyKey: 'job-key:1',
        snapshot: createGenerationJobSnapshot({
            prompt: { positive: 'fixed', negative: '' },
            parameters: {}, outputPolicy: {}, resources: [], resumability: 'resumable',
        }),
    }
}

describe('queue-linked OutputWriter recovery', () => {
    it('retries workflow commit from a pre-bound files-committed journal before lease recovery', async () => {
        const repository = queue()
        await repository.createBatchAndEnqueue({
            batch: {
                id: 'batch:1', workflow: 'main', createdAt: NOW,
                failurePolicy: 'continue', origin: 'fresh', idempotencyKey: 'batch-key:1',
            },
            jobs: [job()],
        })
        const lease = await repository.acquireLease({ jobId: 'job:1', owner: 'worker:1', now: NOW, ttlMs: 1_000 })
        await repository.transitionJob({
            jobId: 'job:1', to: 'running', now: NOW,
            leaseOwner: 'worker:1', leaseToken: lease?.leaseToken ?? '',
        })
        const artifact: QueueArtifactReference = {
            kind: 'output-writer', artifactId: 'artifact:1', digest: 'sha256:artifact', mimeType: 'image/png',
        }
        await repository.bindOutputTransaction({
            jobId: 'job:1', leaseOwner: 'worker:1', leaseToken: lease?.leaseToken ?? '', now: NOW,
            outputTransactionId: 'txn-bound', artifactReference: artifact,
        })

        const recoverTransaction = vi.fn(async (
            _transactionId: string,
            options: Parameters<OutputWriter['recoverTransaction']>[1],
        ) => {
            if (options?.canCommit?.()) {
                await options.commitWorkflow?.({ transactionId: 'txn-bound' } as never)
                return { transactionId: 'txn-bound', action: 'retried' as const }
            }
            return { transactionId: 'txn-bound', action: 'rolled-back' as const }
        })
        const writer = {
            inspectPendingQueueTransactions: async () => [{
                transactionId: 'txn-bound', sourceJobId: 'job:1', phase: 'files-committed' as const,
            }],
            recoverTransaction,
        } as unknown as OutputWriter

        const result = await recoverQueueLinkedOutputs(repository, writer, { now: LATER })

        expect(result).toEqual([{ transactionId: 'txn-bound', action: 'retried' }])
        expect(recoverTransaction).toHaveBeenCalledWith('txn-bound', expect.objectContaining({
            mode: 'retry-workflow',
        }))
        expect(await repository.getJob('job:1')).toMatchObject({
            state: 'succeeded',
            outputTransactionId: 'txn-bound',
            artifactReference: artifact,
            leaseOwner: null,
        })
    })
})
