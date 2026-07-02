import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { type SceneCard } from '@/stores/scene-store'
import { type GenerationParams } from '@/services/novelai-api'
import { processWildcards } from '@/lib/fragment-processor'
import { useRotationStore } from '@/stores/character-rotation-store'

export interface SceneGenerationBuildResult {
    params: GenerationParams
    finalPrompt: string
    mimeType: string
}

const roundTo64 = (value: number): number => Math.round(value / 64) * 64

const removeComments = (text: string) => text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n')

// useSceneGeneration workers call this helper before the NovelAI API request.
// It keeps B's existing scene parameter sources together: generation settings,
// character/vibe image memory, scene text, and rotation pinned-character state.
export async function buildSceneGenerationParams(scene: SceneCard): Promise<SceneGenerationBuildResult> {
    const genState = useGenerationStore.getState()

    const parts = [
        removeComments(genState.basePrompt),
        genState.i2iMode === 'inpaint' ? removeComments(genState.inpaintingPrompt) : null,
        removeComments(genState.additionalPrompt),
        removeComments(scene.scenePrompt),
        removeComments(genState.detailPrompt),
    ].filter(p => p && p.trim())

    const finalPrompt = await processWildcards(parts.join(', '))

    // CharacterStore owns lazy file-backed image loading. Workers must force
    // this load before building char/vibe arrays, and useSceneGeneration later
    // releases the same data once the last worker exits.
    await useCharacterStore.getState().ensureImagesLoaded()
    const latestCharStore = useCharacterStore.getState()
    const characterImages = latestCharStore.characterImages.filter(img => img.enabled !== false && img.base64)
    const vibeImages = latestCharStore.vibeImages.filter(img => img.enabled !== false && img.base64)
    const { characters: characterPrompts, positionEnabled } = useCharacterPromptStore.getState()
    const rotation = useRotationStore.getState()
    const excludedPinnedIds = rotation.active && scene.excludePinned
        ? new Set(rotation.pinnedCharacterIds)
        : null

    const processedCharacterPrompts = await Promise.all(
        characterPrompts
            .filter(c => c.enabled && !(excludedPinnedIds?.has(c.id)))
            .map(async c => ({
                prompt: await processWildcards(c.prompt),
                negative: await processWildcards(c.negative),
                enabled: c.enabled,
                position: c.position,
            }))
    )

    let finalSeed = genState.seedLocked ? genState.seed : Math.floor(Math.random() * 4294967295)
    if (finalSeed === 0) {
        finalSeed = Math.floor(Math.random() * 4294967295)
    }

    let finalWidth = roundTo64(scene.width || genState.selectedResolution.width)
    let finalHeight = roundTo64(scene.height || genState.selectedResolution.height)

    if (genState.sourceImage) {
        try {
            const img = new Image()
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve()
                img.onerror = () => reject(new Error('Failed to load source image'))
                img.src = genState.sourceImage!
            })
            finalWidth = roundTo64(img.width)
            finalHeight = roundTo64(img.height)
            console.log(`[SceneGeneration] Using source image dimensions: ${img.width}x${img.height} -> ${finalWidth}x${finalHeight}`)
            img.src = ''
        } catch {
            console.warn('[SceneGeneration] Failed to get source image dimensions, using scene/global resolution')
        }
    }

    const imageFormat = useSettingsStore.getState().imageFormat
    const mimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
    const characterImagesWithData = characterImages.filter(img => img.base64)
    const vibeImagesWithData = vibeImages.filter(img => img.base64)

    return {
        finalPrompt,
        mimeType,
        params: {
            prompt: finalPrompt,
            negative_prompt: removeComments(genState.negativePrompt),
            steps: genState.steps,
            cfg_scale: genState.cfgScale,
            cfg_rescale: genState.cfgRescale,
            sampler: genState.sampler,
            scheduler: genState.scheduler,
            smea: genState.smea,
            smea_dyn: genState.smeaDyn,
            variety: genState.variety ?? false,
            seed: finalSeed,
            width: finalWidth,
            height: finalHeight,
            model: genState.model,
            sourceImage: genState.sourceImage || undefined,
            strength: genState.strength,
            noise: genState.noise,
            mask: genState.mask || undefined,
            charImages: characterImagesWithData.map(img => img.base64!),
            charStrength: characterImagesWithData.map(img => img.strength),
            charFidelity: characterImagesWithData.map(img => img.fidelity ?? 0.6),
            charReferenceType: characterImagesWithData.map(img => img.referenceType ?? 'character&style'),
            charCacheKeys: characterImagesWithData.map(img => img.cacheKey || null),
            vibeImages: vibeImagesWithData.map(img => img.base64!),
            vibeInfo: vibeImagesWithData.map(img => img.informationExtracted),
            vibeStrength: vibeImagesWithData.map(img => img.strength),
            preEncodedVibes: vibeImagesWithData.map(img => img.encodedVibe || null),
            characterPrompts: processedCharacterPrompts,
            characterPositionEnabled: positionEnabled,
            imageFormat,
        },
    }
}
