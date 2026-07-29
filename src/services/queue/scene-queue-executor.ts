import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { GenerationJob, QueueArtifactReference } from '@/domain/queue/types'
import { reserveSceneFragmentSequenceProposal } from '@/lib/scene-generation/fragment-runtime'
import { saveSceneResult } from '@/lib/scene-generation/save-scene-result'
import { executeNovelAIImageTransport } from '@/services/generation/novelai-image-transport'
import type { QueueExecutorContext } from './durable-queue-coordinator'
import { QueueExecutionError } from './durable-queue-coordinator'
import {
    registerQueueArtifact,
    rollbackQueueArtifactRegistration,
    type QueueArtifactRegistration,
} from './queue-artifact-lineage'
import {
    getRuntimeQueueResourceMaterializer,
    hashQueueResourceBytes,
    hydrateGenerationParams,
} from './queue-resource-materializer'
import { decodeSceneJobSnapshot } from './scene-job-snapshot-codec'
import { createSerializedProgressReporter } from './serialized-progress-reporter'

function decodeImageBytes(imageData: string): Uint8Array {
    const encoded = imageData.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(encoded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/**
 * Depends on the immutable Scene snapshot, Queue lease context, shared NAI
 * transport, and the existing Scene output transaction. It owns replayable job
 * execution while target selection, composition planning, and enqueue remain in
 * scene-queue-adapter, so retries never read the current Scene UI selection.
 */
export async function executeSceneQueueJob(
    job: GenerationJob,
    context: QueueExecutorContext,
): Promise<void> {
    const payload = decodeSceneJobSnapshot(job.snapshot)
    const params = await hydrateGenerationParams(payload, job.snapshot.resources, getRuntimeQueueResourceMaterializer())
    params.sourceJobId = job.id
    await context.updateProgress('transport', 0, Math.max(1, params.steps))
    const progressReporter = createSerializedProgressReporter(context.updateProgress)
    const result = await executeNovelAIImageTransport({
        token: context.token,
        params,
        imageFormat: payload.sceneWorkflow.mimeType === 'image/webp' ? 'webp' : 'png',
        streaming: payload.queueExecution.streaming && !payload.queueExecution.sourceEdit,
        signal: context.signal,
        onProgress: progress => {
            progressReporter.enqueue(
                'stream',
                Math.min(params.steps, Math.round(params.steps * progress / 100)),
                params.steps,
            )
        },
    })
    await progressReporter.flush()
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
    let artifactRegistration: QueueArtifactRegistration | null = null
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
                registerArtifact: async output => {
                    artifactRegistration = await registerQueueArtifact(job, artifactReference, output)
                    return artifactRegistration === null
                        ? null
                        : {
                            artifactId: artifactRegistration.record.artifactId,
                            sourceJobId: job.id,
                            sourceSceneId: job.sceneId,
                        }
                },
                rollbackArtifact: async () => {
                    await rollbackQueueArtifactRegistration(artifactRegistration)
                    artifactRegistration = null
                },
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
