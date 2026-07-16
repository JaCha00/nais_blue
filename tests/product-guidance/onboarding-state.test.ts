import { describe, expect, it } from 'vitest'
import {
    deriveProductGuidanceState,
    PRODUCT_GUIDANCE_VERSION,
} from '../../src/services/guidance/onboarding'
import { guideSectionForDiagnosticCode } from '../../src/services/guidance/diagnostic-guides'

const base = {
    completedVersion: 0,
    vaultStatus: 'unlocked' as const,
    hasCredential: true,
    hasResolvedPlan: false,
    outputConfigured: true,
    r2Configured: false,
    queueVisited: false,
}

describe('Phase 13 onboarding state', () => {
    it('opens for a fresh user and stays available without reopening for a returning user', () => {
        expect(deriveProductGuidanceState(base).showOnboardingCue).toBe(true)
        expect(deriveProductGuidanceState({
            ...base,
            completedVersion: PRODUCT_GUIDANCE_VERSION,
        }).showOnboardingCue).toBe(false)
    })

    it.each([
        ['locked', true],
        ['unlocked', false],
    ] as const)('marks credential attention for a %s vault with no credential', (vaultStatus, hasCredential) => {
        const state = deriveProductGuidanceState({ ...base, vaultStatus, hasCredential })
        expect(state.steps[0]).toEqual({ id: 'credential', status: 'attention' })
    })

    it('keeps R2 optional and maps stable diagnostic codes to guide sections', () => {
        const state = deriveProductGuidanceState(base)
        expect(state.steps.find(step => step.id === 'r2')?.status).toBe('optional')
        expect(guideSectionForDiagnosticCode('AUTH_UNAUTHORIZED')).toBe('credential')
        expect(guideSectionForDiagnosticCode('R2_UPLOAD_FAILED')).toBe('r2')
        expect(guideSectionForDiagnosticCode('OPERATION_STALLED')).toBe('queue')
        expect(guideSectionForDiagnosticCode('UNKNOWN_FAILURE')).toBe('advanced')
    })
})
