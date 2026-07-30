import type { SceneResultPresentationPort } from '@/application/scene/scene-result-presentation-port'
import { createThumbnail } from '@/lib/image-utils'
import { getRotationCharacterFolderName, sanitizePathComponent } from '@/lib/scene-output-path'
import { type GenerationParams } from '@/services/novelai-api'
import { ensureImageFileExtension, renderFilenameTemplate } from '@/services/output/filename-policy'
import { getRuntimeOutputWriter, type OutputWriteResult } from '@/services/output/output-writer'

export interface SaveSceneResultScene {
    readonly id: string
    readonly name: string
}

export interface SaveSceneResultContext {
    activePresetId: string
    sceneSavePath: string
    rotationCharacterId?: string
    rotationCharacterFolderName?: string
}

export interface SaveSceneResultOptions {
    presentation: SceneResultPresentationPort
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

// Both Scene runtimes delegate their output transaction here after session
// checks. UI read-model updates cross the injected Presentation port so this
// shared transaction never imports Zustand, components, or notifications.
export async function saveSceneResult(
    scene: SaveSceneResultScene,
    ctx: SaveSceneResultContext,
    finalPrompt: string,
    params: GenerationParams,
    imageData: string,
    mimeType: string,
    encodedVibes: readonly string[] | undefined,
    options: SaveSceneResultOptions,
): Promise<boolean> {
    const canSave = options.canSave ?? (() => true)
    if (!canSave()) return false

    const presentation = options.presentation
    const outputDefaults = presentation.readOutputDefaults(ctx.activePresetId)
    const metadataParams: GenerationParams = {
        ...params,
        sentPayloadSummary: options.sentPayloadSummary,
        ...(options.sourceJobId === undefined ? {} : { sourceJobId: options.sourceJobId }),
    }
    const useAbsoluteScenePath = options.outputContext?.useAbsoluteScenePath ?? outputDefaults.useAbsoluteScenePath
    const metadataMode = options.outputContext?.metadataMode ?? outputDefaults.metadataMode
    const presetName = options.outputContext?.presetName ?? outputDefaults.presetName
    const presetPathSegments = options.outputContext?.presetPathSegments
        ?? outputDefaults.presetPathSegments
    const sceneName = options.outputContext?.sceneName ?? scene.name
    const fileExt = params.imageFormat === 'webp' ? 'webp' : 'png'
    const fallbackFileName = `NAIS_SCENE_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const policyFileName = params.outputPolicySummary?.filenameTemplateId
        ? renderFilenameTemplate({
            template: params.outputPolicySummary.filenameTemplateId,
            context: {
                seed: params.seed,
                scene: { id: scene.id, name: scene.name },
                preset: { id: ctx.activePresetId, name: presetName },
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
    // OutputWriter owns metadata sanitization for every workflow and both strip modes.
    const dataUrl = rawDataUrl
    const binaryData = Uint8Array.from(atob(toBase64(imageData)), c => c.charCodeAt(0))
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
                fallbackPromptParts: outputDefaults.fallbackPromptParts,
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
                historyId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`
                presentation.commitResult({
                    historyId,
                    presetId: ctx.activePresetId,
                    sceneId: scene.id,
                    path: outputResult.path,
                    thumbnail: outputResult.thumbnailDataUrl,
                    prompt: finalPrompt,
                    seed: params.seed,
                    sentPayloadSummary: options.sentPayloadSummary,
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
                    presentation.rollbackResult({
                        presetId: ctx.activePresetId,
                        sceneId: scene.id,
                        path: committedPath,
                        historyId,
                    })
                }
                await options.rollbackArtifact?.()
                artifactLineage = null
            },
        })
        if (output.status === 'cancelled') return false
        if (output.result.capabilityFallbackUsed) {
            presentation.reportCapabilityFallback(
                output.result.capabilityFallbackReason,
                output.result.capabilityFallbackAlternative,
            )
        }
    } catch (error) {
        if (sessionInvalid || finalizeRejected || !canSave()) return false
        if (!workflowCommitted) throw error
        console.warn('[SceneGeneration] Output committed; recovery cleanup remains pending.', error)
    }

    try {
        if (encodedVibes && encodedVibes.length > 0) {
            presentation.updateEncodedVibes(encodedVibes)
        }
    } catch (error) {
        console.warn('[SceneGeneration] Result was saved but encoded-vibe cache update failed.', error)
    }

    return true
}
