export const MIN_PRODUCTIVE_GENERATION_STEPS = 4
export const LOW_STEP_CAUTION_THRESHOLD = 8
export const RECOMMENDED_GENERATION_STEPS = 28

export type GenerationStepQuality = 'blocked' | 'caution' | 'normal'

/**
 * Depends only on the resolved draft step count and is shared by command/UI
 * guards. It prevents preview-grade latent output from looking like a broken
 * provider response while keeping 4–7 step expert experiments available with
 * an explicit warning; the normal 28-step default remains unchanged.
 */
export function assessGenerationStepQuality(steps: number): GenerationStepQuality {
    if (!Number.isFinite(steps) || steps < MIN_PRODUCTIVE_GENERATION_STEPS) return 'blocked'
    if (steps < LOW_STEP_CAUTION_THRESHOLD) return 'caution'
    return 'normal'
}
