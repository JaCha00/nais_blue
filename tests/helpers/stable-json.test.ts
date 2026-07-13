import { describe, expect, it } from 'vitest'

import { stableJsonStringify, stableSerialize } from './stable-json'

describe('stableJsonStringify', () => {
    it('sorts keys recursively while retaining array order', () => {
        const value = {
            z: 1,
            a: { beta: true, alpha: false },
            list: [{ z: 3, a: 2 }, 'last'],
        }

        expect(stableJsonStringify(value, { space: 0 })).toBe(
            '{"a":{"alpha":false,"beta":true},"list":[{"a":2,"z":3},"last"],"z":1}',
        )
        expect(stableSerialize({ b: 1, a: 2 }, { space: 0 })).toBe('{"a":2,"b":1}')
    })

    it('matches JSON semantics for omitted values, arrays, dates and non-finite numbers', () => {
        const value = {
            omitted: undefined,
            list: [undefined, Number.NaN, Number.POSITIVE_INFINITY],
            date: new Date('2024-02-03T04:05:06.000Z'),
        }

        expect(stableJsonStringify(value, { space: 0 })).toBe(
            '{"date":"2024-02-03T04:05:06.000Z","list":[null,null,null]}',
        )
    })

    it('does not mutate input objects and allows repeated non-cyclic references', () => {
        const shared = { z: 1, a: 2 }
        const value = { right: shared, left: shared }

        stableJsonStringify(value)

        expect(Object.keys(shared)).toEqual(['z', 'a'])
        expect(stableJsonStringify(value, { space: 0 })).toBe(
            '{"left":{"a":2,"z":1},"right":{"a":2,"z":1}}',
        )
    })

    it('fails loudly for cycles, BigInt and unsupported root values', () => {
        const cyclic: Record<string, unknown> = {}
        cyclic.self = cyclic

        expect(() => stableJsonStringify(cyclic)).toThrow(/cyclic structure/)
        expect(() => stableJsonStringify(BigInt(1))).toThrow(/BigInt/)
        expect(() => stableJsonStringify(undefined)).toThrow(/non-JSON root/)
    })
})
