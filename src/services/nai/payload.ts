import { mergeQualityTags, mergeUcPreset, removeComments, type UcPresetIndex } from '@/services/nai/presets'

export interface CharacterPromptInput {
    prompt: string
    negativePrompt: string
    enabled: boolean
    center?: { x: number; y: number }
}

export interface GenerationRequest {
    prompt: string
    negativePrompt: string
    model: string
    width: number
    height: number
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    noiseSchedule: string
    seed: number
    variety: boolean
    qualityToggle: boolean
    ucPreset: UcPresetIndex
    characterPrompts: CharacterPromptInput[]
    useCoords: boolean
}

export interface I2iOptions {
    strength: number
    noise: number
    extraNoiseSeed: number
    colorCorrect: boolean
    imageBase64: string
    maskBase64?: string
}

export interface CharacterReferenceOptions {
    referenceType: 'character' | 'style' | 'character&style' | 'costume' | 'delta'
    strength: number
    fidelity: number
    cacheSecretKey?: string
    imageBase64?: string
}

export interface VibeOptions {
    strength: number
    encodedVibeBase64: string
}

export interface BuildOptions {
    stream?: 'msgpack'
    i2i?: I2iOptions
    characterReferences?: CharacterReferenceOptions[]
    vibes?: VibeOptions[]
    imageFormat?: 'png' | 'webp'
}

export interface NaiImagePayload {
    action: 'generate' | 'img2img' | 'infill'
    input: string
    model: string
    parameters: Record<string, unknown>
}

export function varietySigma(opts: {
    model: string
    variety: boolean
    width: number
    height: number
}): number | null {
    if (!opts.variety) return null
    const coef = opts.model.includes('nai-diffusion-4-5') ? 58 : 19
    return coef * Math.sqrt((opts.width * opts.height) / (832 * 1216))
}

export function buildGenerateImagePayload(
    req: GenerationRequest,
    opts: BuildOptions = {},
): NaiImagePayload {
    const prompt = mergeQualityTags(removeComments(req.prompt), req.qualityToggle)
    const negative = mergeUcPreset(removeComments(req.negativePrompt), req.ucPreset)
    const activeChars = req.characterPrompts.filter(char => char.enabled && char.prompt.trim())
    const center = (char: CharacterPromptInput) =>
        req.useCoords ? (char.center ?? { x: 0.5, y: 0.5 }) : { x: 0.5, y: 0.5 }
    const action = opts.i2i ? (opts.i2i.maskBase64 ? 'infill' : 'img2img') : 'generate'

    return {
        action,
        input: prompt,
        model: req.model,
        parameters: {
            params_version: 3,
            width: req.width,
            height: req.height,
            n_samples: 1,
            seed: req.seed,
            sampler: req.sampler,
            steps: req.steps,
            scale: req.cfgScale,
            negative_prompt: negative,
            cfg_rescale: req.cfgRescale,
            noise_schedule: req.noiseSchedule,
            legacy: false,
            legacy_v3_extend: false,
            dynamic_thresholding: false,
            skip_cfg_above_sigma: varietySigma(req),
            add_original_image: true,
            prefer_brownian: true,
            ucPreset: req.ucPreset,
            use_coords: req.useCoords,
            qualityToggle: req.qualityToggle,
            autoSmea: false,
            controlnet_strength: 1,
            normalize_reference_strength_multiple: true,
            inpaintImg2ImgStrength: opts.i2i?.maskBase64 ? opts.i2i.strength : 1,
            deliberate_euler_ancestral_bug: false,
            image_format: opts.imageFormat ?? 'png',
            ...(opts.stream ? { stream: opts.stream } : {}),
            ...(opts.i2i
                ? opts.i2i.maskBase64
                    ? {
                        request_type: 'NativeInfillingRequest',
                        image: opts.i2i.imageBase64,
                        mask: opts.i2i.maskBase64,
                        noise: opts.i2i.noise,
                    }
                    : {
                        image: opts.i2i.imageBase64,
                        strength: opts.i2i.strength,
                        noise: opts.i2i.noise,
                        extra_noise_seed: opts.i2i.extraNoiseSeed,
                        color_correct: opts.i2i.colorCorrect,
                    }
                : {}),
            v4_prompt: {
                caption: {
                    base_caption: prompt,
                    char_captions: activeChars.map(char => ({
                        char_caption: removeComments(char.prompt),
                        centers: [center(char)],
                    })),
                },
                use_coords: req.useCoords,
                use_order: true,
            },
            v4_negative_prompt: {
                caption: {
                    base_caption: negative,
                    char_captions: activeChars.map(char => ({
                        char_caption: removeComments(char.negativePrompt),
                        centers: [center(char)],
                    })),
                },
            },
            characterPrompts: activeChars.map(char => ({
                prompt: removeComments(char.prompt),
                uc: removeComments(char.negativePrompt),
                center: center(char),
                enabled: true,
            })),
            ...(opts.vibes?.length
                ? {
                    reference_image_multiple: opts.vibes.map(vibe => vibe.encodedVibeBase64),
                    reference_strength_multiple: opts.vibes.map(vibe => vibe.strength),
                }
                : {}),
            ...(opts.characterReferences?.length
                ? {
                    director_reference_descriptions: opts.characterReferences.map(ref => ({
                        caption: { base_caption: ref.referenceType, char_captions: [] },
                    })),
                    director_reference_information_extracted: opts.characterReferences.map(() => 1),
                    director_reference_strength_values: opts.characterReferences.map(ref => ref.strength),
                    director_reference_secondary_strength_values: opts.characterReferences.map(ref => 1 - ref.fidelity),
                    ...(opts.characterReferences.some(ref => ref.cacheSecretKey)
                        ? {
                            director_reference_images_cached: opts.characterReferences
                                .filter(ref => ref.cacheSecretKey)
                                .map(ref => ({ cache_secret_key: ref.cacheSecretKey })),
                        }
                        : {}),
                    ...(opts.characterReferences.some(ref => ref.imageBase64)
                        ? {
                            director_reference_images: opts.characterReferences
                                .filter(ref => ref.imageBase64)
                                .map(ref => ref.imageBase64),
                        }
                        : {}),
                }
                : {}),
        },
    }
}
