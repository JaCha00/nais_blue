import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prepareReferences } = vi.hoisted(() => ({ prepareReferences: vi.fn() }))

vi.mock('@/services/nai/refs', () => ({ prepareReferences }))

import {
    adaptGenerationParams,
    NovelAiModelCapabilityError,
} from '@/services/nai/adapter'
import { buildGenerateImagePayload } from '@/services/nai/payload'
import type { GenerationParams } from '@/services/novelai-types'

function params(overrides: Partial<GenerationParams> = {}): GenerationParams {
    return {
        prompt: '1girl',
        negative_prompt: '',
        model: 'nai-diffusion-5-full',
        width: 832,
        height: 1216,
        steps: 28,
        cfg_scale: 5,
        cfg_rescale: 0,
        sampler: 'k_euler_ancestral',
        scheduler: 'native',
        smea: false,
        smea_dyn: false,
        variety: false,
        seed: 1,
        ...overrides,
    }
}

describe('adaptGenerationParams V5 capability boundary', () => {
    beforeEach(() => {
        prepareReferences.mockReset()
        prepareReferences.mockResolvedValue({ newlyEncodedVibes: [] })
    })

    it('normalizes V5 transport fields without changing user-owned generation values', async () => {
        const adapted = await adaptGenerationParams('token', params({ transparentBackground: true }))

        expect(adapted.request).toMatchObject({
            model: 'nai-diffusion-5-full',
            steps: 28,
            cfgScale: 5,
            sampler: 'k_euler_ancestral',
            noiseSchedule: 'karras',
            smea: false,
            smeaDyn: false,
            transparentBackground: true,
        })
    })

    it('uses the catalog inpainting ID, including the legacy V4 curated exception', async () => {
        prepareReferences.mockResolvedValueOnce({
            newlyEncodedVibes: [],
            source: { width: 832, height: 1216, maskBase64: 'mask', i2i: {} },
        })
        const adapted = await adaptGenerationParams('token', params({
            model: 'nai-diffusion-4-curated-preview',
            negative_prompt: 'custom negative',
            qualityToggle: true,
            ucPreset: 0,
        }))

        expect(adapted.request.model).toBe('nai-diffusion-4-curated-inpainting')
        const payload = buildGenerateImagePayload(adapted.request, adapted.buildOptions)
        expect(payload.input).toBe(
            '1girl, rating:general, amazing quality, very aesthetic, absurdres',
        )
        expect(payload.parameters.negative_prompt).toBe(
            'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, custom negative',
        )
    })

    it.each([
        ['Vibe Transfer', { vibeImages: ['data:image/png;base64,AA=='] }],
        ['Precise Reference', { charImages: ['data:image/png;base64,AA=='] }],
    ])('rejects unsupported V5 %s before reference preprocessing', async (feature, overrides) => {
        await expect(adaptGenerationParams('token', params(overrides))).rejects.toThrow(feature)
        expect(prepareReferences).not.toHaveBeenCalled()
    })

    it('fails closed for an unknown provider model', async () => {
        await expect(adaptGenerationParams('token', params({ model: 'future-model' })))
            .rejects.toBeInstanceOf(NovelAiModelCapabilityError)
        expect(prepareReferences).not.toHaveBeenCalled()
    })
})
