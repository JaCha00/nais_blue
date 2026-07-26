import { describe, expect, it } from 'vitest'

import {
    assessGenerationStepQuality,
    LOW_STEP_CAUTION_THRESHOLD,
    MIN_PRODUCTIVE_GENERATION_STEPS,
    RECOMMENDED_GENERATION_STEPS,
} from '@/services/generation/generation-quality'

describe('generation step quality guard', () => {
    it('blocks unresolved latent settings while preserving explicit expert ranges', () => {
        expect(assessGenerationStepQuality(Number.NaN)).toBe('blocked')
        expect(assessGenerationStepQuality(MIN_PRODUCTIVE_GENERATION_STEPS - 1)).toBe('blocked')
        expect(assessGenerationStepQuality(MIN_PRODUCTIVE_GENERATION_STEPS)).toBe('caution')
        expect(assessGenerationStepQuality(LOW_STEP_CAUTION_THRESHOLD - 1)).toBe('caution')
        expect(assessGenerationStepQuality(LOW_STEP_CAUTION_THRESHOLD)).toBe('normal')
        expect(assessGenerationStepQuality(RECOMMENDED_GENERATION_STEPS)).toBe('normal')
    })
})
