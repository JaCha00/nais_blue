import {
    reserveWildcardSequenceProposal,
} from '@/lib/fragment-processor'
import { createThumbnail } from '@/lib/image-utils'
import { generateImage, generateImageStream, type GenerationParams } from '@/services/novelai-api'
import { ensureImageFileExtension, renderFilenameTemplate } from '@/services/output/filename-policy'
import { getRuntimeOutputWriter, OutputWriterError } from '@/services/output/output-writer'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { useAuthStore } from '@/stores/auth-store'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore, warnIfUnverifiedPayloadParityModel } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { StyleCombination, useStyleLabStore } from '@/stores/style-lab-store'
import { toast } from '@/components/ui/use-toast'
import i18n from '@/i18n'
import {
    buildStyleLabGenerationParams,
    formatStyleLabCompositionErrors,
} from '@/lib/style-lab/build-style-lab-params'

let styleLabGenerationLock = false
const STREAM_PREVIEW_UPDATE_INTERVAL_MS = 250
const STREAM_PREVIEW_PROGRESS_STEP = 0.05

function isStyleLabSessionCancelled(signal: AbortSignal): boolean {
    const generationState = useGenerationStore.getState()
    return signal.aborted || generationState.isCancelled || generationState.generatingMode !== 'styleLab'
}

function waitForPreviewDelay(ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)

    return new Promise(resolve => {
        const timeout = window.setTimeout(() => {
            signal.removeEventListener('abort', handleAbort)
            resolve(true)
        }, ms)
        const handleAbort = () => {
            window.clearTimeout(timeout)
            resolve(false)
        }
        signal.addEventListener('abort', handleAbort, { once: true })
    })
}

interface StyleLabPublishedOutput {
    path: string
    thumbnail?: string
}

function resolveStyleLabFileName(
    params: GenerationParams,
    seed: number,
    filenameTemplate = params.outputPolicySummary?.filenameTemplateId,
    now = new Date(Date.now()),
): string {
    const fileExt = params.imageFormat === 'webp' ? 'webp' : 'png'
    const fallback = `NAIS_STYLELAB_${now.getTime()}`
    const rendered = filenameTemplate
        ? renderFilenameTemplate({
            template: filenameTemplate,
            context: { seed },
            now,
            fallback,
        })
        : fallback
    return ensureImageFileExtension(rendered, fileExt) ?? `${fallback}.${fileExt}`
}

async function saveStyleLabImage(
    imageData: string,
    imageUrl: string,
    finalPrompt: string,
    seed: number,
    params: GenerationParams,
    fileName: string,
    sentPayloadSummary?: string,
    canCommit: () => boolean = () => true,
    beforeFinalize?: () => boolean,
    publishPreview?: (output: StyleLabPublishedOutput) => void,
    rollbackPreview?: () => void,
): Promise<StyleLabPublishedOutput | null> {
    const settings = useSettingsStore.getState()
    const { styleLabSavePath, autoSave, useAbsoluteStyleLabPath } = settings
    const imageFormat = params.imageFormat ?? settings.imageFormat
    const metadataMode = params.metadataMode ?? settings.metadataMode
    const fileExt = imageFormat === 'webp' ? 'webp' : 'png'

    if (!autoSave) {
        let thumbnail: string | undefined
        try {
            thumbnail = await createThumbnail(imageUrl)
        } catch (thumbnailError) {
            console.warn('[StyleLab] Failed to create preview thumbnail:', thumbnailError)
        }
        if (!canCommit()) return null
        const memoryPath = `memory://${fileName}`
        if (beforeFinalize !== undefined && !beforeFinalize()) return null
        try {
            publishPreview?.({ path: memoryPath, thumbnail })
        } catch (error) {
            rollbackPreview?.()
            throw error
        }
        try {
            window.dispatchEvent(new CustomEvent('newImageGenerated', {
                detail: { path: memoryPath, data: imageUrl }
            }))
        } catch (error) {
            console.warn('[StyleLab] Preview completed but the memory result event failed.', error)
        }
        return { path: memoryPath, thumbnail }
    }

    const binaryString = atob(imageData.replace(/^data:image\/(png|webp);base64,/, ''))
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }

    let sessionInvalid = false
    let finalizeRejected = false
    let historyId: string | null = null
    let publishedOutput: StyleLabPublishedOutput | null = null
    let workflowCommitted = false
    try {
        const output = await getRuntimeOutputWriter().write({
            destination: {
                ...(params.portableOutputDirectory === undefined
                    ? {}
                    : { portableDirectory: params.portableOutputDirectory }),
                directory: styleLabSavePath || 'nais-style',
                useAbsolutePath: useAbsoluteStyleLabPath,
                capabilityFallbackDirectory: 'nais-style',
                workflowDefaultDirectory: 'nais-style',
                fileName,
                extension: fileExt,
                collisionPolicy: params.outputPolicySummary?.collisionPolicy ?? 'unique',
            },
            imageBytes: bytes,
            imageDataUrl: imageUrl,
            metadata: {
                params: { ...params, sentPayloadSummary },
                imageFormat,
                metadataMode,
                includeWebpCompatibilitySidecar: true,
            },
            generateThumbnail: createThumbnail,
            canCommit,
            commitWorkflow: outputResult => {
                if (!canCommit()) {
                    sessionInvalid = true
                    throw new Error('Style Lab generation session changed before output publication')
                }
                if (beforeFinalize !== undefined && !beforeFinalize()) {
                    finalizeRejected = true
                    throw new Error('Fragment sequence changed before Style Lab output commit')
                }

                historyId = Date.now().toString()
                useGenerationStore.getState().addToHistory({
                    id: historyId,
                    url: outputResult.path,
                    thumbnail: outputResult.thumbnailDataUrl,
                    prompt: finalPrompt,
                    seed,
                    timestamp: new Date(),
                    sentPayloadSummary,
                })
                publishPreview?.({ path: outputResult.path, thumbnail: outputResult.thumbnailDataUrl })
                publishedOutput = { path: outputResult.path, thumbnail: outputResult.thumbnailDataUrl }
                try {
                    window.dispatchEvent(new CustomEvent('newImageGenerated', {
                        detail: { path: outputResult.path },
                    }))
                } catch (eventError) {
                    console.warn('[StyleLab] Failed to publish the committed output event.', eventError)
                }
                workflowCommitted = true
            },
            rollbackWorkflow: () => {
                workflowCommitted = false
                publishedOutput = null
                if (historyId !== null) {
                    useGenerationStore.setState(state => ({
                        history: state.history.filter(item => item.id !== historyId),
                    }))
                }
                rollbackPreview?.()
            },
        })
        if (output.status === 'cancelled') return null
        if (output.result.capabilityFallbackUsed) {
            toast({
                title: i18n.t(
                    'composition.outputCapabilityFallbackTitle',
                    'Output destination changed for this platform',
                ),
                description: i18n.t(
                    'composition.outputCapabilityFallbackDescription',
                    '{{reason}} Alternative: {{alternative}}',
                    {
                        reason: output.result.capabilityFallbackReason ?? '',
                        alternative: output.result.capabilityFallbackAlternative ?? '',
                    },
                ),
            })
        }
        return { path: output.result.path, thumbnail: output.result.thumbnailDataUrl }
    } catch (error) {
        if (workflowCommitted && publishedOutput !== null) {
            console.warn('[StyleLab] Output committed; recovery cleanup remains pending.', error)
            return publishedOutput
        }
        if (sessionInvalid || finalizeRejected || !canCommit()) return null
        throw error
    }
}

export async function generateStyleLabPreviews(combinationIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(combinationIds)]
    if (uniqueIds.length === 0) return

    const authState = useAuthStore.getState()
    if (!authState.token || !authState.isVerified) {
        authState.requestCredentialUnlock()
        toast({
            title: i18n.t('toast.tokenRequired.title'),
            description: i18n.t('toast.tokenRequired.desc'),
            variant: 'destructive',
        })
        return
    }

    const generationState = useGenerationStore.getState()
    if (styleLabGenerationLock || (generationState.generatingMode && generationState.generatingMode !== 'styleLab')) {
        toast({
            title: i18n.t('styleLab.toast.previewBusyTitle'),
            description: i18n.t('styleLab.toast.previewBusyDesc'),
            variant: 'destructive',
        })
        return
    }

    warnIfUnverifiedPayloadParityModel(generationState.model)

    const abortController = new AbortController()
    const sessionId = Date.now()

    styleLabGenerationLock = true
    useStyleLabStore.getState().setPreviewQueueState(true, uniqueIds.length, 0)
    useGenerationStore.setState({
        isGenerating: true,
        generatingMode: 'styleLab',
        isCancelled: false,
        abortController,
        generationSessionId: sessionId,
        streamProgress: 0,
    })

    try {
        for (let index = 0; index < uniqueIds.length; index++) {
            if (isStyleLabSessionCancelled(abortController.signal)) break

            const id = uniqueIds[index]
            const combo = useStyleLabStore.getState().combinations.find(item => item.id === id)
            if (!combo) continue

            useStyleLabStore.getState().updateCombinationPreview(id, {
                isPreviewing: true,
                previewProgress: 0,
                previewError: undefined,
            })

            let sequenceLease: ReturnType<typeof reserveWildcardSequenceProposal> = null
            try {
                const built = await buildStyleLabGenerationParams(combo, {
                    requestId: `style-lab:${sessionId}:${id}:${index}`,
                })
                if (isStyleLabSessionCancelled(abortController.signal)) break
                if (!built.success) {
                    throw new Error(formatStyleLabCompositionErrors(built.errors))
                }
                const { params, prompt, seed, plan, sequenceCommitProposal } = built
                sequenceLease = sequenceCommitProposal === null
                    ? null
                    : reserveWildcardSequenceProposal(sequenceCommitProposal)
                if (sequenceCommitProposal !== null && sequenceLease === null) {
                    throw new Error('Fragment sequence changed before Style Lab reservation')
                }

                const { useStreaming, imageFormat } = useSettingsStore.getState()
                const mimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                const hasSourceEdit = Boolean(params.sourceImage || params.mask)
                const canUseStreaming = useStreaming && !hasSourceEdit
                let lastPreviewUpdateAt = 0
                let lastPreviewProgress = -1
                const result = canUseStreaming
                    ? await generateImageStream(authState.token, params, (progress, partialImage) => {
                        if (isStyleLabSessionCancelled(abortController.signal)) return
                        const progressRatio = progress / 100
                        const now = Date.now()
                        const shouldUpdatePreview =
                            progress >= 100 ||
                            progressRatio - lastPreviewProgress >= STREAM_PREVIEW_PROGRESS_STEP ||
                            now - lastPreviewUpdateAt >= STREAM_PREVIEW_UPDATE_INTERVAL_MS
                        if (!shouldUpdatePreview) return

                        lastPreviewUpdateAt = now
                        lastPreviewProgress = progressRatio
                        useGenerationStore.getState().setStreamProgress(progress)
                        const previewPatch: Partial<StyleCombination> = { previewProgress: progressRatio }
                        if (partialImage) {
                            previewPatch.previewImage = `data:${mimeType};base64,${partialImage}`
                        }
                        useStyleLabStore.getState().updateCombinationPreview(id, previewPatch)
                    }, abortController.signal)
                    : await generateImage(authState.token, params, abortController.signal)

                useGenerationStore.getState().setStreamProgress(0)

                if (isStyleLabSessionCancelled(abortController.signal)) {
                    useStyleLabStore.getState().updateCombinationPreview(id, {
                        isPreviewing: false,
                        previewProgress: 0,
                    })
                    break
                }

                if (!result.success || !result.imageData) {
                    throw new Error(result.error || i18n.t('styleLab.generation.imageFailed'))
                }

                const imageUrl = `data:${mimeType};base64,${result.imageData}`
                const previewFileName = resolveStyleLabFileName(params, seed, plan?.outputPolicy.filenameTemplate)
                let previewThumbnail: string | undefined
                let sequenceCommitted = sequenceLease === null
                const activeSequenceLease = sequenceLease
                const previewBeforePublish = useStyleLabStore.getState().combinations.find(item => item.id === id)
                let previewPublished = false
                const publishPreview = (published: StyleLabPublishedOutput): void => {
                    previewPublished = true
                    useStyleLabStore.getState().updateCombinationPreview(id, {
                        previewImage: published.path.startsWith('memory://') ? imageUrl : undefined,
                        previewPath: published.path,
                        previewThumbnail: published.thumbnail,
                        previewSeed: seed,
                        previewPrompt: prompt,
                        previewProgress: 1,
                        isPreviewing: false,
                    })
                }
                const rollbackPreview = (): void => {
                    if (!previewPublished || previewBeforePublish === undefined) return
                    previewPublished = false
                    useStyleLabStore.getState().updateCombinationPreview(id, {
                        previewImage: previewBeforePublish.previewImage,
                        previewPath: previewBeforePublish.previewPath,
                        previewThumbnail: previewBeforePublish.previewThumbnail,
                        previewSeed: previewBeforePublish.previewSeed,
                        previewPrompt: previewBeforePublish.previewPrompt,
                        previewProgress: previewBeforePublish.previewProgress,
                        isPreviewing: previewBeforePublish.isPreviewing,
                        previewError: previewBeforePublish.previewError,
                    })
                }
                const canCommitPreview = (): boolean => {
                    const generationState = useGenerationStore.getState()
                    return generationState.generationSessionId === sessionId
                        && !isStyleLabSessionCancelled(abortController.signal)
                }
                const finalizePreview = (): boolean => {
                    if (sequenceCommitted) return true
                    if (!canCommitPreview()) return false
                    if (activeSequenceLease === null) return true
                    const committed = activeSequenceLease.commit()
                    sequenceCommitted = committed
                    return committed
                }
                try {
                    const savedPath = await saveStyleLabImage(
                        result.imageData,
                        imageUrl,
                        prompt,
                        seed,
                        params,
                        previewFileName,
                        result.sentPayloadSummary,
                        canCommitPreview,
                        finalizePreview,
                        publishPreview,
                        rollbackPreview,
                    )
                    if (savedPath === null) {
                        if (!canCommitPreview()) break
                        throw new Error('Fragment sequence changed before Style Lab preview commit')
                    }
                    previewThumbnail = savedPath.thumbnail
                } catch (saveError) {
                    reportDiagnostic(saveError, { operation: 'style-lab.output', stage: 'write' })
                    if (!canCommitPreview()) break
                    if (saveError instanceof OutputWriterError
                        && saveError.message.includes('rollback is pending')) {
                        throw saveError
                    }
                    if (!finalizePreview()) {
                        throw new Error('Fragment sequence changed before Style Lab preview commit')
                    }
                    if (previewThumbnail === undefined) {
                        try {
                            previewThumbnail = await createThumbnail(imageUrl)
                        } catch (thumbnailError) {
                            console.warn('[StyleLab] Failed to create fallback preview thumbnail:', thumbnailError)
                        }
                    }
                    const memoryPath = `memory://${previewFileName}`
                    publishPreview({ path: memoryPath, thumbnail: previewThumbnail })
                    try {
                        window.dispatchEvent(new CustomEvent('newImageGenerated', {
                            detail: { path: memoryPath, data: imageUrl }
                        }))
                    } catch (eventError) {
                        console.warn('[StyleLab] Preview completed but the fallback result event failed.', eventError)
                    }
                }

                if (result.encodedVibes && result.encodedVibes.length > 0) {
                    const { vibeImages, updateVibeImage } = useCharacterStore.getState()
                    let encodedIndex = 0
                    for (let vibeIndex = 0; vibeIndex < vibeImages.length && encodedIndex < result.encodedVibes.length; vibeIndex++) {
                        if (!vibeImages[vibeIndex].encodedVibe) {
                            updateVibeImage(vibeImages[vibeIndex].id, { encodedVibe: result.encodedVibes[encodedIndex] })
                            encodedIndex++
                        }
                    }
                }

                useAuthStore.getState().refreshAnlas()
            } catch (error) {
                if (isStyleLabSessionCancelled(abortController.signal)) {
                    useStyleLabStore.getState().updateCombinationPreview(id, {
                        isPreviewing: false,
                        previewProgress: 0,
                    })
                    break
                }

                const diagnostic = reportDiagnostic(error, {
                    operation: 'style-lab.preview',
                    stage: 'generate',
                })
                useStyleLabStore.getState().updateCombinationPreview(id, {
                    isPreviewing: false,
                    previewProgress: 0,
                    // This stays inside the explicit preview detail surface;
                    // it is still the kernel's redacted developer projection.
                    previewError: diagnostic.redactedDeveloperMessage,
                })
                toast({
                    title: i18n.t('styleLab.toast.previewFailed'),
                    description: diagnostic.userSummary,
                    variant: 'destructive',
                })
            } finally {
                sequenceLease?.release()
            }

            useStyleLabStore.getState().setPreviewQueueState(true, uniqueIds.length, index + 1)

            if (index < uniqueIds.length - 1) {
                const delay = useStyleLabStore.getState().settings.previewDelayMs
                const delayCompleted = await waitForPreviewDelay(delay, abortController.signal)
                if (!delayCompleted || isStyleLabSessionCancelled(abortController.signal)) break
            }
        }
    } finally {
        styleLabGenerationLock = false
        useStyleLabStore.getState().setPreviewQueueState(false, 0, 0)
        useStyleLabStore.getState().clearPreviewRuntime()
        useGenerationStore.setState({
            isGenerating: false,
            generatingMode: null,
            currentBatch: 0,
            abortController: null,
            streamProgress: 0,
        })
        useCharacterStore.getState().releaseImageData()
    }
}
