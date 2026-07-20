import { createThumbnail } from '@/lib/image-utils'
import { getRotationCharacterFolderName, sanitizePathComponent } from '@/lib/scene-output-path'
import { type GenerationParams } from '@/services/novelai-api'
import { ensureImageFileExtension, renderFilenameTemplate } from '@/services/output/filename-policy'
import { getRuntimeOutputWriter, type OutputWriteResult } from '@/services/output/output-writer'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { getScenePresetPathSegments, useSceneStore, type SceneCard } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import { eradicateImageMetadata } from '@/lib/image-metadata-purge'

export interface SaveSceneResultContext {
    activePresetId: string
    sceneSavePath: string
    rotationCharacterId?: string
    rotationCharacterFolderName?: string
}

export interface SaveSceneResultOptions {
    canSave?: () => boolean
    sentPayloadSummary?: string
    /**
     * Synchronous publish gate. Fragment sequence leases commit here only after
     * durable output and thumbnail work succeeded, with no await before the
     * scene/history publication below.
     */
    beforeFinalize?: () => boolean
    outputTransactionId?: string
    sourceJobId?: string
    commitDurable?: (result: OutputWriteResult) => void | Promise<void>
    /** Queue owners register the same immutable artifact before committing the Job. */
    registerArtifact?: (result: OutputWriteResult) => Promise<SceneOutputArtifactLineage | null>
    /** Reverses only a record created by the current failed output workflow. */
    rollbackArtifact?: () => void | Promise<void>
    /** Immutable enqueue-time output context for durable execution. */
    outputContext?: {
        useAbsoluteScenePath: boolean
        metadataMode: GenerationParams['metadataMode']
        presetName: string
        presetPathSegments?: string[]
        sceneName: string
    }
}

export interface SceneOutputArtifactLineage {
    readonly artifactId: string
    readonly sourceJobId: string
    readonly sourceSceneId: string | null
}

const toDataUrl = (imageData: string, mimeType: string): string =>
    imageData.startsWith('data:') ? imageData : `data:${mimeType};base64,${imageData}`

const toBase64 = (imageData: string): string =>
    imageData.replace(/^data:image\/[^;]+;base64,/, '')

const getFallbackPromptParts = () => {
    const generationState = useGenerationStore.getState()

    return {
        base: generationState.basePrompt,
        additional: generationState.additionalPrompt,
        detail: generationState.detailPrompt,
        negative: generationState.negativePrompt,
        inpainting: generationState.inpaintingPrompt,
    }
}

function sceneOutputDirectory(params: {
    sceneSavePath: string
    useAbsoluteScenePath: boolean
    presetName: string
    presetPathSegments?: readonly string[]
    sceneName: string
    rotationCharacterId?: string
    rotationCharacterFolderName?: string
}): { directory: string; capabilityFallbackDirectory: string; nestedSegments: string[] } {
    const safePresetPath = (params.presetPathSegments?.length
        ? params.presetPathSegments
        : [params.presetName || 'Default'])
        .map(segment => sanitizePathComponent(segment, 'Default'))
    const safeSceneName = sanitizePathComponent(params.sceneName || 'Untitled_Scene', 'Untitled_Scene')
    const safeCharacterName = params.rotationCharacterFolderName
        ? sanitizePathComponent(params.rotationCharacterFolderName, 'Character')
        : getRotationCharacterFolderName(params.rotationCharacterId)
    const nestedSegments = [...safePresetPath, ...(safeCharacterName ? [safeCharacterName] : []), safeSceneName]
    const relativeRoot = sanitizePathComponent(params.sceneSavePath || 'NAIS_Scene', 'NAIS_Scene')
    const relativeDirectory = [relativeRoot, ...nestedSegments].join('/')
    const requestedRoot = params.sceneSavePath.replace(/[\\/]+$/, '')
    return {
        directory: params.useAbsoluteScenePath && requestedRoot
            ? [requestedRoot, ...nestedSegments].join('/')
            : relativeDirectory,
        capabilityFallbackDirectory: ['NAIS_Scene', ...nestedSegments].join('/'),
        nestedSegments,
    }
}

// useSceneGeneration delegates result persistence here after its session checks.
// This file owns the coupled save side effects: disk path, scene image list,
// artifact lifecycle publication, generation history thumbnail, and
// encoded-vibe cache updates back into CharacterStore.
export async function saveSceneResult(
    scene: Pick<SceneCard, 'id' | 'name'>,
    ctx: SaveSceneResultContext,
    finalPrompt: string,
    params: GenerationParams,
    imageData: string,
    mimeType: string,
    encodedVibes?: string[],
    options: SaveSceneResultOptions = {},
): Promise<boolean> {
    const canSave = options.canSave ?? (() => true)
    if (!canSave()) return false

    const currentPreset = useSceneStore.getState().presets.find(p => p.id === ctx.activePresetId)
    const metadataParams: GenerationParams = {
        ...params,
        sentPayloadSummary: options.sentPayloadSummary,
        ...(options.sourceJobId === undefined ? {} : { sourceJobId: options.sourceJobId }),
    }
    const liveSettings = useSettingsStore.getState()
    const useAbsoluteScenePath = options.outputContext?.useAbsoluteScenePath ?? liveSettings.useAbsoluteScenePath
    const metadataMode = options.outputContext?.metadataMode ?? liveSettings.metadataMode
    const presetName = options.outputContext?.presetName ?? currentPreset?.name ?? 'Default'
    const presetPathSegments = options.outputContext?.presetPathSegments
        ?? getScenePresetPathSegments(useSceneStore.getState().presets, ctx.activePresetId)
    const sceneName = options.outputContext?.sceneName ?? scene.name
    const fileExt = params.imageFormat === 'webp' ? 'webp' : 'png'
    const fallbackFileName = `NAIS_SCENE_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const policyFileName = params.outputPolicySummary?.filenameTemplateId
        ? renderFilenameTemplate({
            template: params.outputPolicySummary.filenameTemplateId,
            context: {
                seed: params.seed,
                scene: { id: scene.id, name: scene.name },
                preset: { id: ctx.activePresetId, name: currentPreset?.name || 'Default' },
            },
            fallback: fallbackFileName,
        })
        : null
    const fileName = ensureImageFileExtension(
        params.assetModulePlan?.output.fileName ?? policyFileName ?? fallbackFileName,
        fileExt,
    ) ?? `${fallbackFileName}.${fileExt}`
    const rawDataUrl = toDataUrl(imageData, mimeType)
    const effectiveMetadataMode = params.metadataMode ?? metadataMode
    // strip-only must sanitize provider-owned chunks and stealth pixels before OutputWriter sees bytes.
    const cleanOutput = effectiveMetadataMode === 'strip-only'
        ? await eradicateImageMetadata(rawDataUrl, fileExt)
        : null
    const dataUrl = cleanOutput?.dataUrl ?? rawDataUrl
    const binaryData = cleanOutput?.bytes
        ?? Uint8Array.from(atob(toBase64(imageData)), c => c.charCodeAt(0))
    const destination = sceneOutputDirectory({
        sceneSavePath: ctx.sceneSavePath,
        useAbsoluteScenePath,
        presetName,
        presetPathSegments,
        sceneName,
        rotationCharacterId: ctx.rotationCharacterId,
        rotationCharacterFolderName: ctx.rotationCharacterFolderName,
    })
    let sessionInvalid = false
    let finalizeRejected = false
    let historyId: string | null = null
    let committedPath: string | null = null
    let workflowCommitted = false
    let artifactLineage: SceneOutputArtifactLineage | null = null
    try {
        const output = await getRuntimeOutputWriter().write({
            ...(options.outputTransactionId === undefined
                ? {}
                : { transactionId: options.outputTransactionId }),
            ...(options.sourceJobId === undefined ? {} : { sourceJobId: options.sourceJobId }),
            terminalWorkflowCommit: options.sourceJobId !== undefined,
            includeFinalImageFacts: options.registerArtifact !== undefined,
            destination: {
                ...(params.portableOutputDirectory === undefined
                    ? {}
                    : {
                        portableDirectory: params.portableOutputDirectory.kind === 'standard'
                            ? {
                                kind: 'standard' as const,
                                root: params.portableOutputDirectory.root,
                                segments: [
                                    ...params.portableOutputDirectory.segments,
                                    ...destination.nestedSegments,
                                ],
                            }
                            : {
                                kind: 'bookmark' as const,
                                bookmarkId: params.portableOutputDirectory.bookmarkId,
                                segments: [
                                    ...params.portableOutputDirectory.segments,
                                    ...destination.nestedSegments,
                                ],
                            },
                    }),
                directory: destination.directory,
                useAbsolutePath: useAbsoluteScenePath,
                capabilityFallbackDirectory: destination.capabilityFallbackDirectory,
                workflowDefaultDirectory: 'NAIS_Scene',
                fileName,
                extension: fileExt,
                collisionPolicy: params.outputPolicySummary?.collisionPolicy ?? 'unique',
            },
            imageBytes: binaryData,
            imageDataUrl: dataUrl,
            metadata: {
                params: metadataParams,
                imageFormat: fileExt,
                metadataMode: effectiveMetadataMode,
                fallbackPromptParts: getFallbackPromptParts(),
                includeWebpCompatibilitySidecar: true,
            },
            generateThumbnail: createThumbnail,
            canCommit: canSave,
            commitWorkflow: async outputResult => {
                if (!canSave()) {
                    sessionInvalid = true
                    throw new Error('Scene generation session changed before output publication')
                }
                if (options.beforeFinalize !== undefined && !options.beforeFinalize()) {
                    finalizeRejected = true
                    throw new Error('Fragment sequence changed before Scene output commit')
                }

                artifactLineage = await options.registerArtifact?.(outputResult) ?? null
                committedPath = outputResult.path
                useSceneStore.getState().addImageToScene(ctx.activePresetId, scene.id, outputResult.path)
                historyId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`
                useGenerationStore.getState().addToHistory({
                    id: historyId,
                    url: outputResult.path,
                    thumbnail: outputResult.thumbnailDataUrl,
                    prompt: finalPrompt,
                    seed: params.seed,
                    timestamp: new Date(),
                    sentPayloadSummary: options.sentPayloadSummary,
                    ...(artifactLineage === null
                        ? {}
                        : {
                            artifactId: artifactLineage.artifactId,
                            sourceJobId: artifactLineage.sourceJobId,
                            ...(artifactLineage.sourceSceneId === null ? {} : { sourceSceneId: artifactLineage.sourceSceneId }),
                        }),
                })
                publishGeneratedArtifact({
                    path: outputResult.path,
                    ...(artifactLineage === null
                        ? {}
                        : {
                            artifactId: artifactLineage.artifactId,
                            sourceJobId: artifactLineage.sourceJobId,
                            ...(artifactLineage.sourceSceneId === null ? {} : { sourceSceneId: artifactLineage.sourceSceneId }),
                        }),
                })
                await options.commitDurable?.(outputResult)
                workflowCommitted = true
            },
            rollbackWorkflow: async () => {
                workflowCommitted = false
                if (committedPath !== null) {
                    useSceneStore.setState(state => ({
                        presets: state.presets.map(preset => preset.id === ctx.activePresetId
                            ? {
                                ...preset,
                                scenes: preset.scenes.map(item => item.id === scene.id
                                    ? { ...item, images: item.images.filter(image => image.url !== committedPath) }
                                    : item),
                            }
                            : preset),
                    }))
                }
                if (historyId !== null) {
                    useGenerationStore.setState(state => ({
                        history: state.history.filter(item => item.id !== historyId),
                    }))
                }
                await options.rollbackArtifact?.()
                artifactLineage = null
            },
        })
        if (output.status === 'cancelled') return false
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
    } catch (error) {
        if (sessionInvalid || finalizeRejected || !canSave()) return false
        if (!workflowCommitted) throw error
        console.warn('[SceneGeneration] Output committed; recovery cleanup remains pending.', error)
    }

    try {
        if (encodedVibes && encodedVibes.length > 0) {
            const { vibeImages, updateVibeImage } = useCharacterStore.getState()
            let encodedIndex = 0
            for (let vi = 0; vi < vibeImages.length && encodedIndex < encodedVibes.length; vi++) {
                if (!vibeImages[vi].encodedVibe) {
                    updateVibeImage(vibeImages[vi].id, { encodedVibe: encodedVibes[encodedIndex] })
                    encodedIndex++
                }
            }
        }
    } catch (error) {
        console.warn('[SceneGeneration] Result was saved but encoded-vibe cache update failed.', error)
    }

    return true
}
