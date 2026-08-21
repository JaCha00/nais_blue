import { describe, expect, it } from 'vitest'

import { mergeUcPreset } from '@/services/nai/presets'

const V45_HEAVY =
    'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'
const FURRY_FOCUS =
    '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic'

const MODEL_PRESETS = [
    {
        model: 'nai-diffusion-5-full',
        heavy: V45_HEAVY,
        light: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
        furry: FURRY_FOCUS,
        human: `${V45_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
    },
    {
        model: 'nai-diffusion-4-5-full',
        heavy: V45_HEAVY,
        light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
        furry: FURRY_FOCUS,
        human: `${V45_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
    },
    {
        model: 'nai-diffusion-4-5-curated',
        heavy: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
        light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
        furry: '',
        human: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
    },
    {
        model: 'nai-diffusion-4-full',
        heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks',
        light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing',
        furry: '',
        human: '',
    },
    {
        model: 'nai-diffusion-4-curated-preview',
        heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts',
        light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature',
        furry: '',
        human: '',
    },
] as const

describe('NovelAI model-scoped UC presets', () => {
    it.each(MODEL_PRESETS)('uses the official preset family for $model', preset => {
        expect(mergeUcPreset('', 0, preset.model)).toBe(preset.heavy)
        expect(mergeUcPreset('', 1, preset.model)).toBe(preset.light)
        expect(mergeUcPreset('', 2, preset.model)).toBe(preset.furry)
        expect(mergeUcPreset('', 3, preset.model)).toBe(preset.human)
        expect(mergeUcPreset('', 4, preset.model)).toBe('')
    })

    it('keeps a custom negative prompt when the selected model has no matching preset family', () => {
        expect(mergeUcPreset('custom negative', 2, 'nai-diffusion-4-full')).toBe('custom negative')
    })
})
