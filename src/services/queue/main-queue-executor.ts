import { canonicalSerialize, hashCanonicalValue, sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { GenerationJob, QueueArtifactReference } from '@/domain/queue/types'
import type { ProviderAttemptEvidence, ProviderSha256, SpoolReceipt } from '@/domain/queue/provider-result'
import { ProviderResultSpoolError, type ProviderResultSpool } from '@/application/generation/provider-result-spool'
import { reserveWildcardSequenceProposal } from '@/lib/fragment-processor'
import { createThumbnail } from '@/lib/image-utils'
import { executeNovelAIImageTransport } from '@/services/generation/novelai-image-transport'
import type { NaiProviderObservation } from '@/services/nai/transport'
import { NovelAIHttpError, type GenerationParams } from '@/services/novelai-types'
import {
    CURRENT_NAI_PAYLOAD_BUILDER_REVISION,
    isSupportedNaiPayloadBuilderRevision,
    queryNaiGenerationCompatibility,
} from '@/services/nai/compatibility'
import { CURRENT_NAI_MODEL_CATALOG_REVISION } from '@/services/nai/model-catalog'
import { hashGenerationSemanticIntent } from '@/application/generation/plan-generation'
import { projectMainGenerationSemantic } from '@/services/generation/main-generation-semantic'
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

function encodeImageBytes(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
}

interface SpooledProviderResult {
    readonly receipt: SpoolReceipt
    readonly sentPayloadSummary?: string
    readonly encodedVibes?: string[]
}

/** Accepts only exact Provider delay evidence that can safely authorize a 429 retry. */
function retryAfterMilliseconds(value: string | null, now: number): number | undefined {
    if (value === null) return undefined
    if (/^(?:0|[1-9][0-9]*)$/.test(value)) {
        const seconds = Number(value)
        const milliseconds = seconds * 1_000
        const target = now + milliseconds
        return Number.isSafeInteger(seconds)
            && Number.isSafeInteger(milliseconds)
            && Number.isFinite(new Date(target).getTime())
            ? milliseconds
            : undefined
    }
    if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(value)) {
        return undefined
    }
    const date = Date.parse(value)
    return Number.isFinite(date)
        && new Date(date).toUTCString() === value
        && date > now
        && Number.isSafeInteger(date - now)
        ? date - now
        : undefined
}

/**
 * Persists each Provider boundary before transport advances, then retries only
 * the received bytes into the private spool; ambiguous or lost results block.
 */
async function dispatchAndSpool(
    context: QueueExecutorContext,
    params: GenerationParams,
    imageFormat: NonNullable<GenerationParams['imageFormat']>,
    streaming: boolean,
    spool: ProviderResultSpool,
    faultInjector: ReturnType<typeof getRuntimeMainQueueDependencies>['faultInjector'],
    onProgress: (progress: number, previewImage?: string) => void,
): Promise<SpooledProviderResult> {
    let evidence = context.providerAttempt.providerEvidence
    if (evidence === null) throw new QueueExecutionError('fatal', 'Provider-safe execution requires attempt evidence')
    const advance = async (next: ProviderAttemptEvidence): Promise<void> => {
        evidence = (await context.recordProviderTransition(next)).providerEvidence
        if (evidence === null) throw new QueueExecutionError('fatal', 'Provider evidence disappeared during execution')
    }
    const observe = async (observation: NaiProviderObservation): Promise<void> => {
        if (observation.stage === 'possibly-dispatched' && evidence?.dispatchState === 'prepared') {
            await advance({ ...evidence, dispatchState: 'possibly-dispatched', billingRisk: 'possible' })
        } else if (observation.stage === 'response-started'
            && evidence?.dispatchState === 'possibly-dispatched') {
            await advance({ ...evidence, dispatchState: 'response-started' })
        } else if (observation.stage === 'response-complete'
            && evidence?.dispatchState === 'response-started') {
            const succeeded = observation.status >= 200 && observation.status < 300
            await advance({
                ...evidence,
                dispatchState: 'response-complete',
                providerOutcome: succeeded ? 'succeeded' : 'known-failure',
                billingRisk: succeeded ? 'confirmed' : 'possible',
            })
        }
    }

    let result
    try {
        result = await executeNovelAIImageTransport({
            token: context.token,
            params,
            imageFormat,
            streaming,
            signal: context.signal,
            onProgress,
            faultInjector,
            executionHooks: { observer: observe, errorMode: 'throw' },
        })
    } catch (error) {
        if (error instanceof NovelAIHttpError && evidence.dispatchState === 'response-complete') {
            if (error.status === 401) throw new QueueExecutionError('authentication', 'Provider authentication failed')
            const retryAfterMs = error.status === 429
                ? retryAfterMilliseconds(error.retryAfter, Date.now())
                : undefined
            if (error.status === 429 && retryAfterMs !== undefined) {
                throw new QueueExecutionError('rate-limited', 'Provider rate limit reached', { retryAfterMs })
            }
            throw new QueueExecutionError('fatal', `Provider HTTP ${error.status} is not automatically retryable`)
        }
        if (evidence.dispatchState === 'response-complete' && evidence.providerOutcome === 'succeeded') {
            await context.recordProviderTransition(
                { ...evidence, dispatchState: 'result-lost' },
                { blockReason: 'provider-result-lost' },
            )
            throw error
        }
        if (evidence.dispatchState === 'prepared') {
            await advance({ ...evidence, dispatchState: 'connect-failed-before-dispatch', providerOutcome: 'known-failure' })
            throw new QueueExecutionError('transient', 'Provider connection failed before dispatch')
        }
        if (evidence.dispatchState === 'possibly-dispatched' || evidence.dispatchState === 'response-started') {
            await context.recordProviderTransition(
                { ...evidence, providerOutcome: 'unknown' },
                { blockReason: 'provider-outcome-unknown' },
            )
        }
        throw error
    }
    if (!result.success || !result.imageData) {
        if (evidence.dispatchState === 'response-complete' && evidence.providerOutcome === 'succeeded') {
            await context.recordProviderTransition(
                { ...evidence, dispatchState: 'result-lost' },
                { blockReason: 'provider-result-lost' },
            )
        }
        throw new QueueExecutionError('decode', 'Main generation returned no decodable image')
    }
    let bytes: Uint8Array
    let digest: string
    try {
        bytes = decodeImageBytes(result.imageData)
        digest = await hashQueueResourceBytes(bytes)
    } catch (error) {
        if (evidence.dispatchState === 'response-complete' && evidence.providerOutcome === 'succeeded') {
            await context.recordProviderTransition(
                { ...evidence, dispatchState: 'result-lost' },
                { blockReason: 'provider-result-lost' },
            )
        }
        throw error
    }
    if (evidence.dispatchState !== 'response-complete' || evidence.providerOutcome !== 'succeeded') {
        throw new QueueExecutionError('fatal', 'Provider response completed without durable EOF evidence')
    }
    const attemptId = context.providerAttempt.id
    const commitInput = {
        spoolId: `provider-${sha256Utf8(attemptId).slice(0, 48)}`,
        attemptId,
        contentType: `image/${imageFormat}`,
        bytes,
        committedAt: new Date().toISOString(),
    }
    let receipt: SpoolReceipt | null = null
    let failures = 0
    let injected = false
    while (receipt === null) {
        try {
            receipt = await spool.commit(commitInput)
            if (!injected && faultInjector !== undefined) {
                injected = true
                await faultInjector('after-spool-commit')
            }
        } catch (error) {
            failures += 1
            receipt = null
            if (failures >= 3 || context.signal.aborted) {
                await context.recordProviderTransition(
                    { ...evidence, dispatchState: 'result-lost' },
                    { blockReason: 'provider-result-lost' },
                )
                throw error
            }
            await new Promise(resolve => setTimeout(resolve, failures * 25))
        }
    }
    await advance({
        ...evidence,
        dispatchState: 'result-spooled',
        responseDigest: digest as ProviderSha256,
        spoolReceipt: receipt,
    })
    return { receipt, sentPayloadSummary: result.sentPayloadSummary, encodedVibes: result.encodedVibes }
}

/** Revalidates both the durable receipt and the bytes immediately before OutputWriter. */
async function writeSpooled(spool: ProviderResultSpool, receipt: SpoolReceipt): Promise<Uint8Array> {
    const verified = await spool.verify(receipt.spoolId)
    if (verified.attemptId !== receipt.attemptId || verified.sha256 !== receipt.sha256) {
        throw new ProviderResultSpoolError('conflict', 'Provider spool receipt changed before storage')
    }
    const bytes = await spool.read(receipt.spoolId)
    if (await hashQueueResourceBytes(bytes) !== receipt.sha256) {
        throw new ProviderResultSpoolError('checksum-mismatch', 'Provider spool bytes changed after receipt verification')
    }
    return bytes
}

/** Rebuilds current Provider meaning and fails before dispatch when review-time facts drift. */
function assertProviderEnvelopeMatchesExecution(
    job: GenerationJob,
    context: QueueExecutorContext,
    payload: ReturnType<typeof decodeMainJobSnapshot>,
    params: GenerationParams,
    compatibility: ReturnType<typeof queryNaiGenerationCompatibility>,
    streaming: boolean,
): void {
    const envelope = job.snapshot.providerExecutionEnvelope
    if (envelope === undefined) return
    const providerRoles = new Set(['source', 'mask', 'vibe-reference', 'character-reference'])
    const bindings = job.snapshot.resources
        .filter(resource => providerRoles.has(resource.role))
        .map(resource => ({ resourceId: resource.resourceId, role: resource.role, digest: resource.digest }))
    const semanticIntentHash = hashGenerationSemanticIntent(
        projectMainGenerationSemantic(params, payload.mainWorkflow.imageFormat),
    )
    const envelopeHash = `sha256:${hashCanonicalValue(envelope)}`
    if (payload.payloadBuilderRevision !== CURRENT_NAI_PAYLOAD_BUILDER_REVISION
        || envelope.payloadBuilderRevision !== payload.payloadBuilderRevision
        || envelope.modelCatalogRevision !== CURRENT_NAI_MODEL_CATALOG_REVISION
        || envelope.compatibilityProfileId !== compatibility.compatibilityProfileId
        || envelope.action !== compatibility.action
        || envelope.responseMode !== (streaming ? 'streaming' : 'standard')
        || envelope.semanticIntentHash !== semanticIntentHash
        || context.providerAttempt.executionEnvelopeHash !== envelopeHash
        || canonicalSerialize(envelope.queueResourceBindings) !== canonicalSerialize(bindings)) {
        throw new QueueExecutionError('compatibility', 'Reviewed Provider execution envelope no longer matches execution')
    }
}

/**
 * Depends on the immutable Main snapshot, Queue lease context, NAI transport,
 * OutputWriter transaction, and presentation port. It owns only durable job
 * execution and projection; planning, snapshot encoding, and enqueue remain in
 * the adapter so retries replay the persisted request without reading UI state.
 */
export async function executeMainQueueJob(job: GenerationJob, context: QueueExecutorContext): Promise<void> {
    const { presentation, providerResultSpool, faultInjector } = getRuntimeMainQueueDependencies()
    const payload = decodeMainJobSnapshot(job.snapshot)
    if (!isSupportedNaiPayloadBuilderRevision(payload.payloadBuilderRevision)) {
        throw new QueueExecutionError(
            'compatibility',
            `Unsupported Main payload builder revision: ${payload.payloadBuilderRevision}`,
        )
    }
    const params = await hydrateGenerationParams(payload, job.snapshot.resources, getRuntimeQueueResourceMaterializer())
    params.sourceJobId = job.id
    const streaming = payload.queueExecution.streaming && !payload.queueExecution.sourceEdit
    const compatibility = queryNaiGenerationCompatibility(
        params,
        payload.payloadBuilderRevision,
        streaming,
    )
    if (compatibility.status === 'known-divergence' || compatibility.status === 'unsupported') {
        throw new QueueExecutionError(
            'compatibility',
            `NovelAI compatibility profile cannot execute: ${compatibility.compatibilityProfileId}`,
        )
    }
    try {
        assertProviderEnvelopeMatchesExecution(job, context, payload, params, compatibility, streaming)
    } catch (error) {
        if (context.providerAttempt.providerEvidence?.dispatchState === 'result-spooled') {
            const diagnosticEventId = reportDiagnostic(error, {
                operation: 'queue.main.write-spooled', stage: 'execution-envelope', jobId: job.id,
            }).eventId
            await context.requeueSpooledResult({ diagnosticEventId, pauseReason: 'compatibility' })
        }
        throw error
    }
    // Reserve before transport so a stale immutable snapshot fails without a
    // provider call. Planned Main jobs run in ordinal order and commit their
    // distinct CAS proposals one at a time through this lease.
    const sequenceLease = reserveWildcardSequenceProposal(payload.mainWorkflow.sequenceCommitProposal)
    if (sequenceLease === null) {
        if (context.providerAttempt.providerEvidence?.dispatchState === 'result-spooled') {
            const diagnosticEventId = reportDiagnostic(new Error('Fragment sequence snapshot is stale'), {
                operation: 'queue.main.write-spooled', stage: 'sequence-reserve', jobId: job.id,
            }).eventId
            await context.requeueSpooledResult({ diagnosticEventId, pauseReason: 'fatal' })
        }
        throw new QueueExecutionError('fatal', 'Fragment sequence snapshot is stale before Main transport')
    }
    presentation.beginExecution()
    try {
        await context.updateProgress('transport', 0, Math.max(1, params.steps))
        const progressReporter = createSerializedProgressReporter(context.updateProgress)
        const onProgress = (progress: number, previewImage?: string): void => {
                presentation.reportStreamProgress(
                    progress,
                    context.canCommit() ? previewImage : undefined,
                )
                progressReporter.enqueue(
                    'stream',
                    Math.min(params.steps, Math.round(params.steps * progress / 100)),
                    params.steps,
                )
            }
        let bytes: Uint8Array
        let sentPayloadSummary: string | undefined
        let encodedVibes: string[] | undefined
        if (job.snapshot.providerExecutionEnvelope !== undefined) {
            const currentEvidence = context.providerAttempt.providerEvidence
            let spooled: SpooledProviderResult
            if (currentEvidence?.dispatchState === 'result-spooled' && currentEvidence.spoolReceipt !== null) {
                spooled = { receipt: currentEvidence.spoolReceipt }
            } else {
                spooled = await dispatchAndSpool(
                    context,
                    params,
                    payload.mainWorkflow.imageFormat,
                    streaming,
                    providerResultSpool,
                    faultInjector,
                    onProgress,
                )
            }
            bytes = await writeSpooled(providerResultSpool, spooled.receipt).catch(async error => {
                const diagnosticEventId = reportDiagnostic(error, {
                    operation: 'queue.main.write-spooled',
                    stage: 'storage',
                    jobId: job.id,
                }).eventId
                if (error instanceof ProviderResultSpoolError) {
                    await context.recordProviderTransition({
                        dispatchState: 'result-lost',
                        providerOutcome: 'succeeded',
                        billingRisk: 'confirmed',
                        responseDigest: spooled.receipt.sha256,
                        spoolReceipt: null,
                    }, { diagnosticEventId, blockReason: 'provider-result-lost' })
                    throw error
                }
                await context.requeueSpooledResult({ diagnosticEventId, pauseReason: 'local-io' })
                throw error
            })
            sentPayloadSummary = spooled.sentPayloadSummary
            encodedVibes = spooled.encodedVibes
        } else {
            const result = await executeNovelAIImageTransport({
                token: context.token,
                params,
                imageFormat: payload.mainWorkflow.imageFormat,
                streaming,
                signal: context.signal,
                onProgress,
                faultInjector,
            })
            if (!result.success || !result.imageData) {
                if (result.termination === 'cancelled') return
                if (result.termination === 'timeout') {
                    throw new QueueExecutionError('timeout', 'Main generation reached its bounded timeout')
                }
                throw new QueueExecutionError('decode', 'Main generation returned no decodable image')
            }
            bytes = decodeImageBytes(result.imageData)
            sentPayloadSummary = result.sentPayloadSummary
            encodedVibes = result.encodedVibes
        }
        await progressReporter.flush()
        if (!context.canCommit()) return

        const encodedImage = encodeImageBytes(bytes)
        const imageDataUrl = `data:image/${payload.mainWorkflow.imageFormat};base64,${encodedImage}`
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
                params: { ...params, sentPayloadSummary, sourceJobId: job.id },
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
                    sentPayloadSummary,
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
        }).catch(async error => {
            if (sequenceConflict) {
                if (job.snapshot.providerExecutionEnvelope !== undefined && context.canCommit()) {
                    const diagnosticEventId = reportDiagnostic(error, {
                        operation: 'queue.main.write-spooled', stage: 'sequence-commit', jobId: job.id,
                    }).eventId
                    await context.requeueSpooledResult({ diagnosticEventId, pauseReason: 'fatal' })
                }
                throw new QueueExecutionError('fatal', 'Fragment sequence changed before Main commit')
            }
            if (job.snapshot.providerExecutionEnvelope !== undefined && context.canCommit()) {
                const diagnosticEventId = reportDiagnostic(error, {
                    operation: 'queue.main.write-spooled', stage: 'output-writer', jobId: job.id,
                }).eventId
                await context.requeueSpooledResult({ diagnosticEventId, pauseReason: 'local-io' })
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
        if (encodedVibes && encodedVibes.length > 0) {
            presentation.updateEncodedVibes(encodedVibes)
        }
        const slot = context.tokenSlotId === 'slot-2' ? 2 : 1
        presentation.refreshAnlas(slot)
    } finally {
        sequenceLease.release()
        presentation.finishExecution()
    }
}
