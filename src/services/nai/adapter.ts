import type { BuildOptions, GenerationRequest } from '@/services/nai/payload'
import {
    getNovelAiModelProfile,
    isNovelAiV5Model,
} from '@/services/nai/model-catalog'
import type { UcPresetIndex } from '@/services/nai/presets'
import { prepareReferences } from '@/services/nai/refs'
import type { GenerationParams } from '@/services/novelai-types'

export interface AdaptedGenerationParams {
    request: GenerationRequest
    buildOptions: BuildOptions
    encodedVibes: string[]
}

export class NovelAiModelCapabilityError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'NovelAiModelCapabilityError'
    }
}

function normalizeUcPreset(value: number | undefined): UcPresetIndex {
    return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 ? value : 0
}

export async function adaptGenerationParams(
    token: string,
    params: GenerationParams,
    stream?: 'msgpack',
): Promise<AdaptedGenerationParams> {
    const profile = getNovelAiModelProfile(params.model)
    if (profile === undefined) {
        throw new NovelAiModelCapabilityError(`지원하지 않는 NovelAI 이미지 모델입니다: ${params.model}`)
    }
    if ((params.vibeImages?.length ?? 0) > 0 && !profile.capabilities.vibeTransfer) {
        throw new NovelAiModelCapabilityError('NAI Diffusion V5는 아직 Vibe Transfer를 지원하지 않습니다.')
    }
    if ((params.charImages?.length ?? 0) > 0 && !profile.capabilities.preciseReference) {
        throw new NovelAiModelCapabilityError('NAI Diffusion V5는 아직 Precise Reference를 지원하지 않습니다.')
    }
    if (params.transparentBackground === true && !profile.capabilities.transparentBackground) {
        throw new NovelAiModelCapabilityError('투명 배경은 NAI Diffusion V5에서만 사용할 수 있습니다.')
    }
    const activeCharacterCount = (params.characterPrompts ?? [])
        .filter(character => character.enabled && character.prompt.trim()).length
    if (profile.capabilities.maxCharacters !== undefined
        && activeCharacterCount > profile.capabilities.maxCharacters) {
        throw new NovelAiModelCapabilityError(
            `NAI Diffusion V5의 캐릭터 프롬프트는 최대 ${profile.capabilities.maxCharacters}개입니다.`,
        )
    }

    const refs = await prepareReferences(token, params)
    const model = refs.source?.maskBase64
        ? profile.inpaintModelId
        : profile.modelId

    const request: GenerationRequest = {
        prompt: params.prompt,
        negativePrompt: params.negative_prompt,
        model,
        width: refs.source?.width ?? params.width,
        height: refs.source?.height ?? params.height,
        steps: params.steps,
        cfgScale: params.cfg_scale,
        cfgRescale: params.cfg_rescale,
        sampler: params.sampler,
        // The launch V5 frontend normalizes requests to Karras. Existing
        // V4/V4.5 documents retain their selected schedule unchanged.
        noiseSchedule: isNovelAiV5Model(model) ? 'karras' : params.scheduler,
        seed: params.seed,
        variety: params.variety,
        smea: params.smea,
        smeaDyn: params.smea_dyn,
        qualityToggle: params.qualityToggle ?? false,
        ucPreset: normalizeUcPreset(params.ucPreset),
        transparentBackground: params.transparentBackground ?? false,
        characterPrompts: (params.characterPrompts ?? [])
            .filter(char => char.enabled && char.prompt.trim())
            .map(char => ({
                prompt: char.prompt,
                negativePrompt: char.negative ?? '',
                enabled: true,
                center: { x: char.position.x, y: char.position.y },
            })),
        useCoords: params.characterPositionEnabled ?? false,
    }

    return {
        request,
        buildOptions: {
            imageFormat: params.imageFormat ?? 'png',
            vibes: refs.vibes,
            characterReferences: refs.characterReferences,
            i2i: refs.source?.i2i,
            stream,
        },
        encodedVibes: refs.newlyEncodedVibes,
    }
}
