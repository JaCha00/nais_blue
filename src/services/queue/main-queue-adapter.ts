import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { FragmentSequenceCommitProposal } from '@/domain/composition/fragment-resolver'
import type { JsonValue, PortablePathRef } from '@/domain/composition/types'
import type { GenerationJob, QueueArtifactReference, QueueResourceRecord } from '@/domain/queue/types'
import { createThumbnail } from '@/lib/image-utils'
import { ensureImageFileExtension } from '@/lib/generation-metadata'
import { reserveWildcardSequenceProposal } from '@/lib/fragment-processor'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'
import { generateImage, generateImageStream } from '@/services/novelai-api'
import { useAuthStore } from '@/stores/auth-store'
import {
    useGenerationStore,
    type CapturedMainGeneration,
} from '@/stores/generation-store'
import { useCharacterStore } from '@/stores/character-store'
import { useQueueStore } from '@/stores/queue-store'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import type { QueueExecutorContext } from './durable-queue-coordinator'
import { QueueExecutionError } from './durable-queue-coordinator'
import {
    getRuntimeQueueRepository,
    type CreateBatchAndEnqueueResult,
    type EnqueueGenerationJobInput,
} from './indexeddb-queue-repository'
import { createGenerationJobSnapshot } from './job-snapshot'
import {
    dehydrateGenerationParams,
    getRuntimeQueueResourceMaterializer,
    hashQueueResourceBytes,
    hydrateGenerationParams,
    type DehydratedGenerationParameters,
    type MaterializedQueueResource,
} from './queue-resource-materializer'

interface MainQueueOutputSnapshot {
    directory: string
    useAbsolutePath: boolean
    capabilityFallbackDirectory: string
    portableDirectory?: PortablePathRef
    fileName: string
    collisionPolicy: 'unique' | 'overwrite' | 'error'
}

interface MainQueueWorkflowSnapshot {
    finalPrompt: string
    imageFormat: 'png' | 'webp'
    metadataMode: CapturedMainGeneration['metadataMode']
    sequenceCommitProposal: FragmentSequenceCommitProposal | null
    output: MainQueueOutputSnapshot
}

interface MainQueueParameters extends DehydratedGenerationParameters {
    queueExecution: { streaming: boolean; sourceEdit: boolean }
    mainWorkflow: MainQueueWorkflowSnapshot
}

function asJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue
}

function parseMainQueueParameters(value: JsonValue): MainQueueParameters {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new QueueExecutionError('fatal', 'Main queue snapshot parameters are invalid')
    }
    const candidate = value as unknown as Partial<MainQueueParameters>
    if (candidate.generationParams === undefined
        || !Array.isArray(candidate.resourceBindings)
        || candidate.resourceArrayLengths === undefined
        || candidate.queueExecution === undefined
        || candidate.mainWorkflow === undefined
        || typeof candidate.mainWorkflow.finalPrompt !== 'string'
        || (candidate.mainWorkflow.imageFormat !== 'png' && candidate.mainWorkflow.imageFormat !== 'webp')
        || typeof candidate.mainWorkflow.output?.directory !== 'string'
        || typeof candidate.mainWorkflow.output?.fileName !== 'string') {
        throw new QueueExecutionError('fatal', 'Main queue snapshot parameters are invalid')
    }
    return candidate as MainQueueParameters
}

let mainEnqueueInFlight: Promise<CreateBatchAndEnqueueResult | null> | null = null

export function enqueueCurrentMainBatch(): Promise<CreateBatchAndEnqueueResult | null> {
    mainEnqueueInFlight ??= enqueueCurrentMainBatchOnce().finally(() => {
        mainEnqueueInFlight = null
    })
    return mainEnqueueInFlight
}

async function enqueueCurrentMainBatchOnce(): Promise<CreateBatchAndEnqueueResult | null> {
    const operationId = useQueueStore.getState().beginEnqueueOperation('main')
    const generation = useGenerationStore.getState()
    const expectedItemCount = generation.batchCount
    const materializer = getRuntimeQueueResourceMaterializer()
    const resourceCache = new Map<string, Promise<MaterializedQueueResource>>()
    const prepared: Array<{
        snapshot: ReturnType<typeof createGenerationJobSnapshot>
        compositionPlanHash: string | null
    }> = []
    const resources = new Map<string, QueueResourceRecord>()

    await generation.generate({
        capturePrepared: async capture => {
            const dehydrated = await dehydrateGenerationParams(capture.params, materializer, resourceCache)
            for (const record of dehydrated.records) resources.set(record.id, record)
            const sourceEdit = Boolean(capture.params.sourceImage || capture.params.mask)
            const fileName = capture.output.fileName ?? ensureImageFileExtension(
                `NAIS_${capture.params.seed}`,
                capture.imageFormat,
            ) ?? `NAIS_${capture.params.seed}.${capture.imageFormat}`
            const parameters: MainQueueParameters = {
                ...dehydrated.parameters,
                queueExecution: { streaming: capture.streaming, sourceEdit },
                mainWorkflow: {
                    finalPrompt: capture.finalPrompt,
                    imageFormat: capture.imageFormat,
                    metadataMode: capture.metadataMode,
                    sequenceCommitProposal: capture.sequenceCommitProposal as FragmentSequenceCommitProposal | null,
                    output: {
                        directory: capture.output.directory || 'NAIS_Output',
                        useAbsolutePath: capture.output.useAbsolutePath,
                        capabilityFallbackDirectory: capture.output.capabilityFallbackDirectory || 'NAIS_Output',
                        ...(capture.output.portableDirectory === undefined
                            ? {}
                            : { portableDirectory: capture.output.portableDirectory }),
                        fileName,
                        collisionPolicy: capture.output.collisionPolicy,
                    },
                },
            }
            const snapshot = createGenerationJobSnapshot({
                prompt: { positive: capture.finalPrompt, negative: capture.params.negative_prompt },
                parameters: asJson(parameters),
                outputPolicy: asJson({
                    workflow: 'main',
                    imageFormat: capture.imageFormat,
                    metadataMode: capture.metadataMode,
                    output: parameters.mainWorkflow.output,
                }),
                resources: dehydrated.resources,
                resumability: 'resumable',
            })
            prepared.push({
                snapshot,
                compositionPlanHash: capture.params.compositionPlanHash === undefined
                    ? null
                    : `sha256:${capture.params.compositionPlanHash.digest}`,
            })
        },
    })
    // Generation reports planner failures through UI diagnostics and resolves.
    // The durable repository therefore requires the exact requested count before
    // its atomic write; partial snapshots are discarded and their unused ID released.
    if (prepared.length !== expectedItemCount || prepared.length === 0) {
        useQueueStore.getState().completeEnqueueOperation('main', operationId)
        return null
    }

    const batchId = `main-batch-${operationId}`
    const createdAt = new Date().toISOString()
    const jobs: EnqueueGenerationJobInput[] = prepared.map((item, ordinal) => ({
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
    useQueueStore.getState().completeEnqueueOperation('main', operationId)
    return result
}

function decodeImageBytes(imageData: string): Uint8Array {
    const encoded = imageData.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(encoded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export async function executeMainQueueJob(job: GenerationJob, context: QueueExecutorContext): Promise<void> {
    const payload = parseMainQueueParameters(job.snapshot.parameters)
    const params = await hydrateGenerationParams(payload, job.snapshot.resources, getRuntimeQueueResourceMaterializer())
    params.sourceJobId = job.id
    // Reserve before transport so a stale immutable snapshot fails without a
    // provider call. Planned Main jobs run in ordinal order and commit their
    // distinct CAS proposals one at a time through this lease.
    const sequenceLease = reserveWildcardSequenceProposal(payload.mainWorkflow.sequenceCommitProposal)
    if (sequenceLease === null) {
        throw new QueueExecutionError('fatal', 'Fragment sequence snapshot is stale before Main transport')
    }
    const generationStore = useGenerationStore.getState()
    generationStore.setGeneratingMode('main')
    generationStore.setIsGenerating(true)
    generationStore.setStreamProgress(0)
    try {
        await context.updateProgress('transport', 0, Math.max(1, params.steps))
        const result = payload.queueExecution.streaming && !payload.queueExecution.sourceEdit
            ? await generateImageStream(context.token, params, (progress, partialImage) => {
                generationStore.setStreamProgress(progress)
                if (partialImage && context.canCommit()) {
                    generationStore.setPreviewImage(`data:image/${payload.mainWorkflow.imageFormat};base64,${partialImage}`)
                }
                void context.updateProgress('stream', Math.min(params.steps, Math.round(params.steps * progress / 100)), params.steps)
            }, context.signal)
            : await generateImage(context.token, params, context.signal)
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
        const output = await getRuntimeOutputWriter().write({
            transactionId,
            sourceJobId: job.id,
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
                useGenerationStore.getState().addToHistory({
                    id: historyId,
                    url: outputResult.thumbnailDataUrl ?? imageDataUrl,
                    prompt: payload.mainWorkflow.finalPrompt,
                    seed: params.seed,
                    timestamp: new Date(),
                    sentPayloadSummary: result.sentPayloadSummary,
                })
                historyCommitted = true
                useGenerationStore.getState().setPreviewImage(imageDataUrl)
                publishGeneratedArtifact({ path: outputResult.path })
                await context.commitOutput(transactionId, artifactReference)
            },
            rollbackWorkflow: () => {
                if (!historyCommitted) return
                useGenerationStore.setState(state => ({
                    history: state.history.filter(item => item.id !== historyId),
                    previewImage: state.previewImage === imageDataUrl ? null : state.previewImage,
                }))
                historyCommitted = false
            },
        }).catch(error => {
            if (sequenceConflict) {
                throw new QueueExecutionError('fatal', 'Fragment sequence changed before Main commit')
            }
            throw error
        })
        if (output.status === 'cancelled') return
        if (result.encodedVibes && result.encodedVibes.length > 0) {
            const { vibeImages, updateVibeImage } = useCharacterStore.getState()
            let encodedIndex = 0
            for (let index = 0; index < vibeImages.length && encodedIndex < result.encodedVibes.length; index += 1) {
                if (!vibeImages[index].encodedVibe) {
                    updateVibeImage(vibeImages[index].id, { encodedVibe: result.encodedVibes[encodedIndex] })
                    encodedIndex += 1
                }
            }
        }
        const slot = context.tokenSlotId === 'slot-2' ? 2 : 1
        void useAuthStore.getState().refreshAnlas(slot)
    } finally {
        sequenceLease.release()
        generationStore.setStreamProgress(0)
        generationStore.setIsGenerating(false)
        generationStore.setGeneratingMode(null)
        useCharacterStore.getState().releaseImageData()
    }
}
