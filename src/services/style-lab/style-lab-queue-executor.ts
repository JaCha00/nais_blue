import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { JsonValue } from '@/domain/composition/types'
import type { GenerationJob, QueueArtifactReference } from '@/domain/queue/types'
import { createStylePreviewAsset } from '@/domain/style-lab'
import type { StyleLabRepository } from '@/application/style-lab/style-lab-repository'
import type { StyleLabQueuePresentationPort } from '@/application/style-lab/style-lab-queue-presentation-port'
import { createThumbnail } from '@/lib/image-utils'
import { executeNovelAIImageTransport } from '@/services/generation/novelai-image-transport'
import type { QueueExecutorContext } from '@/services/queue/durable-queue-coordinator'
import { QueueExecutionError } from '@/services/queue/durable-queue-coordinator'
import {
    getRuntimeQueueResourceMaterializer,
    hashQueueResourceBytes,
    hydrateGenerationParams,
} from '@/services/queue/queue-resource-materializer'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'
import { getStyleLabRepository } from './indexeddb-style-lab-repository'
import { decodeStyleLabJobSnapshot } from './style-lab-job-snapshot-codec'
import { getStyleLabVault, type StyleLabVault } from './style-lab-vault'

export interface StyleLabQueueExecutorDependencies {
    readonly presentation: StyleLabQueuePresentationPort
    readonly repository?: StyleLabRepository
    readonly vault?: StyleLabVault
}

function asJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue
}

function decodeImageBytes(imageData: string): Uint8Array {
    const encoded = imageData.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(encoded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/**
 * Depends on an immutable Style Lab snapshot, Queue lease context, NAI transport,
 * OutputWriter, Vault, and render repository. It owns durable replay and result
 * publication while budget reservation, idempotency, and crash reconciliation
 * remain in style-lab-queue-adapter.
 */
export async function executeStyleLabQueueJob(
    job: GenerationJob,
    context: QueueExecutorContext,
    dependencies: StyleLabQueueExecutorDependencies,
): Promise<void> {
    const payload = decodeStyleLabJobSnapshot(job.snapshot)
    const workflow = payload.styleLabWorkflow
    const repository = dependencies.repository ?? getStyleLabRepository()
    const vault = dependencies.vault ?? getStyleLabVault()
    const presentation = dependencies.presentation
    presentation.beginPreview(workflow.comboId)
    let previewNeedsCleanup = true
    try {
        const params = await hydrateGenerationParams(
            payload,
            job.snapshot.resources,
            getRuntimeQueueResourceMaterializer(),
        )
        params.sourceJobId = job.id
        await context.updateProgress('transport', 0, Math.max(1, params.steps))
        const generated = await executeNovelAIImageTransport({
            token: context.token,
            params,
            imageFormat: workflow.output.imageFormat,
            streaming: false,
            signal: context.signal,
        })
        if (!generated.success || !generated.imageData) {
            if (generated.termination === 'cancelled') return
            if (generated.termination === 'timeout') {
                throw new QueueExecutionError('timeout', 'Style-Lab render timed out')
            }
            throw new QueueExecutionError('decode', 'Style-Lab generation returned no decodable image')
        }
        if (!context.canCommit()) return

        const bytes = decodeImageBytes(generated.imageData)
        const digest = await hashQueueResourceBytes(bytes)
        const encodedImage = generated.imageData.replace(/^data:image\/[^;]+;base64,/, '')
        const imageDataUrl = `data:image/${workflow.output.imageFormat};base64,${encodedImage}`
        const transactionId = `queue-${sha256Utf8(job.id).slice(0, 48)}`
        const historyId = `queue-history:${job.id}`
        const artifactReference: QueueArtifactReference = {
            kind: 'output-writer',
            artifactId: `artifact:${job.id}`,
            digest,
            mimeType: `image/${workflow.output.imageFormat}`,
        }
        await context.bindOutput(transactionId, artifactReference)
        await getRuntimeOutputWriter().write({
            transactionId,
            sourceJobId: job.id,
            includeFinalImageFacts: true,
            destination: {
                ...(workflow.output.portableDirectory === undefined
                    ? {}
                    : { portableDirectory: workflow.output.portableDirectory }),
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
                presentation.commitResult({
                    comboId: workflow.comboId,
                    preview: {
                        path: outputResult.path,
                        thumbnail: outputResult.thumbnailDataUrl,
                        seed: workflow.seed,
                        prompt: job.snapshot.prompt.positive,
                        contextId: workflow.context.id,
                    },
                    history: {
                        id: historyId,
                        url: outputResult.thumbnailDataUrl ?? outputResult.path,
                        thumbnail: outputResult.thumbnailDataUrl,
                        prompt: job.snapshot.prompt.positive,
                        seed: workflow.seed,
                        timestamp: new Date(workflow.requestedAt),
                        sentPayloadSummary: generated.sentPayloadSummary,
                        sourceJobId: job.id,
                    },
                    artifact: { path: outputResult.path, sourceJobId: job.id },
                })
                previewNeedsCleanup = false
                await repository.settleRenderReservation(workflow.reservationId, 'spent', Date.now())
                await context.commitOutput(transactionId, artifactReference)
            },
            rollbackWorkflow: () => {
                presentation.rollbackResult(workflow.comboId, historyId)
                previewNeedsCleanup = false
            },
        })
    } finally {
        if (previewNeedsCleanup) presentation.clearPreview(workflow.comboId)
    }
}
