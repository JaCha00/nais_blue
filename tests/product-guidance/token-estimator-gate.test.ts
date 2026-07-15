import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/product-guidance/token-gate-current-models.json'
import { assessPromptLengths } from '../../src/services/guidance/prompt-length-assessment'
import { summarizePrompt } from '../../src/services/diagnostics/redactor'

describe('Phase 13 token estimator gate', () => {
    it.each(fixture.models)('fails closed for $model while preserving final section lengths', expected => {
        const result = assessPromptLengths({
            ...fixture.input,
            ucPreset: 2,
            model: expected.model,
        })

        expect(result.classification).toBe(expected.classification)
        expect(result.tokenizerFamily).toBe(expected.family)
        expect(result.tokenCount).toBeNull()
        expect(result.safetyMarginTokens).toBeNull()
        expect(result.positive).toMatchObject(fixture.expectedLengths.positive)
        expect(result.negative).toMatchObject(fixture.expectedLengths.negative)
        expect(result.positive.characterPromptCharacters).toEqual([4])
        expect(result.negative.characterPromptCharacters).toEqual([9])
    })

    it('uses the unsupported-model fallback without inventing a token limit', () => {
        const result = assessPromptLengths({
            ...fixture.input,
            ucPreset: 2,
            model: 'nai-diffusion-5-experimental',
        })

        expect(result).toMatchObject({
            classification: 'unavailable',
            tokenizerFamily: 'unsupported',
            reason: 'UNSUPPORTED_MODEL',
            tokenCount: null,
            safetyMarginTokens: null,
        })
        expect(JSON.stringify(result)).not.toContain('512')
    })

    it('removes comments and applies the same quality and UC expansion helpers as the payload path', () => {
        const result = assessPromptLengths({
            model: 'nai-diffusion-4-5-full',
            positivePrompt: '# hidden\nvisible',
            negativePrompt: '# hidden\nartifact',
            characters: [{ positive: '# hidden\nchar', negative: '# hidden\nbad', enabled: true }],
            qualityToggle: false,
            ucPreset: 0,
        })

        expect(result.positive.expandedBaseCharacters).toBe('visible'.length)
        expect(result.positive.characterPromptCharacters).toEqual(['char'.length])
        expect(result.negative.expandedBaseCharacters).toBeGreaterThan('artifact'.length)
    })

    it('keeps diagnostics to hashes and character counts rather than a heuristic token number', () => {
        const summary = summarizePrompt('private prompt')
        expect(summary).toMatchObject({ chars: 14 })
        expect(summary.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(summary).not.toHaveProperty('estimatedTokens')
    })
})
