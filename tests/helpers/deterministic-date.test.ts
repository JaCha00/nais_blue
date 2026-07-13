import { describe, expect, it } from 'vitest'

import {
    DEFAULT_DETERMINISTIC_DATE,
    createDeterministicClock,
    deterministicDate,
    deterministicIsoDate,
} from './deterministic-date'

describe('deterministic date helpers', () => {
    it('uses an explicit stable default independent of the system clock', () => {
        expect(deterministicIsoDate()).toBe(DEFAULT_DETERMINISTIC_DATE)
        expect(deterministicDate().getTime()).toBe(Date.parse(DEFAULT_DETERMINISTIC_DATE))
    })

    it('normalizes Date, number and string inputs without retaining mutable Date objects', () => {
        const source = new Date('2024-05-06T07:08:09.000Z')
        const clone = deterministicDate(source)
        source.setUTCFullYear(2030)

        expect(clone.toISOString()).toBe('2024-05-06T07:08:09.000Z')
        expect(deterministicIsoDate(Date.parse('2024-01-01T00:00:00.000Z'))).toBe('2024-01-01T00:00:00.000Z')
    })

    it('creates an injected clock that advances only when directed', () => {
        const clock = createDeterministicClock('2024-01-01T00:00:00.000Z')

        expect(clock.iso()).toBe('2024-01-01T00:00:00.000Z')
        expect(clock.date()).not.toBe(clock.date())
        clock.advance(1_500)
        expect(clock.iso()).toBe('2024-01-01T00:00:01.500Z')
        clock.set('2025-02-03T04:05:06.000Z')
        expect(clock.now()).toBe(Date.parse('2025-02-03T04:05:06.000Z'))
    })

    it('rejects invalid timestamps and non-finite advances', () => {
        expect(() => deterministicDate('not-a-date')).toThrow(RangeError)
        const clock = createDeterministicClock()
        expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    })
})
