import { planMainBatch } from '@/application/generation/plan-main-batch'
import type { QueueResourceRecord } from '@/domain/queue/types'
import {
    getRuntimeQueueRepository,
    type CreateBatchAndEnqueueResult,
    type EnqueueGenerationJobInput,
} from './indexeddb-queue-repository'
import { encodeMainJobSnapshot } from './main-job-snapshot-codec'
import { getRuntimeMainQueueDependencies } from './main-queue-runtime-dependencies'
import {
    dehydrateGenerationParams,
    getRuntimeQueueResourceMaterializer,
    type MaterializedQueueResource,
} from './queue-resource-materializer'

let mainEnqueueInFlight: Promise<CreateBatchAndEnqueueResult | null> | null = null

/**
 * Depends on the configured Main Planner, Snapshot Codec, resource materializer,
 * and Queue repository. It serializes concurrent UI requests into one atomic
 * batch enqueue while provider execution remains owned by main-queue-executor.
 */
export function enqueueCurrentMainBatch(): Promise<CreateBatchAndEnqueueResult | null> {
    mainEnqueueInFlight ??= enqueueCurrentMainBatchOnce().finally(() => {
        mainEnqueueInFlight = null
    })
    return mainEnqueueInFlight
}

async function enqueueCurrentMainBatchOnce(): Promise<CreateBatchAndEnqueueResult | null> {
    const dependencies = getRuntimeMainQueueDependencies()
    const operationId = dependencies.presentation.beginEnqueueOperation()
    const materializer = getRuntimeQueueResourceMaterializer()
    const resourceCache = new Map<string, Promise<MaterializedQueueResource>>()
    const resources = new Map<string, QueueResourceRecord>()

    const plan = await planMainBatch({
        planner: dependencies.planner,
        materialize: async prepared => {
            const dehydrated = await dehydrateGenerationParams(prepared.params, materializer, resourceCache)
            for (const record of dehydrated.records) resources.set(record.id, record)
            return encodeMainJobSnapshot(prepared, dehydrated)
        },
    })
    // Generation reports planner failures through UI diagnostics and resolves.
    // The durable repository therefore requires the exact requested count before
    // its atomic write; partial snapshots are discarded and their unused ID released.
    if (plan === null) {
        dependencies.presentation.completeEnqueueOperation(operationId)
        return null
    }

    const batchId = `main-batch-${operationId}`
    const createdAt = new Date().toISOString()
    const jobs: EnqueueGenerationJobInput[] = plan.items.map((item, ordinal) => ({
        id: `main-job-${operationId}-${ordinal}`,
        batchId,
        workflow: 'main',
        sceneId: null,
        createdAt,
        priority: 0,
        ordinal,
        snapshot: item.snapshot,
        compositionPlanHash: item.compositionPlanHash,
        maxAttempts: 3,
        idempotencyKey: `main-enqueue-${operationId}-${ordinal}`,
    }))
    const result = await getRuntimeQueueRepository().createBatchAndEnqueue({
        batch: {
            id: batchId,
            workflow: 'main',
            createdAt,
            failurePolicy: 'continue',
            origin: 'fresh',
            idempotencyKey: `main-enqueue-${operationId}`,
        },
        jobs,
        resources: [...resources.values()],
    })
    dependencies.presentation.completeEnqueueOperation(operationId)
    return result
}
