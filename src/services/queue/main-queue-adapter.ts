import {
    planMainBatch,
    type MainBatchPlannerPort,
} from '@/application/generation/plan-main-batch'
import type {
    GenerationPlan,
    PlanGenerationInput,
    PlanGenerationResult,
    PlanIssue,
} from '@/application/generation/generation-plan-contract'
import {
    hashGenerationSemanticIntent,
    replayGenerationPlan,
    type PlanGenerationDependencies,
} from '@/application/generation/plan-generation'
import {
    assertAnlasCostConsentAllows,
    type AnlasCostConsentSnapshot,
} from '@/domain/queue/anlas-cost-consent'
import {
    CURRENT_MAIN_QUEUE_POLICY,
    type QueueFailurePolicy,
    type QueueResourceRecord,
} from '@/domain/queue/types'
import { calculateAnlasCost } from '@/lib/anlas-calculator'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'
import {
    CURRENT_NAI_PAYLOAD_BUILDER_REVISION,
    queryNaiGenerationCompatibility,
} from '@/services/nai/compatibility'
import {
    getRuntimeQueueRepository,
    type CreateBatchAndEnqueueResult,
    type EnqueueGenerationJobInput,
} from './indexeddb-queue-repository'
import { QueueExecutionError } from './durable-queue-coordinator'
import {
    encodeMainJobSnapshot,
    type MainProviderExecutionReviewContext,
} from './main-job-snapshot-codec'
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

export interface EnqueueReviewedMainPlanOptions {
    readonly reviewed: GenerationPlan<PreparedMainGeneration>
    readonly input: Omit<PlanGenerationInput, 'seedPolicy'>
    readonly dependencies: PlanGenerationDependencies<PreparedMainGeneration>
    readonly submissionPolicy: EnqueuePlannedMainBatchOptions['submissionPolicy']
    /** Defaults to the stable reviewed plan identity for retry-safe Queue writes. */
    readonly idempotencyScope?: string
}

export type EnqueueReviewedMainPlanResult =
    | { readonly status: 'enqueued'; readonly queue: CreateBatchAndEnqueueResult }
    | Exclude<PlanGenerationResult<PreparedMainGeneration>, { readonly status: 'ready' }>

interface EnqueueMainBatchOptions {
    readonly planner: MainBatchPlannerPort<PreparedMainGeneration>
    readonly submissionPolicy:
        | { readonly kind: 'advanced' }
        | EnqueuePlannedMainBatchOptions['submissionPolicy']
    readonly queuePolicy?: {
        readonly failurePolicy: QueueFailurePolicy
        readonly maxAttempts: number
    }
    readonly providerExecutionContexts?: readonly MainProviderExecutionReviewContext[]
    readonly idempotencyScope?: string
}

function estimatePreparedBatchAnlas(
    prepared: readonly PreparedMainGeneration[],
    pricingBasis: AnlasCostConsentSnapshot['pricingBasis'],
): number {
    return prepared.reduce((total, item) => {
        const params = item.params
        return total + calculateAnlasCost({
            model: params.model,
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

/**
 * Revalidates the reviewed plan and its saved seeds before touching presentation,
 * resources, codecs, or Queue storage. The current Queue can select credentials
 * only at execution time, so pinned affinity is rejected until it can be preserved.
 */
export async function enqueueReviewedMainPlan(
    options: EnqueueReviewedMainPlanOptions,
): Promise<EnqueueReviewedMainPlanResult> {
    const replayed = await replayGenerationPlan(
        options.reviewed,
        options.input,
        options.dependencies,
    )
    if (replayed.status !== 'ready') return replayed

    if (replayed.plan.executionPolicy.credentialDispatch.kind === 'pinned') {
        const issue: PlanIssue = Object.freeze({
            code: 'unsupported-pinned-credential-affinity',
            severity: 'blocking',
            fieldPath: 'executionPolicy.credentialDispatch',
            message: 'The current Queue cannot preserve pinned credential affinity.',
        })
        return Object.freeze({
            status: 'unsupported',
            capability: issue.code,
            issues: Object.freeze([issue]),
        })
    }

    const executionPolicy = replayed.plan.executionPolicy
    const unsupportedPolicyIssues: PlanIssue[] = []
    if (executionPolicy.retryPolicyId !== CURRENT_MAIN_QUEUE_POLICY.retryPolicyId) {
        unsupportedPolicyIssues.push(Object.freeze({
            code: 'unsupported-retry-policy',
            severity: 'blocking',
            fieldPath: 'executionPolicy.retryPolicyId',
            message: 'The reviewed retry policy is not implemented by the current Queue.',
        }))
    }
    if (executionPolicy.maxConcurrency !== CURRENT_MAIN_QUEUE_POLICY.maxConcurrency) {
        unsupportedPolicyIssues.push(Object.freeze({
            code: 'unsupported-main-queue-concurrency',
            severity: 'blocking',
            fieldPath: 'executionPolicy.maxConcurrency',
            message: 'The reviewed concurrency limit is not implemented by the current Queue.',
        }))
    }
    if (unsupportedPolicyIssues.length > 0) {
        return Object.freeze({
            status: 'unsupported',
            capability: unsupportedPolicyIssues[0].code,
            issues: Object.freeze(unsupportedPolicyIssues),
        })
    }
    if ((executionPolicy.failurePolicy !== 'continue' && executionPolicy.failurePolicy !== 'stop')
        || !Number.isSafeInteger(executionPolicy.maxAttempts)
        || executionPolicy.maxAttempts < 1) {
        const issue: PlanIssue = Object.freeze({
            code: 'invalid-queue-execution-policy',
            severity: 'blocking',
            fieldPath: 'executionPolicy',
            message: 'The reviewed Queue execution policy is invalid.',
        })
        return Object.freeze({ status: 'invalid', issues: Object.freeze([issue]) })
    }

    const consent = options.submissionPolicy?.kind === 'guided'
        ? options.submissionPolicy.costConsent
        : undefined
    try {
        assertAnlasCostConsentAllows(consent, replayed.plan.estimatedAnlas)
    } catch {
        const issue: PlanIssue = Object.freeze({
            code: 'invalid-anlas-cost-consent',
            severity: 'blocking',
            fieldPath: 'submissionPolicy.costConsent',
            message: 'A current Anlas cost consent matching the reviewed estimate is required.',
        })
        return Object.freeze({ status: 'invalid', issues: Object.freeze([issue]) })
    }
    if (consent.pricingBasis !== executionPolicy.pricingBasis
        || consent.maxAnlas > replayed.plan.budget.maxAnlas) {
        const issue: PlanIssue = Object.freeze({
            code: 'cost-consent-plan-mismatch',
            severity: 'blocking',
            fieldPath: 'submissionPolicy.costConsent',
            message: 'The cost consent does not match the reviewed pricing basis and budget.',
        })
        return Object.freeze({ status: 'invalid', issues: Object.freeze([issue]) })
    }

    if (replayed.plan.jobs.some((job, ordinal) => job.ordinal !== ordinal)) {
        const issue: PlanIssue = Object.freeze({
            code: 'invalid-replayed-job-ordinals',
            severity: 'blocking',
            fieldPath: 'jobs',
            message: 'Replayed job ordinals must be contiguous and ordered before Queue encoding.',
        })
        return Object.freeze({ status: 'invalid', issues: Object.freeze([issue]) })
    }
    const prepared = replayed.plan.jobs.map(job => job.prepared)
    const providerExecutionContexts = replayed.plan.jobs.map(job => ({
        compatibilityProfileId: job.compatibility.compatibilityProfileId,
        semanticIntentHash: hashGenerationSemanticIntent(job.semantic),
    }))
    const queue = await enqueueMainBatch({
        planner: {
            getRequestedCount: () => prepared.length,
            prepareBatch: async () => prepared,
        },
        submissionPolicy: options.submissionPolicy,
        queuePolicy: {
            failurePolicy: executionPolicy.failurePolicy === 'stop'
                ? 'stop-on-first-error'
                : 'continue',
            maxAttempts: executionPolicy.maxAttempts,
        },
        providerExecutionContexts,
        idempotencyScope: options.idempotencyScope ?? replayed.plan.planId,
    })
    if (queue !== null) return { status: 'enqueued', queue }

    return {
        status: 'invalid',
        issues: [{
            code: 'invalid-replayed-job-count',
            severity: 'blocking',
            fieldPath: 'jobs',
            message: 'The replayed plan did not contain a queueable job count.',
        }],
    }
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
                if (options.providerExecutionContexts !== undefined
                    && options.providerExecutionContexts.length !== prepared.length) {
                    throw new QueueExecutionError(
                        'fatal',
                        'Reviewed Provider execution context count does not match the prepared batch',
                    )
                }
                const incompatible = prepared
                    .map(item => queryNaiGenerationCompatibility(
                        item.params,
                        CURRENT_NAI_PAYLOAD_BUILDER_REVISION,
                        item.streaming,
                    ))
                    .find(result => result.status === 'known-divergence' || result.status === 'unsupported')
                if (incompatible !== undefined) {
                    throw new QueueExecutionError(
                        'compatibility',
                        `NovelAI compatibility profile cannot execute: ${incompatible.compatibilityProfileId}`,
                    )
                }
                if (options.submissionPolicy.kind === 'advanced') return
                const consent = options.submissionPolicy.costConsent
                if (consent === undefined || consent === null) {
                    assertAnlasCostConsentAllows(consent, 0)
                }
                const estimatedAnlas = estimatePreparedBatchAnlas(prepared, consent.pricingBasis)
                assertAnlasCostConsentAllows(consent, estimatedAnlas)
                costConsent = consent
            },
            materialize: async (prepared, ordinal) => {
                const dehydrated = await dehydrateGenerationParams(prepared.params, materializer, resourceCache)
                for (const record of dehydrated.records) resources.set(record.id, record)
                const providerExecution = options.providerExecutionContexts?.[ordinal]
                return providerExecution === undefined
                    ? encodeMainJobSnapshot(prepared, dehydrated, costConsent)
                    : encodeMainJobSnapshot(prepared, dehydrated, costConsent, providerExecution)
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
            maxAttempts: options.queuePolicy?.maxAttempts ?? 3,
            idempotencyKey: `main-enqueue-${idempotencyScope}-${ordinal}`,
        }))
        return await getRuntimeQueueRepository().createBatchAndEnqueue({
            batch: {
                id: batchId,
                workflow: 'main',
                createdAt,
                failurePolicy: options.queuePolicy?.failurePolicy ?? 'continue',
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
