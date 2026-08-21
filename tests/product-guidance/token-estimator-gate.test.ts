import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/product-guidance/token-gate-current-models.json'
import {
    assessPromptLengths,
    type ModelTokenCapabilityRegistry,
} from '../../src/services/guidance/prompt-length-assessment'
import { summarizePrompt } from '../../src/services/diagnostics/redactor'

describe('Phase 13 token estimator gate', () => {
    const capabilities: ModelTokenCapabilityRegistry = Object.fromEntries(
        fixture.models.map(model => [
            model.model,
            { tokenizerFamily: model.family, contextLimitTokens: model.contextLimit },
        ]),
    ) as ModelTokenCapabilityRegistry

    it.each(fixture.models)('fails closed for $model while preserving final section lengths', expected => {
        const result = assessPromptLengths({
            ...fixture.input,
            ucPreset: 2,
            model: expected.model,
        }, capabilities)

        expect(result.classification).toBe(expected.classification)
        expect(result.tokenizerFamily).toBe(expected.family)
        expect(result.tokenCount).toBeNull()
        expect(result.safetyMarginTokens).toBeNull()
        expect(result.contextLimitTokens).toBe(expected.contextLimit)
        expect(result.limitClassification).toBe(expected.contextLimit === null ? 'unavailable' : 'confirmed')
        expect(result.positive).toMatchObject(expected.expectedLengths.positive)
        expect(result.negative).toMatchObject(expected.expectedLengths.negative)
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
            contextLimitTokens: null,
            limitClassification: 'unavailable',
        })
        expect(JSON.stringify(result)).not.toContain('512')
    })

    it('accepts a future capability without changing prompt expansion logic', () => {
        const result = assessPromptLengths({
            ...fixture.input,
            ucPreset: 2,
            model: 'nai-diffusion-6-experimental',
        }, {
            'nai-diffusion-6-experimental': { tokenizerFamily: 't5', contextLimitTokens: 1024 },
        })

        expect(result).toMatchObject({
            model: 'nai-diffusion-6-experimental',
            classification: 'unavailable',
            contextLimitTokens: 1024,
            limitClassification: 'confirmed',
        })
        expect(result.positive).toMatchObject({
            expandedBaseCharacters: 54,
            enabledCharacterCharacters: 4,
            combinedCharacters: 58,
        })
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

    it('mirrors V5 quote text assembly in the expanded positive base length', () => {
        const result = assessPromptLengths({
            model: 'nai-diffusion-5-full',
            positivePrompt: '1girl, "안녕"',
            negativePrompt: 'lowres',
            characters: [{ positive: 'speech bubble, "잘 가"', negative: '', enabled: true }],
            qualityToggle: false,
            ucPreset: 0,
        })

        expect(result.tokenizerFamily).toBe('qwen35')
        expect(result.contextLimitTokens).toBeNull()
        expect(result.positive.expandedBaseCharacters).toBe('1girl, "안녕", teXt: 안녕\n\n잘 가'.length)
    })

    it('does not reverse Korean quote order when calculating V5 prompt size', () => {
        const result = assessPromptLengths({
            model: 'nai-diffusion-5-full',
            positivePrompt: '"첫째", "둘째"',
            negativePrompt: '',
            characters: [],
            qualityToggle: false,
            ucPreset: 4,
        })

        expect(result.positive.expandedBaseCharacters).toBe('"첫째", "둘째", teXt: 첫째\n\n둘째'.length)
    })

    it('keeps diagnostics to hashes and character counts rather than a heuristic token number', () => {
        const summary = summarizePrompt('private prompt')
        expect(summary).toMatchObject({ chars: 14 })
        expect(summary.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(summary).not.toHaveProperty('estimatedTokens')
    })
})
