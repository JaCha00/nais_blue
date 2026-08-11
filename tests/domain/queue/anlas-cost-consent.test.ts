import { describe, expect, it } from 'vitest'

import {
    ANLAS_COST_ESTIMATOR_VERSION,
    AnlasCostConsentError,
    assertAnlasCostConsentAllows,
    createAnlasCostConsentSnapshot,
    isAnlasCostConsentSnapshot,
} from '@/domain/queue/anlas-cost-consent'

const approvedAt = '2026-08-08T12:00:01.000Z'
const estimatedAt = '2026-08-08T12:00:00.000Z'

describe('Anlas cost consent', () => {
    it('accepts only the reviewed estimate within the approved maximum', () => {
        const consent = createAnlasCostConsentSnapshot({
            pricingBasis: 'paid',
            estimatedAnlas: 10,
            maxAnlas: 12,
            estimatedAt,
            approvedAt,
        })

        expect(() => assertAnlasCostConsentAllows(consent, 10)).not.toThrow()
        expect(consent.estimatorVersion).toBe('nais-anlas-v2')
        expect(() => assertAnlasCostConsentAllows(consent, 11)).toThrowError(
            expect.objectContaining({ code: 'E_ANLAS_ESTIMATE_CHANGED' }),
        )
    })

    it('invalidates consent created under an older estimator', () => {
        expect(ANLAS_COST_ESTIMATOR_VERSION).toBe('nais-anlas-v2')
        expect(isAnlasCostConsentSnapshot({
            ...createAnlasCostConsentSnapshot({
                pricingBasis: 'paid',
                estimatedAnlas: 20,
                maxAnlas: 20,
                estimatedAt,
                approvedAt,
            }),
            estimatorVersion: 'nais-anlas-v1',
        })).toBe(false)
    })

    it('fails closed without consent or when the approved ceiling is too low', () => {
        expect(() => assertAnlasCostConsentAllows(undefined, 0)).toThrowError(
            expect.objectContaining({ code: 'E_ANLAS_CONSENT_REQUIRED' }),
        )

        expect(() => createAnlasCostConsentSnapshot({
            pricingBasis: 'paid',
            estimatedAnlas: 10,
            maxAnlas: 9,
            estimatedAt,
            approvedAt,
        })).toThrowError(AnlasCostConsentError)
        try {
            createAnlasCostConsentSnapshot({
                pricingBasis: 'paid',
                estimatedAnlas: 10,
                maxAnlas: 9,
                estimatedAt,
                approvedAt,
            })
        } catch (error) {
            expect(error).toMatchObject({ code: 'E_ANLAS_CEILING_EXCEEDED' })
        }
    })
})
