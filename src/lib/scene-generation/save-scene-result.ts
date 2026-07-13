import { createThumbnail } from '@/lib/image-utils'
import { getRotationCharacterFolderName, sanitizePathComponent } from '@/lib/scene-output-path'
import { type GenerationParams } from '@/services/novelai-api'
import { ensureImageFileExtension, renderFilenameTemplate } from '@/services/output/filename-policy'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSceneStore, type SceneCard } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'

export interface SaveSceneResultContext {
    activePresetId: string
    sceneSavePath: string
    rotationCharacterId?: string
    rotationCharacterFolderName?: string
}

interface SaveSceneResultOptions {
    canSave?: () => boolean
    sentPayloadSummary?: string
    /**
     * Synchronous publish gate. Fragment sequence leases commit here only after
     * durable output and thumbnail work succeeded, with no await before the
     * scene/history publication below.
     */
    beforeFinalize?: () => boolean
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
    sceneName: string
    rotationCharacterId?: string
    rotationCharacterFolderName?: string
}): { directory: string; capabilityFallbackDirectory: string; nestedSegments: string[] } {
    const safePresetName = sanitizePathComponent(params.presetName || 'Default', 'Default')
    const safeSceneName = sanitizePathComponent(params.sceneName || 'Untitled_Scene', 'Untitled_Scene')
    const safeCharacterName = params.rotationCharacterFolderName
        ? sanitizePathComponent(params.rotationCharacterFolderName, 'Character')
        : getRotationCharacterFolderName(params.rotationCharacterId)
    const nestedSegments = [safePresetName, ...(safeCharacterName ? [safeCharacterName] : []), safeSceneName]
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
// HistoryPanel's newImageGenerated event, generation history thumbnail, and
// encoded-vibe cache updates back into CharacterStore.
export async function saveSceneResult(
    scene: SceneCard,
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
    }
    const { useAbsoluteScenePath, metadataMode } = useSettingsStore.getState()
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
    const dataUrl = toDataUrl(imageData, mimeType)
    const base64Data = toBase64(imageData)
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
    const destination = sceneOutputDirectory({
        sceneSavePath: ctx.sceneSavePath,
        useAbsoluteScenePath,
        presetName: currentPreset?.name || 'Default',
        sceneName: scene.name,
        rotationCharacterId: ctx.rotationCharacterId,
        rotationCharacterFolderName: ctx.rotationCharacterFolderName,
    })
    let sessionInvalid = false
    let finalizeRejected = false
    let historyId: string | null = null
    let committedPath: string | null = null
    let workflowCommitted = false
    try {
        const output = await getRuntimeOutputWriter().write({
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
                metadataMode: params.metadataMode ?? metadataMode,
                fallbackPromptParts: getFallbackPromptParts(),
                includeWebpCompatibilitySidecar: true,
            },
            generateThumbnail: createThumbnail,
            canCommit: canSave,
            commitWorkflow: outputResult => {
                if (!canSave()) {
                    sessionInvalid = true
                    throw new Error('Scene generation session changed before output publication')
                }
                if (options.beforeFinalize !== undefined && !options.beforeFinalize()) {
                    finalizeRejected = true
                    throw new Error('Fragment sequence changed before Scene output commit')
                }

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
                })
                try {
                    window.dispatchEvent(new CustomEvent('newImageGenerated', {
                        detail: { path: outputResult.path },
                    }))
                } catch (eventError) {
                    console.warn('[SceneGeneration] Failed to publish the committed output event.', eventError)
                }
                workflowCommitted = true
            },
            rollbackWorkflow: () => {
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
