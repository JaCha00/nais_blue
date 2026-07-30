import { describe, expect, it } from 'vitest'
import { applyNovelAiTagRenames, NAI_RENAMED_TAGS, type Tag } from '@/lib/tag-data'

describe('NovelAI autocomplete tag renames', () => {
    it('matches the official renamed-tag table', () => {
        expect(NAI_RENAMED_TAGS).toEqual({
            v: 'peace sign',
            double_v: 'double peace',
            '|_|': 'bar eyes',
            '\\||/': 'open \\m/',
            ':|': 'neutral face',
            ';|': 'neutral face',
            '<|>_<|>': 'neco-arc eyes',
            eyepatch_bikini: 'square bikini',
            'tachi-e': 'character image',
        })
    })

    it('uses NovelAI names and keeps only the highest-count duplicate', () => {
        const source: Tag[] = [
            { label: 'v', value: 'v', count: 10, type: 'general' },
            { label: 'peace sign', value: 'peace sign', count: 20, type: 'general' },
            { label: ';|', value: ';|', count: 5, type: 'general' },
            { label: '<|> <|>', value: '<|> <|>', count: 7, type: 'general' },
        ]

        expect(applyNovelAiTagRenames(source)).toEqual([
            {
                label: 'peace sign', value: 'peace sign', count: 20, type: 'general',
                searchAliases: ['v'],
            },
            {
                label: 'neutral face', value: 'neutral face', count: 5, type: 'general',
                searchAliases: [';|'],
            },
            {
                label: 'neco-arc eyes', value: 'neco-arc eyes', count: 7, type: 'general',
                searchAliases: ['<|> <|>'],
            },
        ])
        expect(source[0]).toEqual({ label: 'v', value: 'v', count: 10, type: 'general' })
    })
})
