import { describe, expect, it } from 'vitest'

import { normalizeGuidedResolutionSide } from '@/presentation/workflow/GuidedResolutionDetails'

describe('Guided detailed resolution', () => {
    it.each([
        [1_001, 1_024],
        [1_055, 1_024],
        [32, 64],
        [9_999, 8_192],
    ])('normalizes %i to the NovelAI resolution grid', (value, expected) => {
        expect(normalizeGuidedResolutionSide(value, 832)).toBe(expected)
    })

    it('keeps the current side when the input is not numeric', () => {
        expect(normalizeGuidedResolutionSide(Number.NaN, 1_216)).toBe(1_216)
    })
})
