import { enqueueGeneration } from '@/application/generation/enqueue-generation-plan'
import type {
    EnqueueGenerationPort,
    EnqueueGenerationResult,
} from '@/application/generation/generation-command-contract'
import type {
    PlanGenerationInput,
    PlanGenerationResult,
    PlanIssue,
    Sha256Digest,
} from '@/application/generation/generation-plan-contract'
import {
    planGeneration,
    type PlanGenerationDependencies,
} from '@/application/generation/plan-generation'
import {
    createAnlasCostConsentSnapshot,
    type AnlasPricingBasis,
} from '@/domain/queue/anlas-cost-consent'
import { CURRENT_MAIN_QUEUE_POLICY } from '@/domain/queue/types'
import { calculateAnlasCost } from '@/lib/anlas-calculator'
import {
    createDetachedMainGenerationCapture,
} from '@/services/generation/main-generation-capture'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'
import {
    CURRENT_NAI_PAYLOAD_BUILDER_REVISION,
    queryNaiGenerationCompatibility,
} from '@/services/nai/compatibility'
import { enqueueReviewedMainPlan } from '@/services/queue/main-queue-adapter'
import type { OutputReservationFolderBinding } from '@/domain/queue/types'

export type MainApplicationGenerationCommandResult =
    | EnqueueGenerationResult<PreparedMainGeneration>
    | Extract<PlanGenerationResult<PreparedMainGeneration>, { readonly status: 'needs_input' }>

export interface EnqueuePreparedMainGenerationInput {
    readonly prepared: readonly PreparedMainGeneration[]
    readonly captureId: string
    readonly idempotencyKey: string
    readonly pricingBasis: AnlasPricingBasis
    readonly approvedAt: string
    readonly credentialReadinessFingerprint: Sha256Digest
    readonly folderBinding: OutputReservationFolderBinding
}

function issue(code: string, fieldPath: string, message: string): PlanIssue {
    return Object.freeze({ code, severity: 'blocking', fieldPath, message })
}

function unsupportedLocalOutput(prepared: readonly PreparedMainGeneration[]): PlanIssue | null {
    if (prepared.some(job => job.output.collisionPolicy === 'overwrite')) {
        return issue('unsupported-collision-policy', 'jobs.output.collisionPolicy', 'Overwrite plans are not supported.')
    }
    if (prepared.some(job => (
        job.output.autoR2UploadProfileId !== null
        || job.output.r2Bucket !== null
        || job.output.r2Prefix !== null
        || job.output.deleteOriginalAfterRelease
    ))) {
        return issue('unsupported-r2-delivery', 'jobs.output', 'R2 delivery and original deletion are not supported in this phase.')
    }
    return null
}

function dependencies(pricingBasis: AnlasPricingBasis): PlanGenerationDependencies<PreparedMainGeneration> {
    const value: PlanGenerationDependencies<PreparedMainGeneration> = {
        // Detached planning never calls these legacy source ports. Keeping them
        // explicit makes an accidental regression fail closed.
        drafts: { get: async () => { throw new Error('Detached Main planning read a Workflow Draft.') } },
        planner: { prepare: async () => { throw new Error('Detached Main planning invoked a live planner.') } },
        executionPolicy: {
            failurePolicy: 'continue',
            retryPolicyId: CURRENT_MAIN_QUEUE_POLICY.retryPolicyId,
            maxAttempts: 3,
            maxConcurrency: CURRENT_MAIN_QUEUE_POLICY.maxConcurrency,
            pricingBasis,
        },
        estimateAnlas: job => calculateAnlasCost({
            model: job.semantic.model,
            width: job.semantic.width,
            height: job.semantic.height,
            steps: job.semantic.steps,
            imageCount: 1,
            pricingBasis,
        }),
        resolveCompatibility: job => {
            const profile = queryNaiGenerationCompatibility(
                job.prepared.params,
                CURRENT_NAI_PAYLOAD_BUILDER_REVISION,
                job.prepared.streaming,
            )
            return {
                compatibilityProfileId: profile.compatibilityProfileId,
                status: profile.status,
            }
        },
    }
    return Object.freeze(value)
}

/** Executes the reviewed Main vertical slice without reading live UI state. */
export async function enqueuePreparedMainGeneration(
    input: EnqueuePreparedMainGenerationInput,
): Promise<MainApplicationGenerationCommandResult> {
    const firstPrepared = input.prepared[0]
    if (firstPrepared === undefined) {
        return Object.freeze({
            status: 'invalid',
            issues: Object.freeze([issue('empty-main-capture', 'prepared', 'At least one prepared Main job is required.')]),
        })
    }
    const unsupported = unsupportedLocalOutput(input.prepared)
    if (unsupported !== null) {
        return Object.freeze({ status: 'unsupported', capability: unsupported.code, issues: Object.freeze([unsupported]) })
    }
    const metadataModes = new Set(input.prepared.map(job => job.metadataMode))
    if (metadataModes.size !== 1) {
        return Object.freeze({
            status: 'invalid',
            issues: Object.freeze([issue('mixed-metadata-mode', 'prepared', 'One Main batch must use one metadata mode.')]),
        })
    }

    const replan = dependencies(input.pricingBasis)
    const estimatedAnlas = input.prepared.reduce((sum, prepared) => sum + calculateAnlasCost({
        model: prepared.params.model,
        width: prepared.params.width,
        height: prepared.params.height,
        steps: prepared.params.steps,
        imageCount: 1,
        pricingBasis: input.pricingBasis,
    }), 0)
    const capture = createDetachedMainGenerationCapture({
        captureId: input.captureId,
        prepared: input.prepared,
        materializedSeeds: input.prepared.map(job => job.params.seed),
        sourceBindings: [input.folderBinding],
        executionPolicy: {
            failurePolicy: 'continue',
            retryPolicyId: CURRENT_MAIN_QUEUE_POLICY.retryPolicyId,
            maxAttempts: 3,
            maxConcurrency: CURRENT_MAIN_QUEUE_POLICY.maxConcurrency,
            credentialDispatch: { kind: 'auto' },
            pricingBasis: input.pricingBasis,
            metadataMode: firstPrepared.metadataMode,
        },
        credentialReadinessFingerprint: input.credentialReadinessFingerprint,
    })
    const planInput: PlanGenerationInput<PreparedMainGeneration> = {
        source: { kind: 'detached-generation-capture', capture },
        count: capture.jobs.length,
        seedPolicy: { kind: 'replay', traceId: capture.captureId },
        budget: { maxImages: capture.jobs.length, maxAnlas: estimatedAnlas },
    }
    const planned = await planGeneration(planInput, replan)
    if (planned.status !== 'ready') return planned

    const costConsent = createAnlasCostConsentSnapshot({
        pricingBasis: input.pricingBasis,
        estimatedAnlas: planned.plan.estimatedAnlas,
        maxAnlas: estimatedAnlas,
        estimatedAt: input.approvedAt,
        approvedAt: input.approvedAt,
    })
    const enqueuePort: EnqueueGenerationPort<PreparedMainGeneration> = {
        enqueue: async request => {
            const result = await enqueueReviewedMainPlan({
                reviewed: request.plan,
                input: {
                    source: planInput.source,
                    count: planInput.count,
                    budget: planInput.budget,
                },
                dependencies: replan,
                submissionPolicy: { kind: 'reviewed', costConsent: request.costConsent },
                idempotencyScope: request.idempotencyKey,
            })
            if (result.status === 'needs_input') {
                return Object.freeze({
                    status: 'invalid' as const,
                    issues: Object.freeze([issue(
                        'generation-plan-needs-input',
                        'reviewedPlan.requiredApprovals',
                        'The reviewed plan still requires approval input.',
                    )]),
                })
            }
            if (result.status !== 'enqueued') return result
            return Object.freeze({
                status: 'ready' as const,
                batchId: result.queue.batch.id,
                jobs: Object.freeze(result.queue.jobs.map(job => ({ id: job.id, ordinal: job.ordinal }))),
            })
        },
    }
    return enqueueGeneration<PreparedMainGeneration>({
        reviewedPlan: planned.plan,
        costConsent,
        idempotencyKey: input.idempotencyKey,
        actor: { kind: 'user', id: 'main-ui:user' },
        replanInput: {
            source: planInput.source,
            count: planInput.count,
            budget: planInput.budget,
        },
    }, { replan, enqueue: enqueuePort })
}
