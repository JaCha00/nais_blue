import { describe, expect, it } from 'vitest'
import { calculateAnlasCost } from '@/lib/anlas-calculator'
import { selectActiveCredentialsAreOpus } from '@/stores/auth-store'

describe('Anlas estimate', () => {
    it('keeps every standard Opus batch image base-free', () => {
        expect(calculateAnlasCost(832, 1_216, 28, 4, 0, 0, true)).toBe(0)
    })

    it('adds paid features before multiplying the displayed batch total', () => {
        expect(calculateAnlasCost(832, 1_216, 28, 2, 1, 3, true)).toBe(22)
    })

    it('charges the base estimate for a non-Opus credential', () => {
        expect(calculateAnlasCost(832, 1_216, 28, 1, 0, 0, false)).toBe(5)
    })

    it('uses the free allowance only when every active credential is Opus', () => {
        const base = { token: 'one', token2: 'two', slot1Enabled: true, slot2Enabled: true }
        expect(selectActiveCredentialsAreOpus({ ...base, tier: 'opus', tier2: 'opus' })).toBe(true)
        expect(selectActiveCredentialsAreOpus({ ...base, tier: 'opus', tier2: 'tablet' })).toBe(false)
        expect(selectActiveCredentialsAreOpus({ ...base, tier: 'opus', tier2: null })).toBe(false)
    })
})
