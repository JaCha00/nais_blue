import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { GenerationJob, QueueArtifactReference, QueueResourceRecord } from '@/domain/queue/types'
import type { MainQueuePresentationPort } from '@/application/generation/main-queue-presentation-port'
import {
    planMainBatch,
    type MainBatchPlannerPort,
} from '@/application/generation/plan-main-batch'
import { createThumbnail } from '@/lib/image-utils'
import { reserveWildcardSequenceProposal } from '@/lib/fragment-processor'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'
import { generateImage, generateImageStream } from '@/services/novelai-api'
import type { QueueExecutorContext } from './durable-queue-coordinator'
import { QueueExecutionError } from './durable-queue-coordinator'
import {
    registerQueueArtifact,
    rollbackQueueArtifactRegistration,
    type QueueArtifactRegistration,
} from './queue-artifact-lineage'
import {
    getRuntimeQueueRepository,
    type CreateBatchAndEnqueueResult,
    type EnqueueGenerationJobInput,
} from './indexeddb-queue-repository'
import { decodeMainJobSnapshot, encodeMainJobSnapshot } from './main-job-snapshot-codec'
import { createSerializedProgressReporter } from './serialized-progress-reporter'
import {
    dehydrateGenerationParams,
    getRuntimeQueueResourceMaterializer,
    hashQueueResourceBytes,
    hydrateGenerationParams,
    type MaterializedQueueResource,
} from './queue-resource-materializer'

export interface RuntimeMainQueueDependencies {
    readonly planner: MainBatchPlannerPort<PreparedMainGeneration>
    readonly presentation: MainQueuePresentationPort
}

let runtimeMainQueueDependencies: RuntimeMainQueueDependencies | null = null

/**
 * Composition Root supplies the legacy Planner bridge and Zustand projector.
 * Queue code retains only Application ports, preventing Store dependencies from
 * leaking back while the standalone Main Planner is extracted incrementally.
 */
export function configureRuntimeMainQueueDependencies(
    dependencies: RuntimeMainQueueDependencies,
): void {
    runtimeMainQueueDependencies = dependencies
}

function getRuntimeMainQueueDependencies(): RuntimeMainQueueDependencies {
    if (runtimeMainQueueDependencies === null) {
        throw new Error('Main Queue dependencies are not configured')
    }
    return runtimeMainQueueDependencies
}

export function resetRuntimeMainQueueDependenciesForTests(): void {
    runtimeMainQueueDependencies = null
}

let mainEnqueueInFlight: Promise<CreateBatchAndEnqueueResult | null> | null = null

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

function decodeImageBytes(imageData: string): Uint8Array {
    const encoded = imageData.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(encoded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export async function executeMainQueueJob(job: GenerationJob, context: QueueExecutorContext): Promise<void> {
    const { presentation } = getRuntimeMainQueueDependencies()
    const payload = decodeMainJobSnapshot(job.snapshot)
    const params = await hydrateGenerationParams(payload, job.snapshot.resources, getRuntimeQueueResourceMaterializer())
    params.sourceJobId = job.id
    // Reserve before transport so a stale immutable snapshot fails without a
    // provider call. Planned Main jobs run in ordinal order and commit their
    // distinct CAS proposals one at a time through this lease.
    const sequenceLease = reserveWildcardSequenceProposal(payload.mainWorkflow.sequenceCommitProposal)
    if (sequenceLease === null) {
        throw new QueueExecutionError('fatal', 'Fragment sequence snapshot is stale before Main transport')
    }
    presentation.beginExecution()
    try {
        await context.updateProgress('transport', 0, Math.max(1, params.steps))
        const progressReporter = createSerializedProgressReporter(context.updateProgress)
        const result = payload.queueExecution.streaming && !payload.queueExecution.sourceEdit
            ? await generateImageStream(context.token, params, (progress, partialImage) => {
                const previewImage = partialImage && context.canCommit()
                    ? `data:image/${payload.mainWorkflow.imageFormat};base64,${partialImage}`
                    : undefined
                presentation.reportStreamProgress(progress, previewImage)
                progressReporter.enqueue('stream', Math.min(params.steps, Math.round(params.steps * progress / 100)), params.steps)
            }, context.signal)
            : await generateImage(context.token, params, context.signal)
        await progressReporter.flush()
        if (!result.success || !result.imageData) {
            if (result.termination === 'cancelled') return
            if (result.termination === 'timeout') {
                throw new QueueExecutionError('timeout', 'Main generation reached its bounded timeout')
            }
            throw new QueueExecutionError('decode', 'Main generation returned no decodable image')
        }
        if (!context.canCommit()) return

        const bytes = decodeImageBytes(result.imageData)
        const imageDataUrl = `data:image/${payload.mainWorkflow.imageFormat};base64,${result.imageData.replace(/^data:image\/[^;]+;base64,/, '')}`
        const digest = await hashQueueResourceBytes(bytes)
        const transactionId = `queue-${sha256Utf8(job.id).slice(0, 48)}`
        const artifactReference: QueueArtifactReference = {
            kind: 'output-writer',
            artifactId: `artifact:${job.id}`,
            digest,
            mimeType: `image/${payload.mainWorkflow.imageFormat}`,
        }
        await context.bindOutput(transactionId, artifactReference)
        let historyCommitted = false
        const historyId = `queue-history:${job.id}`
        let sequenceConflict = false
        let artifactRegistration: QueueArtifactRegistration | null = null
        const output = await getRuntimeOutputWriter().write({
            transactionId,
            sourceJobId: job.id,
            includeFinalImageFacts: true,
            destination: {
                ...(payload.mainWorkflow.output.portableDirectory === undefined
                    ? {}
                    : { portableDirectory: payload.mainWorkflow.output.portableDirectory }),
                directory: payload.mainWorkflow.output.directory,
                useAbsolutePath: payload.mainWorkflow.output.useAbsolutePath,
                capabilityFallbackDirectory: payload.mainWorkflow.output.capabilityFallbackDirectory,
                workflowDefaultDirectory: 'NAIS_Output',
                fileName: payload.mainWorkflow.output.fileName,
                extension: payload.mainWorkflow.imageFormat,
                collisionPolicy: payload.mainWorkflow.output.collisionPolicy,
            },
            imageBytes: bytes,
            imageDataUrl,
            terminalWorkflowCommit: true,
            metadata: {
                params: { ...params, sentPayloadSummary: result.sentPayloadSummary, sourceJobId: job.id },
                imageFormat: payload.mainWorkflow.imageFormat,
                metadataMode: payload.mainWorkflow.metadataMode,
                includeWebpCompatibilitySidecar: true,
            },
            generateThumbnail: createThumbnail,
            canCommit: context.canCommit,
            commitWorkflow: async outputResult => {
                if (!context.canCommit()) throw new Error('Durable Main job was cancelled before publication')
                if (!sequenceLease.commit()) {
                    sequenceConflict = true
                    throw new Error('Fragment sequence changed before durable Main output commit')
                }
                artifactRegistration = await registerQueueArtifact(job, artifactReference, outputResult)
                presentation.commitHistory({
                    id: historyId,
                    url: outputResult.thumbnailDataUrl ?? imageDataUrl,
                    prompt: payload.mainWorkflow.finalPrompt,
                    seed: params.seed,
                    timestamp: new Date(),
                    sentPayloadSummary: result.sentPayloadSummary,
                    ...(artifactRegistration === null
                        ? {}
                        : {
                            artifactId: artifactRegistration.record.artifactId,
                            sourceJobId: job.id,
                            ...(job.sceneId === null ? {} : { sourceSceneId: job.sceneId }),
                        }),
                }, imageDataUrl)
                historyCommitted = true
                presentation.publishArtifact({
                    path: outputResult.path,
                    ...(artifactRegistration === null
                        ? {}
                        : {
                            artifactId: artifactRegistration.record.artifactId,
                            sourceJobId: job.id,
                            ...(job.sceneId === null ? {} : { sourceSceneId: job.sceneId }),
                        }),
                })
                await context.commitOutput(transactionId, artifactReference)
            },
            rollbackWorkflow: async () => {
                if (historyCommitted) {
                    presentation.rollbackHistory(historyId, imageDataUrl)
                    historyCommitted = false
                }
                await rollbackQueueArtifactRegistration(artifactRegistration)
                artifactRegistration = null
            },
        }).catch(error => {
            if (sequenceConflict) {
                throw new QueueExecutionError('fatal', 'Fragment sequence changed before Main commit')
            }
            throw error
        })
        if (output.status === 'cancelled') return
        if (result.encodedVibes && result.encodedVibes.length > 0) {
            presentation.updateEncodedVibes(result.encodedVibes)
        }
        const slot = context.tokenSlotId === 'slot-2' ? 2 : 1
        presentation.refreshAnlas(slot)
    } finally {
        sequenceLease.release()
        presentation.finishExecution()
    }
}
