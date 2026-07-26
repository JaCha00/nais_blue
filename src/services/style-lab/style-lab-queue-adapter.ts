import { hashCanonicalValue, sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { JsonValue, PortablePathRef } from '@/domain/composition/types'
import type { GenerationJob, QueueArtifactReference, QueueResourceRecord } from '@/domain/queue/types'
import {
    createStylePreviewAsset,
    createStyleRenderBudget,
    isStyleEvaluationContext,
    styleCombinationIdentity,
    type StyleEvaluationContext,
    type StyleRenderReservation,
} from '@/domain/style-lab'
import type { StyleLabRepository } from '@/application/style-lab/style-lab-repository'
import { buildStyleLabGenerationParams, formatStyleLabCompositionErrors } from '@/lib/style-lab/build-style-lab-params'
import { createThumbnail } from '@/lib/image-utils'
import type { MetadataMode } from '@/lib/generation-metadata'
import { generateImage } from '@/services/novelai-api'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { type StyleCombination, useStyleLabStore } from '@/stores/style-lab-store'
import type { QueueExecutorContext } from '@/services/queue/durable-queue-coordinator'
import { QueueExecutionError } from '@/services/queue/durable-queue-coordinator'
import {
    getRuntimeQueueRepository,
    type CreateBatchAndEnqueueResult,
    type CreateGenerationBatchInput,
    type EnqueueGenerationJobInput,
} from '@/services/queue/indexeddb-queue-repository'
import { createGenerationJobSnapshot } from '@/services/queue/job-snapshot'
import {
    dehydrateGenerationParams,
    getRuntimeQueueResourceMaterializer,
    hashQueueResourceBytes,
    hydrateGenerationParams,
    type DehydratedGenerationParameters,
} from '@/services/queue/queue-resource-materializer'
import { getStyleLabRepository } from './indexeddb-style-lab-repository'
import { getStyleLabVault, type StyleLabVault } from './style-lab-vault'

export const DEFAULT_STYLE_LAB_MANUAL_BUDGET_ID = 'style-budget:manual'
export const DEFAULT_STYLE_LAB_MANUAL_BUDGET_LIMIT = 10_000

interface StyleLabQueueOutputSnapshot {
    directory: string
    useAbsolutePath: boolean
    capabilityFallbackDirectory: string
    portableDirectory?: PortablePathRef
    fileName: string
    collisionPolicy: 'unique' | 'overwrite' | 'error'
    imageFormat: 'png' | 'webp'
    metadataMode: MetadataMode
}

interface StyleLabQueueWorkflowSnapshot {
    comboId: string
    tags: StyleCombination['tags']
    semanticHash: string
    renderHash: string
    generation: number
    context: StyleEvaluationContext
    seed: number
    requestedAt: number
    reservationId: string
    output: StyleLabQueueOutputSnapshot
}

interface StyleLabQueueParameters extends DehydratedGenerationParameters {
    queueExecution: { streaming: false; sourceEdit: boolean }
    styleLabWorkflow: StyleLabQueueWorkflowSnapshot
}

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

function asJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue
}

function decodeImageBytes(imageData: string): Uint8Array {
    const encoded = imageData.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(encoded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
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

function parseStyleLabQueueParameters(value: JsonValue): StyleLabQueueParameters {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new QueueExecutionError('fatal', 'Style-Lab queue snapshot parameters are invalid')
    }
    const candidate = value as unknown as Partial<StyleLabQueueParameters>
    const workflow = candidate.styleLabWorkflow
    if (candidate.generationParams === undefined
        || !Array.isArray(candidate.resourceBindings)
        || candidate.resourceArrayLengths === undefined
        || workflow === undefined
        || typeof workflow.comboId !== 'string'
        || typeof workflow.renderHash !== 'string'
        || !Array.isArray(workflow.tags)
        || !isStyleEvaluationContext(workflow.context)
        || !Number.isSafeInteger(workflow.seed)
        || typeof workflow.reservationId !== 'string'
        || (workflow.output?.imageFormat !== 'png' && workflow.output?.imageFormat !== 'webp')
        || typeof workflow.output.fileName !== 'string') {
        throw new QueueExecutionError('fatal', 'Style-Lab queue snapshot parameters are invalid')
    }
    if (styleCombinationIdentity(workflow.tags).renderHash !== workflow.renderHash
        || !workflow.context.seedPack.includes(workflow.seed)) {
        throw new QueueExecutionError('fatal', 'Style-Lab queue snapshot identity is inconsistent')
    }
    return candidate as StyleLabQueueParameters
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
            const parameters: StyleLabQueueParameters = {
                ...dehydrated.parameters,
                queueExecution: { streaming: false, sourceEdit: Boolean(built.params.sourceImage || built.params.mask) },
                styleLabWorkflow: {
                    comboId: combo.id,
                    tags: combo.tags,
                    semanticHash: combo.semanticHash,
                    renderHash: combo.renderHash,
                    generation: combo.generation,
                    context: input.context,
                    seed,
                    requestedAt,
                    reservationId: reservation.id,
                    output,
                },
            }
            const snapshot = createGenerationJobSnapshot({
                prompt: { positive: built.prompt, negative: built.params.negative_prompt },
                parameters: asJson(parameters),
                outputPolicy: asJson({ workflow: 'style-lab', ...output }),
                resources: dehydrated.resources,
                resumability: 'resumable',
            })
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
                        snapshot,
                        compositionPlanHash: built.plan === null ? null : `sha256:${built.plan.planHash}`,
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

export async function executeStyleLabQueueJob(
    job: GenerationJob,
    context: QueueExecutorContext,
    dependencies: {
        repository?: StyleLabRepository
        vault?: StyleLabVault
    } = {},
): Promise<void> {
    const payload = parseStyleLabQueueParameters(job.snapshot.parameters)
    const workflow = payload.styleLabWorkflow
    const repository = dependencies.repository ?? getStyleLabRepository()
    const vault = dependencies.vault ?? getStyleLabVault()
    const params = await hydrateGenerationParams(
        payload,
        job.snapshot.resources,
        getRuntimeQueueResourceMaterializer(),
    )
    params.sourceJobId = job.id
    useStyleLabStore.getState().updateCombinationPreview(workflow.comboId, {
        isPreviewing: true, previewProgress: 0, previewError: undefined,
    })
    await context.updateProgress('transport', 0, Math.max(1, params.steps))
    const generated = await generateImage(context.token, params, context.signal)
    if (!generated.success || !generated.imageData) {
        if (generated.termination === 'cancelled') return
        if (generated.termination === 'timeout') throw new QueueExecutionError('timeout', 'Style-Lab render timed out')
        throw new QueueExecutionError('decode', 'Style-Lab generation returned no decodable image')
    }
    if (!context.canCommit()) return

    const bytes = decodeImageBytes(generated.imageData)
    const digest = await hashQueueResourceBytes(bytes)
    const imageDataUrl = `data:image/${workflow.output.imageFormat};base64,${generated.imageData.replace(/^data:image\/[^;]+;base64,/, '')}`
    const transactionId = `queue-${sha256Utf8(job.id).slice(0, 48)}`
    const artifactReference: QueueArtifactReference = {
        kind: 'output-writer',
        artifactId: `artifact:${job.id}`,
        digest,
        mimeType: `image/${workflow.output.imageFormat}`,
    }
    await context.bindOutput(transactionId, artifactReference)
    const output = await getRuntimeOutputWriter().write({
        transactionId,
        sourceJobId: job.id,
        includeFinalImageFacts: true,
        destination: {
            ...(workflow.output.portableDirectory === undefined ? {} : { portableDirectory: workflow.output.portableDirectory }),
            directory: workflow.output.directory,
            useAbsolutePath: workflow.output.useAbsolutePath,
            capabilityFallbackDirectory: workflow.output.capabilityFallbackDirectory,
            workflowDefaultDirectory: 'nais-style',
            fileName: workflow.output.fileName,
            extension: workflow.output.imageFormat,
            collisionPolicy: workflow.output.collisionPolicy,
        },
        imageBytes: bytes,
        imageDataUrl,
        terminalWorkflowCommit: true,
        metadata: {
            params: { ...params, sentPayloadSummary: generated.sentPayloadSummary, sourceJobId: job.id },
            imageFormat: workflow.output.imageFormat,
            metadataMode: workflow.output.metadataMode,
            includeWebpCompatibilitySidecar: true,
        },
        generateThumbnail: createThumbnail,
        canCommit: context.canCommit,
        commitWorkflow: async outputResult => {
            if (!context.canCommit()) throw new Error('Style-Lab Queue job was cancelled before publication')
            const vaultRecord = await vault.putOriginal(bytes, `image/${workflow.output.imageFormat}`)
            if (vaultRecord.sha256 !== digest) throw new Error('Style-Lab Queue output changed before Vault commit')
            const asset = createStylePreviewAsset({
                comboId: workflow.comboId,
                sha256: digest,
                mimeType: vaultRecord.mimeType,
                byteSize: bytes.byteLength,
                source: 'generated',
                vaultRef: vaultRecord.vaultRef,
                thumbnail: outputResult.thumbnailDataUrl,
                contextId: workflow.context.id,
                seed: workflow.seed,
                verificationState: 'context-verified',
                rawMetadata: null,
                normalizedMetadata: asJson({
                    model: params.model,
                    sampler: params.sampler,
                    seed: workflow.seed,
                    promptHash: workflow.context.promptHash,
                    renderHash: workflow.renderHash,
                    sourceJobId: job.id,
                }),
                createdAt: workflow.requestedAt,
            })
            await repository.putPreviewAsset(asset)
            useStyleLabStore.getState().updateCombinationPreview(workflow.comboId, {
                previewImage: undefined,
                previewPath: outputResult.path,
                previewThumbnail: outputResult.thumbnailDataUrl,
                previewSeed: workflow.seed,
                previewPrompt: job.snapshot.prompt.positive,
                previewContextId: workflow.context.id,
                previewProgress: 1,
                isPreviewing: false,
            })
            useGenerationStore.getState().addToHistory({
                id: `queue-history:${job.id}`,
                url: outputResult.thumbnailDataUrl ?? outputResult.path,
                thumbnail: outputResult.thumbnailDataUrl,
                prompt: job.snapshot.prompt.positive,
                seed: workflow.seed,
                timestamp: new Date(workflow.requestedAt),
                sentPayloadSummary: generated.sentPayloadSummary,
                sourceJobId: job.id,
            })
            publishGeneratedArtifact({ path: outputResult.path, sourceJobId: job.id })
            await repository.settleRenderReservation(workflow.reservationId, 'spent', Date.now())
            await context.commitOutput(transactionId, artifactReference)
        },
        rollbackWorkflow: () => {
            useGenerationStore.setState(state => ({
                history: state.history.filter(item => item.id !== `queue-history:${job.id}`),
            }))
            useStyleLabStore.getState().updateCombinationPreview(workflow.comboId, {
                isPreviewing: false,
                previewProgress: 0,
            })
        },
    })
    if (output.status === 'cancelled') {
        useStyleLabStore.getState().updateCombinationPreview(workflow.comboId, {
            isPreviewing: false, previewProgress: 0,
        })
    }
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
