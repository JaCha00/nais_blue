import { describe, expect, it } from 'vitest'
import { inferNAIPresetImport, parseNAIMetadata } from '@/lib/metadata-parser'
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

    it('removes one provider-expanded quality signature from the middle of a legacy prompt', () => {
        const generated = `${mergeQualityTags('1girl', true)}, outdoors`
        const imported = inferNAIPresetImport(generated, '', MODEL)

        expect(imported).toMatchObject({ qualityToggle: true, prompt: '1girl, outdoors' })
    })

    it('removes only one of two legacy quality signatures', () => {
        const once = mergeQualityTags('1girl', true)
        const imported = inferNAIPresetImport(`${once}${once.slice('1girl'.length)}`, '', MODEL)

        expect(imported).toMatchObject({ qualityToggle: true, prompt: once })
    })

    it.each([
        { explicit: true, expectedPrompt: '1girl' },
        { explicit: false, expectedPrompt: mergeQualityTags('1girl', true) },
    ])('lets explicit qualityToggle=$explicit control legacy prompt cleanup', async ({ explicit, expectedPrompt }) => {
        const prompt = mergeQualityTags('1girl', true)
        const metadata = await parseNAIMetadata(pngWithTextChunks([
            ['Comment', JSON.stringify({ prompt, qualityToggle: explicit })],
            ['Source', MODEL],
        ]))

        expect(metadata).toMatchObject({ qualityToggle: explicit, prompt: expectedPrompt })
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

    it.each([
        ['nai-diffusion-4-5-curated', 'NovelAI Diffusion V4.5 Curated'],
        ['nai-diffusion-4-full', 'NovelAI Diffusion V4 Full'],
        ['nai-diffusion-4-curated-preview', 'NovelAI Diffusion V4 Curated'],
    ] as const)('round-trips the model-specific heavy UC for %s', (modelId, source) => {
        const generated = mergeUcPreset('custom negative', 0, modelId)
        const imported = inferNAIPresetImport('', generated, source)

        expect(imported).toMatchObject({ ucPreset: 0, negativePrompt: 'custom negative' })
        expect(mergeUcPreset(imported.negativePrompt!, 0, modelId)).toBe(generated)
    })

    it('restores V5 preset and transparent-background hints without duplicating prompt text', async () => {
        const modelId = 'nai-diffusion-5-full'
        const prompt = mergeQualityTags('blue-haired heroine', true, modelId, true)
        const negativePrompt = mergeUcPreset('extra fingers', 0, modelId)
        const metadata = await parseNAIMetadata(pngWithTextChunks([
            ['Comment', JSON.stringify({
                prompt,
                negative_prompt: negativePrompt,
                tag_hint_transparent_background: true,
                straight_alpha: true,
            })],
            ['Source', 'NovelAI Diffusion V5 Full'],
        ]))

        expect(metadata).toMatchObject({
            model: 'NovelAI Diffusion V5 Full',
            prompt: 'blue-haired heroine',
            negativePrompt: 'extra fingers',
            qualityToggle: true,
            ucPreset: 0,
            transparentBackground: true,
        })
        expect(mergeQualityTags(
            metadata!.prompt!,
            metadata!.qualityToggle!,
            modelId,
            metadata!.transparentBackground,
        )).toBe(prompt)
    })
})

function pngWithTextChunks(entries: Array<[string, string]>): Uint8Array {
    const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const chunks = entries.map(([keyword, value]) => pngChunk('tEXt', `${keyword}\0${value}`))
    return concatBytes(signature, ...chunks, pngChunk('IEND', ''))
}

function pngChunk(type: string, text: string): Uint8Array {
    const payload = new TextEncoder().encode(text)
    const chunk = new Uint8Array(12 + payload.length)
    new DataView(chunk.buffer).setUint32(0, payload.length)
    chunk.set(new TextEncoder().encode(type), 4)
    chunk.set(payload, 8)
    return chunk
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}
