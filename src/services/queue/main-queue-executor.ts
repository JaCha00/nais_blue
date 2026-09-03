import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { GenerationJob, QueueArtifactReference } from '@/domain/queue/types'
import { reserveWildcardSequenceProposal } from '@/lib/fragment-processor'
import { createThumbnail } from '@/lib/image-utils'
import { executeNovelAIImageTransport } from '@/services/generation/novelai-image-transport'
import {
    isSupportedNaiPayloadBuilderRevision,
    queryNaiGenerationCompatibility,
} from '@/services/nai/compatibility'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'
import {
    discardGeneratedProviderOriginal,
    releaseGeneratedOutputToR2,
} from '@/services/r2/generated-release'
import type { QueueExecutorContext } from './durable-queue-coordinator'
import { QueueExecutionError } from './durable-queue-coordinator'
import { decodeMainJobSnapshot } from './main-job-snapshot-codec'
import { getRuntimeMainQueueDependencies } from './main-queue-runtime-dependencies'
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
import { createSerializedProgressReporter } from './serialized-progress-reporter'
import {
    DEFAULT_RIGHTS_OWNER,
    isRightsEffectiveDate,
    isRightsOwner,
} from '@/domain/workflow/bluehair-rights-policy'

function decodeImageBytes(imageData: string): Uint8Array {
    const encoded = imageData.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(encoded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/**
 * Depends on the immutable Main snapshot, Queue lease context, NAI transport,
 * OutputWriter transaction, and presentation port. It owns only durable job
 * execution and projection; planning, snapshot encoding, and enqueue remain in
 * the adapter so retries replay the persisted request without reading UI state.
 */
export async function executeMainQueueJob(job: GenerationJob, context: QueueExecutorContext): Promise<void> {
    const { presentation, faultInjector } = getRuntimeMainQueueDependencies()
    const payload = decodeMainJobSnapshot(job.snapshot)
    if (!isSupportedNaiPayloadBuilderRevision(payload.payloadBuilderRevision)) {
        throw new QueueExecutionError(
            'compatibility',
            `Unsupported Main payload builder revision: ${payload.payloadBuilderRevision}`,
        )
    }
    const params = await hydrateGenerationParams(payload, job.snapshot.resources, getRuntimeQueueResourceMaterializer())
    params.sourceJobId = job.id
    const compatibility = queryNaiGenerationCompatibility(
        params,
        payload.payloadBuilderRevision,
        payload.queueExecution.streaming && !payload.queueExecution.sourceEdit,
    )
    if (compatibility.status === 'known-divergence' || compatibility.status === 'unsupported') {
        throw new QueueExecutionError(
            'compatibility',
            `NovelAI compatibility profile cannot execute: ${compatibility.compatibilityProfileId}`,
        )
    }
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
        const result = await executeNovelAIImageTransport({
            token: context.token,
            params,
            imageFormat: payload.mainWorkflow.imageFormat,
            streaming: payload.queueExecution.streaming && !payload.queueExecution.sourceEdit,
            signal: context.signal,
            onProgress: (progress, previewImage) => {
                presentation.reportStreamProgress(
                    progress,
                    context.canCommit() ? previewImage : undefined,
                )
                progressReporter.enqueue(
                    'stream',
                    Math.min(params.steps, Math.round(params.steps * progress / 100)),
                    params.steps,
                )
            },
            faultInjector,
        })
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
        const encodedImage = result.imageData.replace(/^data:image\/[^;]+;base64,/, '')
        const imageDataUrl = `data:image/${payload.mainWorkflow.imageFormat};base64,${encodedImage}`
        const digest = await hashQueueResourceBytes(bytes)
        // Phase 3 inserts the durable provider spool at this exact hand-off.
        // Until then the optional test seam characterizes failures after full
        // response bytes exist and before OutputWriter starts any local commit.
        if (faultInjector !== undefined) await faultInjector('after-spool-commit')
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
        const hasPrivateRelease = payload.mainWorkflow.metadataMode === 'strip-and-sidecar'
        const rightsEffectiveDate = payload.mainWorkflow.output.rightsXmpEnabled === true
            && isRightsEffectiveDate(payload.mainWorkflow.output.rightsEffectiveDate)
            ? payload.mainWorkflow.output.rightsEffectiveDate
            : null
        const rightsOwner = isRightsOwner(payload.mainWorkflow.output.rightsOwner)
            ? payload.mainWorkflow.output.rightsOwner
            : DEFAULT_RIGHTS_OWNER
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
                workflowDefaultDirectory: 'NAI_Blue_Output',
                fileName: payload.mainWorkflow.output.fileName,
                extension: payload.mainWorkflow.imageFormat,
                collisionPolicy: payload.mainWorkflow.output.collisionPolicy,
            },
            imageBytes: bytes,
            imageDataUrl,
            preserveProviderOriginal: hasPrivateRelease,
            terminalWorkflowCommit: true,
            metadata: {
                params: { ...params, sentPayloadSummary: result.sentPayloadSummary, sourceJobId: job.id },
                imageFormat: payload.mainWorkflow.imageFormat,
                metadataMode: payload.mainWorkflow.metadataMode,
                includeWebpCompatibilitySidecar: true,
                ...(rightsEffectiveDate === null
                    ? {}
                    : {
                        rightsXmp: {
                            owner: rightsOwner,
                            effectiveDate: rightsEffectiveDate,
                            metadataDate: new Date().toISOString(),
                        },
                    }),
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
        if (hasPrivateRelease) {
            let releaseVerified = payload.mainWorkflow.output.autoR2UploadProfileId == null
            if (payload.mainWorkflow.output.autoR2UploadProfileId != null) {
                try {
                    const release = await releaseGeneratedOutputToR2({
                        profileId: payload.mainWorkflow.output.autoR2UploadProfileId,
                        sourceJobId: job.id,
                        imageFormat: payload.mainWorkflow.imageFormat,
                        output: output.result,
                        bucket: payload.mainWorkflow.output.r2Bucket,
                        prefix: payload.mainWorkflow.output.r2Prefix,
                    })
                    releaseVerified = release.status === 'uploaded'
                    if (!releaseVerified) {
                        reportDiagnostic(new Error(`Generated R2 release did not complete: ${release.status}`), {
                            operation: 'r2.generated-release',
                            stage: release.status,
                            jobId: job.id,
                        })
                    }
                } catch (error) {
                    reportDiagnostic(error, {
                        operation: 'r2.generated-release',
                        stage: 'upload',
                        jobId: job.id,
                    })
                }
            }
            if (payload.mainWorkflow.output.deleteOriginalAfterRelease === true && releaseVerified) {
                try {
                    await discardGeneratedProviderOriginal(output.result)
                } catch (error) {
                    reportDiagnostic(error, {
                        operation: 'output.provider-original',
                        stage: 'discard-after-release',
                        jobId: job.id,
                    })
                }
            }
        }
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
