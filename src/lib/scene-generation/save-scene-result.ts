import { writeFile } from '@tauri-apps/plugin-fs'
import { createThumbnail } from '@/lib/image-utils'
import { encodeNais2Sidecar } from '@/lib/nais2-png-meta'
import { resolveSceneOutputPath } from '@/lib/scene-output-path'
import { type GenerationParams } from '@/services/novelai-api'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSceneStore, type SceneCard } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import {
    buildNais2Params,
    ensureImageFileExtension,
    shouldWriteNais2Sidecar,
    toSidecarPath,
} from '@/lib/generation-metadata'

export interface SaveSceneResultContext {
    activePresetId: string
    savePath: string
    rotationCharacterId?: string
    rotationCharacterFolderName?: string
}

interface SaveSceneResultOptions {
    canSave?: () => boolean
    sentPayloadSummary?: string
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

async function createSceneThumbnail(dataUrl: string): Promise<string> {
    try {
        return await createThumbnail(dataUrl)
    } catch (error) {
        console.warn('[SceneGeneration] Thumbnail creation failed; using generated image as history fallback.', error)
        return dataUrl
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
    const { useAbsolutePath, metadataMode } = useSettingsStore.getState()
    const fileExt = params.imageFormat === 'webp' ? 'webp' : 'png'
    const fileName = ensureImageFileExtension(params.assetModulePlan?.output.fileName, fileExt)
        ?? `NAIS_SCENE_${Date.now()}_${Math.floor(Math.random() * 10000)}.${fileExt}`
    const dataUrl = toDataUrl(imageData, mimeType)
    const base64Data = toBase64(imageData)
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
    let fullPath: string

    if (!canSave()) return false

    const outputPath = await resolveSceneOutputPath({
        savePath: ctx.savePath,
        useAbsolutePath,
        presetName: currentPreset?.name || 'Default',
        sceneName: scene.name,
        fileName,
        rotationCharacterId: ctx.rotationCharacterId,
        rotationCharacterFolderName: ctx.rotationCharacterFolderName,
    })
    const writeGeneratedFile = async (path: string, data: Uint8Array): Promise<void> => {
        if (outputPath.baseDir !== undefined) {
            await writeFile(path, data, { baseDir: outputPath.baseDir })
        } else {
            await writeFile(path, data)
        }
    }
    fullPath = outputPath.fullPath

    await writeGeneratedFile(outputPath.writePath, binaryData)
    if (shouldWriteNais2Sidecar(params.metadataMode ?? metadataMode, params.imageFormat, true)) {
        // WebP cannot store the PNG tEXt chunk from nais2-png-meta.ts. Sidecar
        // metadata is also used by explicit sidecar-only metadata modes.
        await writeGeneratedFile(
            toSidecarPath(outputPath.writePath),
            encodeNais2Sidecar(buildNais2Params(metadataParams, getFallbackPromptParts())),
        )
    }

    const thumbnailData = await createSceneThumbnail(dataUrl)
    if (!canSave()) return false

    window.dispatchEvent(new CustomEvent('newImageGenerated', {
        detail: { path: fullPath },
    }))

    useSceneStore.getState().addImageToScene(ctx.activePresetId, scene.id, fullPath)
    useGenerationStore.getState().addToHistory({
        id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        url: fullPath,
        thumbnail: thumbnailData,
        prompt: finalPrompt,
        seed: params.seed,
        timestamp: new Date(),
        sentPayloadSummary: options.sentPayloadSummary,
    })

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

    return true
}
