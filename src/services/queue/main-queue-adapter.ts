import {
    planMainBatch,
    type MainBatchPlannerPort,
} from '@/application/generation/plan-main-batch'
import {
    assertAnlasCostConsentAllows,
    type AnlasCostConsentSnapshot,
} from '@/domain/queue/anlas-cost-consent'
import type { QueueResourceRecord } from '@/domain/queue/types'
import { calculateAnlasCost } from '@/lib/anlas-calculator'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'
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

export interface EnqueuePlannedMainBatchOptions {
    readonly planner: MainBatchPlannerPort<PreparedMainGeneration>
    readonly submissionPolicy: { readonly kind: 'guided'; readonly costConsent: AnlasCostConsentSnapshot }
    /** Stable draft/revision scope makes a retried Guided submit idempotent. */
    readonly idempotencyScope?: string
}

interface EnqueueMainBatchOptions {
    readonly planner: MainBatchPlannerPort<PreparedMainGeneration>
    readonly submissionPolicy:
        | { readonly kind: 'advanced' }
        | EnqueuePlannedMainBatchOptions['submissionPolicy']
    readonly idempotencyScope?: string
}

function estimatePreparedBatchAnlas(
    prepared: readonly PreparedMainGeneration[],
    pricingBasis: AnlasCostConsentSnapshot['pricingBasis'],
): number {
    return prepared.reduce((total, item) => {
        const params = item.params
        return total + calculateAnlasCost({
            width: params.width,
            height: params.height,
            steps: params.steps,
            imageCount: 1,
            pricingBasis,
        })
    }, 0)
}

/**
 * Depends on the configured Main Planner, Snapshot Codec, resource materializer,
 * and Queue repository. It serializes concurrent UI requests into one atomic
 * batch enqueue while provider execution remains owned by main-queue-executor.
 */
export function enqueueCurrentMainBatch(): Promise<CreateBatchAndEnqueueResult | null> {
    const dependencies = getRuntimeMainQueueDependencies()
    mainEnqueueInFlight ??= enqueueMainBatch({
        planner: dependencies.planner,
        submissionPolicy: { kind: 'advanced' },
    }).finally(() => {
        mainEnqueueInFlight = null
    })
    return mainEnqueueInFlight
}

/**
 * Shares Main snapshot encoding, resource dehydration, and atomic Queue writes
 * between the expert Zustand planner and detached Guided draft planners.
 */
export async function enqueuePlannedMainBatch(
    options: EnqueuePlannedMainBatchOptions,
): Promise<CreateBatchAndEnqueueResult | null> {
    return enqueueMainBatch(options)
}

async function enqueueMainBatch(
    options: EnqueueMainBatchOptions,
): Promise<CreateBatchAndEnqueueResult | null> {
    const dependencies = getRuntimeMainQueueDependencies()
    const operationId = dependencies.presentation.beginEnqueueOperation()
    const idempotencyScope = options.idempotencyScope ?? operationId
    if (options.submissionPolicy?.kind !== 'advanced' && options.submissionPolicy?.kind !== 'guided') {
        dependencies.presentation.completeEnqueueOperation(operationId)
        throw new TypeError('Main enqueue submission policy is required')
    }
    if (idempotencyScope.length === 0 || idempotencyScope.length > 200) {
        dependencies.presentation.completeEnqueueOperation(operationId)
        throw new TypeError('Main enqueue idempotency scope must contain 1-200 characters')
    }

    try {
        const materializer = getRuntimeQueueResourceMaterializer()
        const resourceCache = new Map<string, Promise<MaterializedQueueResource>>()
        const resources = new Map<string, QueueResourceRecord>()
        let costConsent: AnlasCostConsentSnapshot | undefined
        const plan = await planMainBatch({
            planner: options.planner,
            preflight: prepared => {
                if (options.submissionPolicy.kind === 'advanced') return
                const consent = options.submissionPolicy.costConsent
                if (consent === undefined || consent === null) {
                    assertAnlasCostConsentAllows(consent, 0)
                }
                const estimatedAnlas = estimatePreparedBatchAnlas(prepared, consent.pricingBasis)
                assertAnlasCostConsentAllows(consent, estimatedAnlas)
                costConsent = consent
            },
            materialize: async prepared => {
                const dehydrated = await dehydrateGenerationParams(prepared.params, materializer, resourceCache)
                for (const record of dehydrated.records) resources.set(record.id, record)
                return encodeMainJobSnapshot(prepared, dehydrated, costConsent)
            },
        })
        // The durable repository requires the exact requested count before its
        // atomic write; an invalid/incomplete planner result persists nothing.
        if (plan === null) return null

        const batchId = `main-batch-${idempotencyScope}`
        const createdAt = new Date().toISOString()
        const jobs: EnqueueGenerationJobInput[] = plan.items.map((item, ordinal) => ({
            id: `main-job-${idempotencyScope}-${ordinal}`,
            batchId,
            workflow: 'main',
            sceneId: null,
            createdAt,
            priority: 0,
            ordinal,
            snapshot: item.snapshot,
            compositionPlanHash: item.compositionPlanHash,
            maxAttempts: 3,
            idempotencyKey: `main-enqueue-${idempotencyScope}-${ordinal}`,
        }))
        return await getRuntimeQueueRepository().createBatchAndEnqueue({
            batch: {
                id: batchId,
                workflow: 'main',
                createdAt,
                failurePolicy: 'continue',
                origin: 'fresh',
                idempotencyKey: `main-enqueue-${idempotencyScope}`,
            },
            jobs,
            resources: [...resources.values()],
        })
    } finally {
        dependencies.presentation.completeEnqueueOperation(operationId)
    }
}
