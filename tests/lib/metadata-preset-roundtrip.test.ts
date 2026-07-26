import { describe, expect, it } from 'vitest'
import { inferNAIPresetImport } from '@/lib/metadata-parser'
import { mergeQualityTags, mergeUcPreset } from '@/services/nai/presets'

const MODEL = 'NovelAI Diffusion V4.5 Full'

describe('NAI preset metadata round trip', () => {
    it('removes inferred quality text before the prompt is generated again', () => {
        const userPrompt = '1girl, solo, blue hair'
        const generated = mergeQualityTags(userPrompt, true)
        const imported = inferNAIPresetImport(generated, '', MODEL)

        expect(imported).toMatchObject({ qualityToggle: true, prompt: userPrompt })
        expect(mergeQualityTags(imported.prompt!, imported.qualityToggle!)).toBe(generated)
    })

    it.each([0, 1, 3] as const)('restores UC preset %i from the shared wire table', ucPreset => {
        const userNegative = 'bad hands, extra fingers'
        const generated = mergeUcPreset(userNegative, ucPreset)
        const imported = inferNAIPresetImport('', generated, MODEL)

        expect(imported).toMatchObject({ ucPreset, negativePrompt: userNegative })
        expect(mergeUcPreset(imported.negativePrompt!, imported.ucPreset as 0 | 1 | 3)).toBe(generated)
    })

    it('does not invent an index for presets with no wire text', () => {
        const imported = inferNAIPresetImport('', 'bad hands', MODEL)

        expect(imported.ucPreset).toBeUndefined()
        expect(imported.negativePrompt).toBeUndefined()
    })
})
