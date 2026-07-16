import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { FragmentSequenceCommitProposal } from '@/domain/composition/fragment-resolver'
import type { JsonValue } from '@/domain/composition/types'
import type { GenerationJob, QueueArtifactReference, QueueResourceRecord } from '@/domain/queue/types'
import { buildSceneGenerationParams } from '@/lib/scene-generation/build-scene-params'
import { reserveSceneFragmentSequenceProposal } from '@/lib/scene-generation/fragment-runtime'
import {
    saveSceneResult,
    type SaveSceneResultContext,
    type SaveSceneResultOptions,
} from '@/lib/scene-generation/save-scene-result'
import { getRotationCharacterFolderName } from '@/lib/scene-output-path'
import { generateImage, generateImageStream } from '@/services/novelai-api'
import { useCharacterStore } from '@/stores/character-store'
import { useQueueStore } from '@/stores/queue-store'
import { useRotationStore } from '@/stores/character-rotation-store'
import { useSceneStore } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
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

interface SceneQueueWorkflowSnapshot {
    scene: { id: string; name: string }
    finalPrompt: string
    mimeType: string
    saveContext: SaveSceneResultContext
    outputContext: NonNullable<SaveSceneResultOptions['outputContext']>
    sequenceCommitProposal: FragmentSequenceCommitProposal | null
}

interface SceneQueueParameters extends DehydratedGenerationParameters {
    queueExecution: { streaming: boolean; sourceEdit: boolean }
    sceneWorkflow: SceneQueueWorkflowSnapshot
}

function asJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue
}

function parseSceneQueueParameters(value: JsonValue): SceneQueueParameters {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new QueueExecutionError('fatal', 'Scene queue snapshot parameters are invalid')
    }
    const candidate = value as unknown as Partial<SceneQueueParameters>
    if (candidate.generationParams === undefined
        || !Array.isArray(candidate.resourceBindings)
        || candidate.resourceArrayLengths === undefined
        || candidate.queueExecution === undefined
        || candidate.sceneWorkflow === undefined
        || typeof candidate.sceneWorkflow.scene?.id !== 'string'
        || typeof candidate.sceneWorkflow.scene?.name !== 'string'
        || typeof candidate.sceneWorkflow.finalPrompt !== 'string'
        || typeof candidate.sceneWorkflow.mimeType !== 'string') {
        throw new QueueExecutionError('fatal', 'Scene queue snapshot parameters are invalid')
    }
    return candidate as SceneQueueParameters
}

let sceneEnqueueInFlight: Promise<CreateBatchAndEnqueueResult | null> | null = null

export function enqueueCurrentSceneQueue(): Promise<CreateBatchAndEnqueueResult | null> {
    sceneEnqueueInFlight ??= enqueueCurrentSceneQueueOnce().finally(() => {
        sceneEnqueueInFlight = null
    })
    return sceneEnqueueInFlight
}

async function enqueueCurrentSceneQueueOnce(): Promise<CreateBatchAndEnqueueResult | null> {
    const sceneState = useSceneStore.getState()
    const presetId = sceneState.activePresetId
    const preset = sceneState.presets.find(candidate => candidate.id === presetId)
    if (presetId === null || preset === undefined) return null
    const queuedScenes = sceneState.getQueuedScenes(presetId)
    if (queuedScenes.length === 0) return null
    const operationId = useQueueStore.getState().beginEnqueueOperation('scene')

    const settings = useSettingsStore.getState()
    const rotation = useRotationStore.getState()
    const rotationCharacterId = rotation.active && rotation.snapshot
        ? rotation.characterIds[rotation.currentIndex]
        : undefined
    const saveContext: SaveSceneResultContext = {
        activePresetId: presetId,
        sceneSavePath: settings.sceneSavePath,
        ...(rotationCharacterId === undefined ? {} : { rotationCharacterId }),
        ...(rotationCharacterId === undefined
            ? {}
            : {
                rotationCharacterFolderName: getRotationCharacterFolderName(
                    rotationCharacterId,
                    rotation.currentIndex,
                ) ?? undefined,
            }),
    }
    const outputContext: SceneQueueWorkflowSnapshot['outputContext'] = {
        useAbsoluteScenePath: settings.useAbsoluteScenePath,
        metadataMode: settings.metadataMode,
        presetName: preset.name || 'Default',
        sceneName: '',
    }
    const materializer = getRuntimeQueueResourceMaterializer()
    const resourceCache = new Map<string, Promise<MaterializedQueueResource>>()
    const resources = new Map<string, QueueResourceRecord>()
    const prepared: Array<{
        sceneId: string
        snapshot: ReturnType<typeof createGenerationJobSnapshot>
        compositionPlanHash: string | null
    }> = []

    try {
        for (const scene of queuedScenes) {
            for (let count = 0; count < scene.queueCount; count += 1) {
                const built = await buildSceneGenerationParams(scene, {
                    requestId: `durable-enqueue:${scene.id}:${count}`,
                    now: new Date(),
                })
                sceneState.recordSceneCompositionResult(scene.id, {
                    mode: built.mode,
                    ...(built.planHash === null ? {} : { planHash: built.planHash }),
                    warnings: built.warnings,
                    errors: built.errors,
                })
                if (!built.success) {
                    throw new QueueExecutionError('fatal', 'Scene composition plan is invalid')
                }
                const dehydrated = await dehydrateGenerationParams(built.params, materializer, resourceCache)
                for (const record of dehydrated.records) resources.set(record.id, record)
                const parameters: SceneQueueParameters = {
                    ...dehydrated.parameters,
                    queueExecution: {
                        streaming: settings.useStreaming,
                        sourceEdit: Boolean(built.params.sourceImage || built.params.mask),
                    },
                    sceneWorkflow: {
                        scene: { id: scene.id, name: scene.name },
                        finalPrompt: built.finalPrompt,
                        mimeType: built.mimeType,
                        saveContext,
                        outputContext: { ...outputContext, sceneName: scene.name },
                        sequenceCommitProposal: built.sequenceCommitProposal as FragmentSequenceCommitProposal | null,
                    },
                }
                const snapshot = createGenerationJobSnapshot({
                    prompt: { positive: built.finalPrompt, negative: built.params.negative_prompt },
                    parameters: asJson(parameters),
                    outputPolicy: asJson({
                        workflow: 'scene',
                        saveContext,
                        outputContext: { ...outputContext, sceneName: scene.name },
                    }),
                    resources: dehydrated.resources,
                    resumability: 'resumable',
                })
                prepared.push({
                    sceneId: scene.id,
                    snapshot,
                    compositionPlanHash: built.planHash === null ? null : `sha256:${built.planHash.digest}`,
                })
            }
        }
    } finally {
        useCharacterStore.getState().releaseImageData()
    }

    const batchId = `scene-batch-${operationId}`
    const createdAt = new Date().toISOString()
    const jobs: EnqueueGenerationJobInput[] = prepared.map((item, ordinal) => ({
        id: `scene-job-${operationId}-${ordinal}`,
        batchId,
        workflow: 'scene',
        sceneId: item.sceneId,
        createdAt,
        priority: 0,
        ordinal,
        snapshot: item.snapshot,
        compositionPlanHash: item.compositionPlanHash,
        maxAttempts: 3,
        idempotencyKey: `scene-enqueue-${operationId}-${ordinal}`,
    }))
    const result = await getRuntimeQueueRepository().createBatchAndEnqueue({
        batch: {
            id: batchId,
            workflow: 'scene',
            createdAt,
            failurePolicy: 'continue',
            origin: 'legacy-conversion',
            idempotencyKey: `scene-enqueue-${operationId}`,
        },
        jobs,
        resources: [...resources.values()],
    })
    useQueueStore.getState().completeEnqueueOperation('scene', operationId)
    return result
}

function decodeImageBytes(imageData: string): Uint8Array {
    const encoded = imageData.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(encoded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export async function executeSceneQueueJob(
    job: GenerationJob,
    context: QueueExecutorContext,
): Promise<void> {
    const payload = parseSceneQueueParameters(job.snapshot.parameters)
    const params = await hydrateGenerationParams(payload, job.snapshot.resources, getRuntimeQueueResourceMaterializer())
    params.sourceJobId = job.id
    await context.updateProgress('transport', 0, Math.max(1, params.steps))
    const result = payload.queueExecution.streaming && !payload.queueExecution.sourceEdit
        ? await generateImageStream(context.token, params, progress => {
            void context.updateProgress('stream', Math.min(params.steps, Math.round(params.steps * progress / 100)), params.steps)
        }, context.signal)
        : await generateImage(context.token, params, context.signal)
    if (!result.success || !result.imageData) {
        if (result.termination === 'cancelled') return
        if (result.termination === 'timeout') {
            throw new QueueExecutionError('timeout', 'Scene generation reached its bounded timeout')
        }
        throw new QueueExecutionError('decode', 'Scene generation returned no decodable image')
    }
    if (!context.canCommit()) return

    const bytes = decodeImageBytes(result.imageData)
    const digest = await hashQueueResourceBytes(bytes)
    const transactionId = `queue-${sha256Utf8(job.id).slice(0, 48)}`
    const artifactReference: QueueArtifactReference = {
        kind: 'output-writer',
        artifactId: `artifact:${job.id}`,
        digest,
        mimeType: payload.sceneWorkflow.mimeType,
    }
    await context.bindOutput(transactionId, artifactReference)
    const sequenceLease = payload.sceneWorkflow.sequenceCommitProposal === null
        ? null
        : reserveSceneFragmentSequenceProposal(payload.sceneWorkflow.sequenceCommitProposal)
    if (payload.sceneWorkflow.sequenceCommitProposal !== null && sequenceLease === null) {
        throw new QueueExecutionError('transient', 'Fragment sequence changed before durable reservation')
    }
    try {
        const saved = await saveSceneResult(
            payload.sceneWorkflow.scene,
            payload.sceneWorkflow.saveContext,
            payload.sceneWorkflow.finalPrompt,
            params,
            result.imageData,
            payload.sceneWorkflow.mimeType,
            result.encodedVibes,
            {
                canSave: context.canCommit,
                sentPayloadSummary: result.sentPayloadSummary,
                sourceJobId: job.id,
                outputTransactionId: transactionId,
                outputContext: payload.sceneWorkflow.outputContext,
                ...(sequenceLease === null ? {} : { beforeFinalize: () => sequenceLease.commit() }),
                commitDurable: () => context.commitOutput(transactionId, artifactReference),
            },
        )
        if (!saved && !context.signal.aborted) {
            throw new QueueExecutionError('transient', 'Scene output was not committed')
        }
    } finally {
        sequenceLease?.release()
    }
}
