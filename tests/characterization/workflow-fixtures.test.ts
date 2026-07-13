import { describe, expect, it, vi } from 'vitest'

import { hasWildcards, processWildcards } from '@/lib/fragment-processor'
import {
    buildStyleLabPrompt,
    formatWeightedPromptTags,
    type StyleLabPromptParts,
    type WeightedPromptTag,
} from '@/lib/style-lab'
import { loadFixtureJson } from '../helpers'

interface InlineSelectionFixture {
    case: string
    input: string
    randomSequence: number[]
    expectedRandomCalls: number
    expected: string
}

interface StyleLabWorkflowFixture {
    workflow: 'stylelab'
    input: {
        template: string
        tags: WeightedPromptTag[]
        parts: StyleLabPromptParts
    }
    expected: {
        formattedTags: string
        prompt: string
        artistPlaceholderConsumed: boolean
    }
}

describe('Composition primitive characterization fixtures', () => {
    it('detects and deterministically resolves an inline fragment selection', async () => {
        const fixture = await loadFixtureJson<InlineSelectionFixture>(
            'fragments/inline-selection.json',
        )
        const selections = [...fixture.randomSequence]
        const random = vi.spyOn(Math, 'random').mockImplementation(() => {
            const next = selections.shift()
            if (next === undefined) throw new Error('Fragment fixture exhausted its random sequence')
            return next
        })

        expect(hasWildcards(fixture.input)).toBe(true)
        expect(await processWildcards(fixture.input)).toBe(fixture.expected)
        expect(random).toHaveBeenCalledTimes(fixture.expectedRandomCalls)
        expect(selections).toEqual([])
    })

    it('renders weighted Style Lab tags through the production prompt formatter', async () => {
        const fixture = await loadFixtureJson<StyleLabWorkflowFixture>(
            'workflows/stylelab/prompt-template.json',
        )
        const formattedTags = formatWeightedPromptTags(fixture.input.tags)
        const prompt = buildStyleLabPrompt(
            fixture.input.template,
            formattedTags,
            fixture.input.parts,
        )

        expect(formattedTags).toBe(fixture.expected.formattedTags)
        expect(prompt).toBe(fixture.expected.prompt)
        expect(prompt.includes('{{artist_tags}}')).toBe(
            !fixture.expected.artistPlaceholderConsumed,
        )
    })
})
