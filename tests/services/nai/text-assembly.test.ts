import { describe, expect, it } from 'vitest'

import { assembleV5TextPrompt } from '@/services/nai/text-assembly'

describe('NovelAI V5 text assembly parity', () => {
    it('appends one teXt block to only the first prompt variant', () => {
        expect(assembleV5TextPrompt({
            model: 'nai-diffusion-5-full',
            basePrompt: 'scene, "hello",  |alternate, "unused"',
            characterPrompts: [{ prompt: 'character, "welcome"' }],
            useCoords: false,
        })).toBe('scene, "hello", teXt: hello\n\nwelcome|alternate, "unused"')
    })

    it('recursively splits rows when an adjacent y gap exceeds the provider threshold', () => {
        expect(assembleV5TextPrompt({
            model: 'nai-diffusion-5-full',
            basePrompt: 'three characters',
            characterPrompts: [
                { prompt: 'middle, "middle"', center: { x: 0.9, y: 0.21 } },
                { prompt: 'bottom, "bottom"', center: { x: 0.1, y: 0.25 } },
                { prompt: 'top, "top"', center: { x: 0.8, y: 0.10 } },
            ],
            useCoords: true,
        })).toBe('three characters, teXt: top\n\nbottom\n\nmiddle')
    })

    it('reverses quote order within each source group when CJK text exceeds 30 percent', () => {
        expect(assembleV5TextPrompt({
            model: 'nai-diffusion-5-full',
            basePrompt: '"一", "二"',
            characterPrompts: [{ prompt: '"三", "四"' }],
            useCoords: false,
        })).toBe('"一", "二", teXt: 二\n\n一\n\n四\n\n三')
    })
})
