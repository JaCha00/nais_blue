import { describe, expect, it } from 'vitest'

import {
    buildGenerateImagePayload,
    type GenerationRequest,
} from '@/services/nai/payload'
import { UC_PRESETS_V5 } from '@/services/nai/presets'

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
    return {
        prompt: '1girl, blue hair',
        negativePrompt: 'extra fingers',
        model: 'nai-diffusion-5-full',
        width: 832,
        height: 1216,
        steps: 28,
        cfgScale: 5,
        cfgRescale: 0,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'karras',
        seed: 1,
        variety: false,
        smea: true,
        smeaDyn: true,
        qualityToggle: true,
        ucPreset: 0,
        characterPrompts: [],
        useCoords: false,
        ...overrides,
    }
}

describe('NovelAI V5 payload', () => {
    it.each(['nai-diffusion-5-full', 'nai-diffusion-5-curated']) (
        'uses the captured V5 prompt hints for %s',
        model => {
            const payload = buildGenerateImagePayload(request({ model }))

            expect(payload.input).toBe('1girl, blue hair, very aesthetic, masterpiece, no text')
            expect(payload.parameters).toMatchObject({
                tag_hint_qt: 1,
                tag_hint_uc_preset: 2,
                tag_hint_transparent_background: false,
                negative_prompt: `${UC_PRESETS_V5[0]}, extra fingers`,
                sm: true,
                sm_dyn: true,
            })
        },
    )

    it('adds the transparent prompt hint and wire flag only when requested', () => {
        const payload = buildGenerateImagePayload(request({ transparentBackground: true }))

        expect(payload.input).toBe(
            '1girl, blue hair, transparent background, very aesthetic, masterpiece, no text',
        )
        expect(payload.parameters.tag_hint_transparent_background).toBe(true)
        expect(payload.parameters.straight_alpha).toBe(true)
    })

    it('does not leak the V5 alpha flag into opaque or legacy requests', () => {
        const opaqueV5 = buildGenerateImagePayload(request({ transparentBackground: false }))
        const legacy = buildGenerateImagePayload(request({
            model: 'nai-diffusion-4-5-full',
            transparentBackground: true,
        }))

        expect(opaqueV5.parameters).not.toHaveProperty('straight_alpha')
        expect(legacy.parameters).not.toHaveProperty('straight_alpha')
    })

    it('does not guess a legacy Variety+ coefficient for V5', () => {
        const payload = buildGenerateImagePayload(request({ variety: true }))

        expect(payload.parameters.skip_cfg_above_sigma).toBeNull()
    })
})
