import { describe, expect, it } from 'vitest'

import {
    buildGenerateImagePayload,
    type GenerationRequest,
} from '@/services/nai/payload'

const request = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
    prompt: 'portrait',
    negativePrompt: '',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfgScale: 7.2,
    cfgRescale: 0.1,
    sampler: 'k_euler',
    noiseSchedule: 'karras',
    seed: 1,
    variety: true,
    qualityToggle: false,
    ucPreset: 4,
    characterPrompts: [],
    useCoords: false,
    ...overrides,
})

describe('NovelAI legacy Variety+ payload', () => {
    it('uses the V4.5 base coefficient and official image-area scaling', () => {
        const reference = buildGenerateImagePayload(request())
        const square = buildGenerateImagePayload(request({ width: 1024, height: 1024 }))

        expect(reference.parameters.skip_cfg_above_sigma).toBe(58)
        expect(square.parameters.skip_cfg_above_sigma).toBeCloseTo(
            58 * Math.sqrt((1024 * 1024) / (832 * 1216)),
            12,
        )
    })

    it('omits the supported V4.5 key when Variety+ is off', () => {
        const payload = buildGenerateImagePayload(request({ variety: false }))

        expect(payload.parameters).not.toHaveProperty('skip_cfg_above_sigma')
    })
})
