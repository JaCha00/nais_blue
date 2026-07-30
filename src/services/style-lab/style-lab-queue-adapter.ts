import { hashCanonicalValue, sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { JsonValue } from '@/domain/composition/types'
import type { GenerationJob, QueueResourceRecord } from '@/domain/queue/types'
import {
    createStyleRenderBudget,
    isStyleEvaluationContext,
    type StyleEvaluationContext,
    type StyleRenderReservation,
} from '@/domain/style-lab'
import type { StyleLabRepository } from '@/application/style-lab/style-lab-repository'
import { buildStyleLabGenerationParams, formatStyleLabCompositionErrors } from '@/lib/style-lab/build-style-lab-params'
import { useSettingsStore } from '@/stores/settings-store'
import { type StyleCombination, useStyleLabStore } from '@/stores/style-lab-store'
import {
    getRuntimeQueueRepository,
    type CreateBatchAndEnqueueResult,
    type CreateGenerationBatchInput,
    type EnqueueGenerationJobInput,
} from '@/services/queue/indexeddb-queue-repository'
import {
    dehydrateGenerationParams,
    getRuntimeQueueResourceMaterializer,
} from '@/services/queue/queue-resource-materializer'
import { getStyleLabRepository } from './indexeddb-style-lab-repository'
import {
    encodeStyleLabJobSnapshot,
    type StyleLabQueueOutputSnapshot,
} from './style-lab-job-snapshot-codec'

export const DEFAULT_STYLE_LAB_MANUAL_BUDGET_ID = 'style-budget:manual'
export const DEFAULT_STYLE_LAB_MANUAL_BUDGET_LIMIT = 10_000

interface StyleLabQueueRepositoryPort {
    createBatchAndEnqueue(input: {
        batch: CreateGenerationBatchInput
        jobs: readonly EnqueueGenerationJobInput[]
        resources?: readonly QueueResourceRecord[]
    }): Promise<CreateBatchAndEnqueueResult>
    getJob(id: string): Promise<GenerationJob | null>
}

export interface EnqueueStyleLabPreviewResult {
    jobs: GenerationJob[]
    reservations: StyleRenderReservation[]
    rejected: Array<{ comboId: string; seed: number; reason: 'budget-exhausted' }>
}

function normalizedSeed(seed: number): number {
    return Math.trunc(seed) >>> 0
}

/** Shared by enqueue and tests; output policy is part of identity to avoid unsafe reuse. */
export function styleLabRenderIdempotencyKey(input: {
    renderHash: string
    contextId: string
    seed: number
    outputPolicy: unknown
}): string {
    return `style-render-job:${hashCanonicalValue({
        renderHash: input.renderHash,
        contextId: input.contextId,
        seed: normalizedSeed(input.seed),
        outputPolicyHash: hashCanonicalValue(input.outputPolicy),
    })}`
}

function outputSnapshot(combo: StyleCombination, seed: number): StyleLabQueueOutputSnapshot {
    const settings = useSettingsStore.getState()
    const imageFormat = settings.imageFormat === 'webp' ? 'webp' : 'png'
    return {
        directory: settings.styleLabSavePath || 'nais-style',
        useAbsolutePath: settings.useAbsoluteStyleLabPath,
        capabilityFallbackDirectory: 'nais-style',
        fileName: `NAIS_STYLELAB_${sha256Utf8(`${combo.renderHash}:${seed}`).slice(0, 16)}.${imageFormat}`,
        collisionPolicy: 'unique',
        imageFormat,
        metadataMode: settings.metadataMode,
    }
}

async function ensureBudget(
    repository: StyleLabRepository,
    budgetId: string,
    boardId: string | null,
    limit: number,
    now: number,
): Promise<void> {
    if (await repository.getRenderBudget(budgetId) !== null) return
    await repository.putRenderBudget(createStyleRenderBudget({ id: budgetId, boardId, limit, createdAt: now }))
}

/**
 * Planning reads live composition stores once, then materializes every seed as an
 * immutable resumable Queue snapshot. Each render has its own deterministic batch
 * so repeat requests resolve to the same durable job regardless of UI grouping.
 */
export async function enqueueStyleLabPreviewJobs(input: {
    combinations: readonly StyleCombination[]
    context: StyleEvaluationContext
    budgetId?: string
    boardId?: string | null
    budgetLimit?: number
    priority?: number
    now?: number
    styleRepository?: StyleLabRepository
    queueRepository?: StyleLabQueueRepositoryPort
}): Promise<EnqueueStyleLabPreviewResult> {
    if (!isStyleEvaluationContext(input.context)) throw new TypeError('Invalid Style-Lab render context')
    const styleRepository = input.styleRepository ?? getStyleLabRepository()
    const queueRepository = input.queueRepository ?? getRuntimeQueueRepository()
    const budgetId = input.budgetId ?? DEFAULT_STYLE_LAB_MANUAL_BUDGET_ID
    const requestedAt = input.now ?? Date.now()
    await ensureBudget(
        styleRepository,
        budgetId,
        input.boardId ?? null,
        input.budgetLimit ?? DEFAULT_STYLE_LAB_MANUAL_BUDGET_LIMIT,
        requestedAt,
    )
    await styleRepository.putEvaluationContext(input.context)

    const result: EnqueueStyleLabPreviewResult = { jobs: [], reservations: [], rejected: [] }
    const materializer = getRuntimeQueueResourceMaterializer()
    const resourceCache = new Map()
    for (const combo of input.combinations) {
        for (const seed of input.context.seedPack) {
            const built = await buildStyleLabGenerationParams(combo, {
                seed,
                requestId: `style-lab-queue:${combo.id}:${input.context.id}:${seed}`,
            })
            if (!built.success) throw new Error(formatStyleLabCompositionErrors(built.errors))
            if (built.params.model !== input.context.model || built.params.sampler !== input.context.sampler) {
                throw new Error('Style-Lab Queue parameters no longer match the evaluation context')
            }
            const dehydrated = await dehydrateGenerationParams(built.params, materializer, resourceCache)
            const output = outputSnapshot(combo, seed)
            const idempotencyKey = styleLabRenderIdempotencyKey({
                renderHash: combo.renderHash,
                contextId: input.context.id,
                seed,
                outputPolicy: output,
            })
            const reservation = await styleRepository.reserveRenderBudget({
                budgetId,
                units: 1,
                idempotencyKey,
                createdAt: requestedAt,
            })
            if (reservation === null) {
                result.rejected.push({ comboId: combo.id, seed, reason: 'budget-exhausted' })
                continue
            }
            const encoded = encodeStyleLabJobSnapshot({
                combination: combo,
                context: input.context,
                params: built.params,
                prompt: built.prompt,
                seed,
                requestedAt,
                reservationId: reservation.id,
                output,
                planHash: built.plan?.planHash ?? null,
            }, dehydrated)
            const identity = idempotencyKey.slice('style-render-job:'.length)
            const batchId = `style-lab-batch-${identity}`
            const jobId = `style-lab-job-${identity}`
            const createdAt = new Date(requestedAt).toISOString()
            try {
                const queued = await queueRepository.createBatchAndEnqueue({
                    batch: {
                        id: batchId,
                        workflow: 'style-lab',
                        createdAt,
                        failurePolicy: 'continue',
                        origin: 'fresh',
                        idempotencyKey: batchId,
                    },
                    jobs: [{
                        id: jobId,
                        batchId,
                        workflow: 'style-lab',
                        sceneId: null,
                        createdAt,
                        priority: input.priority ?? 0,
                        ordinal: 0,
                        snapshot: encoded.snapshot,
                        compositionPlanHash: encoded.compositionPlanHash,
                        maxAttempts: 3,
                        idempotencyKey,
                    }],
                    resources: dehydrated.records,
                })
                await styleRepository.bindRenderReservationJob(reservation.id, queued.jobs[0].id)
                result.jobs.push(queued.jobs[0])
                result.reservations.push(reservation)
            } catch (error) {
                await styleRepository.settleRenderReservation(reservation.id, 'released', Date.now()).catch(() => undefined)
                throw error
            }
        }
    }
    return result
}

/** Terminal Queue state is authoritative when reclaiming reservations after a crash. */
export async function reconcileStyleLabRenderReservations(input: {
    styleRepository?: StyleLabRepository
    queueRepository?: Pick<StyleLabQueueRepositoryPort, 'getJob'>
    now?: number
} = {}): Promise<{ spent: number; released: number }> {
    const styleRepository = input.styleRepository ?? getStyleLabRepository()
    const queueRepository = input.queueRepository ?? getRuntimeQueueRepository()
    const reservations = await styleRepository.listRenderReservations('reserved')
    const result = { spent: 0, released: 0 }
    for (const reservation of reservations) {
        if (reservation.jobId === null) continue
        const job = await queueRepository.getJob(reservation.jobId)
        if (job?.state === 'succeeded') {
            await styleRepository.settleRenderReservation(reservation.id, 'spent', input.now ?? Date.now())
            result.spent += reservation.units
        } else if (job === null
            || job.state === 'failed'
            || job.state === 'cancelled'
            || job.state === 'skipped') {
            await styleRepository.settleRenderReservation(reservation.id, 'released', input.now ?? Date.now())
            result.released += reservation.units
            const parameters = job?.snapshot?.parameters
            if (typeof parameters === 'object' && parameters !== null && !Array.isArray(parameters)) {
                const workflow = (parameters as Record<string, JsonValue>).styleLabWorkflow
                if (typeof workflow === 'object' && workflow !== null && !Array.isArray(workflow)
                    && typeof workflow.comboId === 'string') {
                    useStyleLabStore.getState().updateCombinationPreview(workflow.comboId, {
                        isPreviewing: false,
                        previewProgress: 0,
                    })
                }
            }
        }
    }
    return result
}
