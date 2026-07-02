import { BaseDirectory, exists, mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { join, pictureDir } from '@tauri-apps/api/path'
import { buildStyleLabPrompt, formatWeightedArtistTags } from '@/lib/style-lab'
import { processWildcards } from '@/lib/fragment-processor'
import { createThumbnail } from '@/lib/image-utils'
import { GenerationParams, generateImage, generateImageStream } from '@/services/novelai-api'
import { useAuthStore } from '@/stores/auth-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { StyleCombination, useStyleLabStore } from '@/stores/style-lab-store'
import { toast } from '@/components/ui/use-toast'
import i18n from '@/i18n'

let styleLabGenerationLock = false

function removeComments(text: string): string {
    return text
        .split('\n')
        .filter(line => !line.trimStart().startsWith('#'))
        .join('\n')
}

function roundTo64(value: number): number {
    return Math.round(value / 64) * 64
}

function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            const size = { width: img.width, height: img.height }
            img.src = ''
            resolve(size)
        }
        img.onerror = () => {
            img.src = ''
            reject(new Error('Failed to load source image'))
        }
        img.src = base64
    })
}

async function saveStyleLabImage(imageData: string, imageUrl: string, finalPrompt: string, seed: number): Promise<string> {
    const { savePath, autoSave, useAbsolutePath, imageFormat } = useSettingsStore.getState()
    const fileExt = imageFormat === 'webp' ? 'webp' : 'png'

    if (!autoSave) {
        const memoryPath = `memory://NAIS_STYLELAB_${Date.now()}.${fileExt}`
        window.dispatchEvent(new CustomEvent('newImageGenerated', {
            detail: { path: memoryPath, data: imageUrl }
        }))
        return memoryPath
    }

    const binaryString = atob(imageData.replace(/^data:image\/(png|webp);base64,/, ''))
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }

    const fileName = `NAIS_STYLELAB_${Date.now()}.${fileExt}`
    const outputDir = savePath || 'NAIS_Output'
    let fullPath: string

    if (useAbsolutePath) {
        if (!(await exists(outputDir))) {
            await mkdir(outputDir, { recursive: true })
        }
        fullPath = await join(outputDir, fileName)
        await writeFile(fullPath, bytes)
    } else {
        if (!(await exists(outputDir, { baseDir: BaseDirectory.Picture }))) {
            await mkdir(outputDir, { baseDir: BaseDirectory.Picture })
        }
        await writeFile(`${outputDir}/${fileName}`, bytes, { baseDir: BaseDirectory.Picture })
        const picPath = await pictureDir()
        fullPath = await join(picPath, outputDir, fileName)
    }

    window.dispatchEvent(new CustomEvent('newImageGenerated', {
        detail: { path: fullPath }
    }))

    const thumbnail = await createThumbnail(imageUrl)
    useGenerationStore.getState().addToHistory({
        id: Date.now().toString(),
        url: fullPath,
        thumbnail,
        prompt: finalPrompt,
        seed,
        timestamp: new Date(),
    })

    return fullPath
}

async function buildGenerationParams(combo: StyleCombination): Promise<{ params: GenerationParams; prompt: string; seed: number }> {
    const genState = useGenerationStore.getState()
    const styleState = useStyleLabStore.getState()

    const artistTags = formatWeightedArtistTags(combo.tags)
    const templatedPrompt = buildStyleLabPrompt(styleState.settings.promptTemplate, artistTags, {
        basePrompt: removeComments(genState.basePrompt),
        additionalPrompt: removeComments(genState.additionalPrompt),
        detailPrompt: removeComments(genState.detailPrompt),
        inpaintingPrompt: removeComments(genState.inpaintingPrompt),
    })
    const finalPrompt = await processWildcards(templatedPrompt)

    let seed = genState.seedLocked ? genState.seed : Math.floor(Math.random() * 4294967295)
    if (seed === 0) seed = Math.floor(Math.random() * 4294967295)

    await useCharacterStore.getState().ensureImagesLoaded()
    const characterState = useCharacterStore.getState()
    const characterImages = characterState.characterImages.filter(img => img.enabled !== false && img.base64)
    const vibeImages = characterState.vibeImages.filter(img => img.enabled !== false && img.base64)

    const { characters, positionEnabled } = useCharacterPromptStore.getState()
    const processedCharacterPrompts = await Promise.all(
        characters.filter(character => character.enabled).map(async character => ({
            ...character,
            prompt: await processWildcards(character.prompt),
            negative: await processWildcards(character.negative),
        }))
    )

    let width = roundTo64(genState.selectedResolution.width)
    let height = roundTo64(genState.selectedResolution.height)

    if (genState.sourceImage) {
        try {
            const dimensions = await getImageDimensions(genState.sourceImage)
            width = roundTo64(dimensions.width)
            height = roundTo64(dimensions.height)
        } catch (error) {
            console.warn('[StyleLab] Failed to read source image dimensions:', error)
        }
    }

    const { imageFormat } = useSettingsStore.getState()

    return {
        prompt: finalPrompt,
        seed,
        params: {
            prompt: finalPrompt,
            negative_prompt: removeComments(genState.negativePrompt),
            model: genState.model,
            width,
            height,
            steps: genState.steps,
            cfg_scale: genState.cfgScale,
            cfg_rescale: genState.cfgRescale,
            sampler: genState.sampler,
            scheduler: genState.scheduler,
            smea: genState.smea,
            smea_dyn: genState.smeaDyn,
            variety: genState.variety,
            seed,
            sourceImage: genState.sourceImage || undefined,
            strength: genState.strength,
            noise: genState.noise,
            mask: genState.mask || undefined,
            charImages: characterImages.map(img => img.base64!),
            charStrength: characterImages.map(img => img.strength),
            charFidelity: characterImages.map(img => img.fidelity ?? 0.6),
            charReferenceType: characterImages.map(img => img.referenceType ?? 'character&style'),
            charCacheKeys: characterImages.map(img => img.cacheKey || null),
            vibeImages: vibeImages.map(img => img.base64!),
            vibeInfo: vibeImages.map(img => img.informationExtracted),
            vibeStrength: vibeImages.map(img => img.strength),
            preEncodedVibes: vibeImages.map(img => img.encodedVibe || null),
            characterPrompts: processedCharacterPrompts,
            characterPositionEnabled: positionEnabled,
            imageFormat,
            qualityToggle: genState.qualityToggle,
            ucPreset: genState.ucPreset,
            promptParts: {
                base: finalPrompt,
                additional: '',
                detail: '',
                negative: genState.negativePrompt,
                inpainting: genState.inpaintingPrompt,
            },
        },
    }
}

export async function generateStyleLabPreviews(combinationIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(combinationIds)]
    if (uniqueIds.length === 0) return

    const authState = useAuthStore.getState()
    if (!authState.token || !authState.isVerified) {
        toast({
            title: i18n.t('toast.tokenRequired.title', '토큰 필요'),
            description: i18n.t('toast.tokenRequired.desc', 'NovelAI API 토큰을 먼저 인증해주세요.'),
            variant: 'destructive',
        })
        return
    }

    const generationState = useGenerationStore.getState()
    if (styleLabGenerationLock || (generationState.generatingMode && generationState.generatingMode !== 'styleLab')) {
        toast({
            title: i18n.t('common.error', '오류'),
            description: '다른 이미지 생성 작업이 끝난 뒤 다시 시도해주세요.',
            variant: 'destructive',
        })
        return
    }

    styleLabGenerationLock = true
    useStyleLabStore.getState().setPreviewQueueState(true, uniqueIds.length, 0)
    useGenerationStore.setState({
        isGenerating: true,
        generatingMode: 'styleLab',
        isCancelled: false,
        streamProgress: 0,
    })

    try {
        for (let index = 0; index < uniqueIds.length; index++) {
            const id = uniqueIds[index]
            const combo = useStyleLabStore.getState().combinations.find(item => item.id === id)
            if (!combo) continue

            useStyleLabStore.getState().updateCombinationPreview(id, {
                isPreviewing: true,
                previewProgress: 0,
                previewError: undefined,
            })

            try {
                const { params, prompt, seed } = await buildGenerationParams(combo)
                const { useStreaming, imageFormat } = useSettingsStore.getState()
                const mimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                const result = useStreaming
                    ? await generateImageStream(authState.token, params, (progress, partialImage) => {
                        useGenerationStore.getState().setStreamProgress(progress)
                        useStyleLabStore.getState().updateCombinationPreview(id, {
                            previewProgress: progress / 100,
                            previewImage: partialImage ? `data:${mimeType};base64,${partialImage}` : undefined,
                        })
                    })
                    : await generateImage(authState.token, params)

                useGenerationStore.getState().setStreamProgress(0)

                if (!result.success || !result.imageData) {
                    throw new Error(result.error || '이미지 생성에 실패했습니다.')
                }

                const imageUrl = `data:${mimeType};base64,${result.imageData}`
                let previewPath: string | undefined
                try {
                    previewPath = await saveStyleLabImage(result.imageData, imageUrl, prompt, seed)
                } catch (saveError) {
                    console.warn('[StyleLab] Failed to save preview image:', saveError)
                    const memoryPath = `memory://NAIS_STYLELAB_${Date.now()}.${imageFormat}`
                    window.dispatchEvent(new CustomEvent('newImageGenerated', {
                        detail: { path: memoryPath, data: imageUrl }
                    }))
                    previewPath = memoryPath
                }

                useStyleLabStore.getState().updateCombinationPreview(id, {
                    previewImage: imageUrl,
                    previewPath,
                    previewSeed: seed,
                    previewPrompt: prompt,
                    previewProgress: 1,
                    isPreviewing: false,
                })

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
                console.error('[StyleLab] Preview generation failed:', error)
                useStyleLabStore.getState().updateCombinationPreview(id, {
                    isPreviewing: false,
                    previewProgress: 0,
                    previewError: String(error),
                })
                toast({
                    title: '연구소 프리뷰 생성 실패',
                    description: String(error),
                    variant: 'destructive',
                })
            }

            useStyleLabStore.getState().setPreviewQueueState(true, uniqueIds.length, index + 1)

            if (index < uniqueIds.length - 1) {
                const styleDelay = useStyleLabStore.getState().settings.previewDelayMs
                const globalDelay = useSettingsStore.getState().generationDelay
                const delay = Math.max(250, styleDelay, globalDelay)
                await new Promise(resolve => setTimeout(resolve, delay))
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
