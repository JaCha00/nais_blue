import type { BuildOptions, GenerationRequest } from '@/services/nai/payload'
import type { UcPresetIndex } from '@/services/nai/presets'
import { prepareReferences } from '@/services/nai/refs'
import type { GenerationParams } from '@/services/novelai-types'

export interface AdaptedGenerationParams {
    request: GenerationRequest
    buildOptions: BuildOptions
    encodedVibes: string[]
}

function normalizeUcPreset(value: number | undefined): UcPresetIndex {
    return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 ? value : 0
}

export async function adaptGenerationParams(
    token: string,
    params: GenerationParams,
    stream?: 'msgpack',
): Promise<AdaptedGenerationParams> {
    const refs = await prepareReferences(token, params)
    const model = refs.source?.maskBase64 && !params.model.includes('inpainting')
        ? `${params.model}-inpainting`
        : params.model

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
        noiseSchedule: params.scheduler,
        seed: params.seed,
        variety: params.variety,
        qualityToggle: params.qualityToggle ?? false,
        ucPreset: normalizeUcPreset(params.ucPreset),
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
