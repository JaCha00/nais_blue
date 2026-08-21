import { describe, expect, it } from 'vitest'

import {
    calculateAnlasCost,
    resolveAnlasPricingBasis,
    type BaseGenerationAnlasInput,
} from '@/lib/anlas-calculator'
import { selectActiveCredentialsAreOpus } from '@/stores/auth-store'

const legacyModel = 'nai-diffusion-4-5-full'
const v5Model = 'nai-diffusion-5-full'

const paid = (input: Omit<BaseGenerationAnlasInput, 'pricingBasis' | 'model'>) => calculateAnlasCost({
    ...input,
    model: legacyModel,
    pricingBasis: 'paid',
})
const opus = (input: Omit<BaseGenerationAnlasInput, 'pricingBasis' | 'model'>) => calculateAnlasCost({
    ...input,
    model: legacyModel,
    pricingBasis: 'all-active-opus',
})
const v5Paid = (input: Omit<BaseGenerationAnlasInput, 'pricingBasis' | 'model'>) => calculateAnlasCost({
    ...input,
    model: v5Model,
    pricingBasis: 'paid',
})

describe('NovelAI base-generation Anlas estimate', () => {
    it.each([
        [832, 1_216, 28, 20],
        [832, 1_216, 29, 20],
        [832, 1_216, 30, 21],
        [832, 1_216, 35, 24],
        [832, 1_216, 40, 27],
        [832, 1_216, 50, 33],
        [1_024, 1_024, 29, 21],
        [1_024, 1_024, 50, 34],
        [1_024, 1_088, 28, 22],
        [896, 1_216, 28, 21],
        [1_536, 1_536, 1, 9],
        [1_536, 1_536, 20, 35],
        [1_536, 1_536, 50, 75],
        [2_048, 2_048, 1, 12],
        [2_048, 2_048, 28, 60],
        [2_048, 2_048, 50, 100],
    ])('matches the paid production quote for %ix%i at %i steps', (width, height, steps, expected) => {
        expect(paid({ width, height, steps, imageCount: 1 })).toBe(expected)
    })

    it.each([
        [832, 1_216, 28, 1, 0],
        [960, 1_088, 28, 1, 0],
        [768, 1_344, 28, 1, 0],
        [832, 1_216, 29, 1, 20],
        [1_024, 1_088, 28, 1, 22],
        [832, 1_216, 28, 2, 20],
        [832, 1_216, 28, 3, 40],
        [832, 1_216, 28, 4, 60],
    ])('applies the Opus allowance for %ix%i, %i steps, %i image(s)', (
        width,
        height,
        steps,
        imageCount,
        expected,
    ) => {
        expect(opus({ width, height, steps, imageCount })).toBe(expected)
    })

    it('charges every image without an Opus allowance', () => {
        expect(paid({ width: 832, height: 1_216, steps: 28, imageCount: 2 })).toBe(40)
    })

    it.each([
        [832, 1_216, 28, 29],
        [1_024, 1_024, 28, 30],
        [1_024, 1_024, 29, 31],
        [1_536, 1_536, 20, 52],
        [2_048, 2_048, 50, 150],
    ])('matches the V5 paid 1.5x production quote for %ix%i at %i steps', (width, height, steps, expected) => {
        expect(v5Paid({ width, height, steps, imageCount: 1 })).toBe(expected)
    })

    it('uses paid maximum pricing for V5 even when every active credential is Opus', () => {
        const pricingBasis = resolveAnlasPricingBasis({
            model: v5Model,
            activeCredentialsAreOpus: true,
        })

        expect(pricingBasis).toBe('paid')
        expect(calculateAnlasCost({
            model: v5Model,
            width: 832,
            height: 1_216,
            steps: 28,
            imageCount: 1,
            pricingBasis,
        })).toBe(29)
        expect(calculateAnlasCost({
            model: v5Model,
            width: 832,
            height: 1_216,
            steps: 28,
            imageCount: 1,
            pricingBasis: 'all-active-opus',
        })).toBe(29)
    })

    it.each([
        [{ model: legacyModel, width: 0, height: 1_024, steps: 28, imageCount: 1, pricingBasis: 'paid' }, RangeError],
        [{ model: legacyModel, width: 1_024.5, height: 1_024, steps: 28, imageCount: 1, pricingBasis: 'paid' }, RangeError],
        [{ model: legacyModel, width: 1_024, height: 1_024, steps: 0, imageCount: 1, pricingBasis: 'paid' }, RangeError],
        [{ model: legacyModel, width: 1_024, height: 1_024, steps: 28, imageCount: 0, pricingBasis: 'paid' }, RangeError],
        [{ model: legacyModel, width: 1_024, height: 1_024, steps: 28, imageCount: Number.MAX_SAFE_INTEGER, pricingBasis: 'paid' }, RangeError],
        [{ model: legacyModel, width: 1_024, height: 1_024, steps: 28, imageCount: 1, pricingBasis: 'unknown' }, TypeError],
        [{ model: '', width: 1_024, height: 1_024, steps: 28, imageCount: 1, pricingBasis: 'paid' }, TypeError],
    ])('rejects invalid estimator input %#', (input, error) => {
        expect(() => calculateAnlasCost(input as BaseGenerationAnlasInput)).toThrow(error)
    })
})

describe('active credential pricing basis', () => {
    it('uses the free allowance only when every active credential is Opus', () => {
        const base = { token: 'one', token2: 'two', slot1Enabled: true, slot2Enabled: true }
        expect(selectActiveCredentialsAreOpus({ ...base, tier: 'opus', tier2: 'opus' })).toBe(true)
        expect(selectActiveCredentialsAreOpus({ ...base, tier: 'opus', tier2: 'tablet' })).toBe(false)
        expect(selectActiveCredentialsAreOpus({ ...base, tier: 'opus', tier2: null })).toBe(false)
    })
})
