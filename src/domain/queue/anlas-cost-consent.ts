export const ANLAS_COST_ESTIMATOR_VERSION = 'nai-blue-anlas-v2' as const

export type AnlasPricingBasis = 'all-active-opus' | 'paid'

export interface AnlasCostConsentSnapshot {
    readonly schemaVersion: 1
    readonly unit: 'anlas'
    readonly estimatorVersion: typeof ANLAS_COST_ESTIMATOR_VERSION
    readonly pricingBasis: AnlasPricingBasis
    readonly estimatedAnlas: number
    readonly maxAnlas: number
    readonly estimatedAt: string
    readonly approvedAt: string
}

export type AnlasCostConsentErrorCode =
    | 'E_ANLAS_CONSENT_REQUIRED'
    | 'E_ANLAS_CONSENT_INVALID'
    | 'E_ANLAS_ESTIMATE_CHANGED'
    | 'E_ANLAS_CEILING_EXCEEDED'

export class AnlasCostConsentError extends Error {
    constructor(readonly code: AnlasCostConsentErrorCode, message: string) {
        super(message)
        this.name = 'AnlasCostConsentError'
    }
}

function isIsoInstant(value: unknown): value is string {
    if (typeof value !== 'string') return false
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

export function isAnlasCostConsentSnapshot(value: unknown): value is AnlasCostConsentSnapshot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const candidate = value as Record<string, unknown>
    return candidate.schemaVersion === 1
        && candidate.unit === 'anlas'
        && candidate.estimatorVersion === ANLAS_COST_ESTIMATOR_VERSION
        && (candidate.pricingBasis === 'all-active-opus' || candidate.pricingBasis === 'paid')
        && Number.isSafeInteger(candidate.estimatedAnlas)
        && Number(candidate.estimatedAnlas) >= 0
        && Number.isSafeInteger(candidate.maxAnlas)
        && Number(candidate.maxAnlas) >= 0
        && isIsoInstant(candidate.estimatedAt)
        && isIsoInstant(candidate.approvedAt)
        && String(candidate.approvedAt) >= String(candidate.estimatedAt)
}

export function assertAnlasCostConsentAllows(
    value: unknown,
    currentEstimatedAnlas: number,
): asserts value is AnlasCostConsentSnapshot {
    if (value === undefined || value === null) {
        throw new AnlasCostConsentError('E_ANLAS_CONSENT_REQUIRED', 'Anlas cost consent is required')
    }
    if (!isAnlasCostConsentSnapshot(value) || !Number.isSafeInteger(currentEstimatedAnlas) || currentEstimatedAnlas < 0) {
        throw new AnlasCostConsentError('E_ANLAS_CONSENT_INVALID', 'Anlas cost consent is invalid')
    }
    if (value.estimatedAnlas !== currentEstimatedAnlas) {
        throw new AnlasCostConsentError(
            'E_ANLAS_ESTIMATE_CHANGED',
            'The Anlas estimate changed after approval',
        )
    }
    if (currentEstimatedAnlas > value.maxAnlas) {
        throw new AnlasCostConsentError(
            'E_ANLAS_CEILING_EXCEEDED',
            'The Anlas estimate exceeds the approved maximum',
        )
    }
}

export function createAnlasCostConsentSnapshot(
    input: Omit<AnlasCostConsentSnapshot, 'schemaVersion' | 'unit' | 'estimatorVersion'>,
): AnlasCostConsentSnapshot {
    const snapshot: AnlasCostConsentSnapshot = Object.freeze({
        ...input,
        schemaVersion: 1,
        unit: 'anlas',
        estimatorVersion: ANLAS_COST_ESTIMATOR_VERSION,
    })
    assertAnlasCostConsentAllows(snapshot, input.estimatedAnlas)
    return snapshot
}
