import type { CompositionPlanHash } from '@/domain/composition/canonical-serialize'
import type { FragmentSequenceCommitProposal } from '@/domain/composition/fragment-resolver'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type { JsonValue } from '@/domain/composition/types'
import type { GenerationJobSnapshot } from '@/domain/queue/types'
import { isR2BucketName, isResolvedR2Prefix } from '@/domain/r2/types'
import type {
    SaveSceneResultContext,
    SaveSceneResultOptions,
} from '@/lib/scene-generation/save-scene-result'
import type { GenerationParams } from '@/services/novelai-types'
import { QueueExecutionError } from './durable-queue-coordinator'
import { createGenerationJobSnapshot } from './job-snapshot'
import type {
    DehydratedGenerationParameters,
    DehydratedGenerationResult,
} from './queue-resource-materializer'

export interface SceneQueueWorkflowSnapshot {
    readonly scene: { readonly id: string; readonly name: string }
    readonly finalPrompt: string
    readonly mimeType: string
    readonly saveContext: SaveSceneResultContext
    readonly outputContext: NonNullable<SaveSceneResultOptions['outputContext']>
    readonly sequenceCommitProposal: FragmentSequenceCommitProposal | null
}

export interface SceneQueueSnapshotParameters extends DehydratedGenerationParameters {
    readonly queueExecution: { readonly streaming: boolean; readonly sourceEdit: boolean }
    readonly sceneWorkflow: SceneQueueWorkflowSnapshot
}

export interface EncodeSceneJobSnapshotInput {
    readonly scene: { readonly id: string; readonly name: string }
    readonly params: GenerationParams
    readonly finalPrompt: string
    readonly mimeType: string
    readonly saveContext: SaveSceneResultContext
    readonly outputContext: SceneQueueWorkflowSnapshot['outputContext']
    readonly streaming: boolean
    readonly sequenceCommitProposal: DeepReadonly<FragmentSequenceCommitProposal> | null
    readonly planHash: CompositionPlanHash | null
}

export interface EncodedSceneJobSnapshot {
    readonly sceneId: string
    readonly snapshot: GenerationJobSnapshot
    readonly compositionPlanHash: string | null
}

function asJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidSnapshot(): never {
    throw new QueueExecutionError('fatal', 'Scene queue snapshot parameters are invalid')
}

/**
 * Depends on the resolved Scene generation facts and dehydrated resource refs.
 * It owns the credential-free V1 wire shape, output context, and resumability so
 * Scene enqueue cannot drift from the durable decoder or persist source bytes.
 */
export function encodeSceneJobSnapshot(
    input: EncodeSceneJobSnapshotInput,
    dehydrated: Pick<DehydratedGenerationResult, 'parameters' | 'resources'>,
): EncodedSceneJobSnapshot {
    const parameters: SceneQueueSnapshotParameters = {
        ...dehydrated.parameters,
        queueExecution: {
            streaming: input.streaming,
            sourceEdit: Boolean(input.params.sourceImage || input.params.mask),
        },
        sceneWorkflow: {
            scene: input.scene,
            finalPrompt: input.finalPrompt,
            mimeType: input.mimeType,
            saveContext: input.saveContext,
            outputContext: input.outputContext,
            sequenceCommitProposal: input.sequenceCommitProposal as FragmentSequenceCommitProposal | null,
        },
    }
    return {
        sceneId: input.scene.id,
        snapshot: createGenerationJobSnapshot({
            prompt: {
                positive: input.finalPrompt,
                negative: input.params.negative_prompt,
            },
            parameters: asJson(parameters),
            outputPolicy: asJson({
                workflow: 'scene',
                saveContext: input.saveContext,
                outputContext: input.outputContext,
            }),
            resources: dehydrated.resources,
            resumability: 'resumable',
        }),
        compositionPlanHash: input.planHash === null ? null : `sha256:${input.planHash.digest}`,
    }
}

/**
 * Depends only on the persisted generic Job Snapshot and is consumed before
 * resource hydration. It validates every structural field used by Scene output
 * execution and maps corrupt/foreign payloads to a stable fatal Queue failure.
 */
export function decodeSceneJobSnapshot(snapshot: GenerationJobSnapshot): SceneQueueSnapshotParameters {
    const candidate = snapshot.parameters
    if (!isRecord(candidate)
        || candidate.generationParams === undefined
        || !Array.isArray(candidate.resourceBindings)
        || !isRecord(candidate.resourceArrayLengths)
        || !isRecord(candidate.queueExecution)
        || typeof candidate.queueExecution.streaming !== 'boolean'
        || typeof candidate.queueExecution.sourceEdit !== 'boolean'
        || !isRecord(candidate.sceneWorkflow)
        || !isRecord(candidate.sceneWorkflow.scene)
        || typeof candidate.sceneWorkflow.scene.id !== 'string'
        || typeof candidate.sceneWorkflow.scene.name !== 'string'
        || typeof candidate.sceneWorkflow.finalPrompt !== 'string'
        || typeof candidate.sceneWorkflow.mimeType !== 'string'
        || !isRecord(candidate.sceneWorkflow.saveContext)
        || typeof candidate.sceneWorkflow.saveContext.activePresetId !== 'string'
        || typeof candidate.sceneWorkflow.saveContext.sceneSavePath !== 'string'
        || !isRecord(candidate.sceneWorkflow.outputContext)
        || typeof candidate.sceneWorkflow.outputContext.useAbsoluteScenePath !== 'boolean'
        || typeof candidate.sceneWorkflow.outputContext.metadataMode !== 'string'
        || !['embedded', 'sidecar-only', 'strip-and-sidecar', 'strip-only'].includes(candidate.sceneWorkflow.outputContext.metadataMode)
        || typeof candidate.sceneWorkflow.outputContext.presetName !== 'string'
        || typeof candidate.sceneWorkflow.outputContext.sceneName !== 'string'
        || (candidate.sceneWorkflow.outputContext.sceneSubfoldersEnabled !== undefined
            && typeof candidate.sceneWorkflow.outputContext.sceneSubfoldersEnabled !== 'boolean')
        || (candidate.sceneWorkflow.outputContext.presetPathSegments !== undefined
            && (!Array.isArray(candidate.sceneWorkflow.outputContext.presetPathSegments)
                || !candidate.sceneWorkflow.outputContext.presetPathSegments.every(segment => typeof segment === 'string')))
        || (candidate.sceneWorkflow.outputContext.directory !== undefined
            && typeof candidate.sceneWorkflow.outputContext.directory !== 'string')
        || (candidate.sceneWorkflow.outputContext.capabilityFallbackDirectory !== undefined
            && typeof candidate.sceneWorkflow.outputContext.capabilityFallbackDirectory !== 'string')
        || (candidate.sceneWorkflow.outputContext.autoR2UploadProfileId !== undefined
            && candidate.sceneWorkflow.outputContext.autoR2UploadProfileId !== null
            && typeof candidate.sceneWorkflow.outputContext.autoR2UploadProfileId !== 'string')
        || (candidate.sceneWorkflow.outputContext.r2Bucket !== undefined
            && candidate.sceneWorkflow.outputContext.r2Bucket !== null
            && !isR2BucketName(candidate.sceneWorkflow.outputContext.r2Bucket))
        || (candidate.sceneWorkflow.outputContext.r2Prefix !== undefined
            && candidate.sceneWorkflow.outputContext.r2Prefix !== null
            && !isResolvedR2Prefix(candidate.sceneWorkflow.outputContext.r2Prefix))
        || (candidate.sceneWorkflow.outputContext.filenameTemplate !== undefined
            && (typeof candidate.sceneWorkflow.outputContext.filenameTemplate !== 'string'
                || candidate.sceneWorkflow.outputContext.filenameTemplate.length === 0
                || candidate.sceneWorkflow.outputContext.filenameTemplate.length > 180
                || /[\r\n]/.test(candidate.sceneWorkflow.outputContext.filenameTemplate)))) {
        return invalidSnapshot()
    }
    return candidate as unknown as SceneQueueSnapshotParameters
}
