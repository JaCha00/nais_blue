export const PRODUCT_GUIDANCE_VERSION = 13 as const

export type GuidanceStepId = 'credential' | 'validation' | 'output' | 'r2' | 'queue'
export type GuidanceStepStatus = 'complete' | 'attention' | 'available' | 'optional'

export interface ProductGuidanceStateInput {
    readonly completedVersion: number
    readonly vaultStatus: 'unavailable' | 'locked' | 'unlocking' | 'unlocked' | 'error'
    readonly hasCredential: boolean
    readonly hasResolvedPlan: boolean
    readonly outputConfigured: boolean
    readonly r2Configured: boolean
    readonly queueVisited: boolean
}

export interface ProductGuidanceState {
    readonly showOnboardingCue: boolean
    readonly steps: ReadonlyArray<{ readonly id: GuidanceStepId; readonly status: GuidanceStepStatus }>
}

/** Derives guidance without mutating credential, generation, output, or queue state. */
export function deriveProductGuidanceState(input: ProductGuidanceStateInput): ProductGuidanceState {
    const credentialReady = input.vaultStatus === 'unlocked' && input.hasCredential
    return {
        showOnboardingCue: input.completedVersion < PRODUCT_GUIDANCE_VERSION,
        steps: [
            { id: 'credential', status: credentialReady ? 'complete' : 'attention' },
            { id: 'validation', status: input.hasResolvedPlan ? 'complete' : 'available' },
            { id: 'output', status: input.outputConfigured ? 'complete' : 'available' },
            { id: 'r2', status: input.r2Configured ? 'complete' : 'optional' },
            { id: 'queue', status: input.queueVisited ? 'complete' : 'available' },
        ],
    }
}
