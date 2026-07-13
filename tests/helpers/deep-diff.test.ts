import { describe, expect, it } from 'vitest'

import {
    DeepDiffAssertionError,
    assertDeepEqual,
    deepDiff,
    formatDeepDiff,
} from './deep-diff'

describe('deep diff helpers', () => {
    it('reports nested value, missing, unexpected, type and array differences by path', () => {
        const actual = {
            settings: { width: '1024', extra: true },
            prompts: ['first', 'actual-second', 'extra-third'],
        }
        const expected = {
            settings: { width: 1024, height: 1024 },
            prompts: ['first', 'expected-second'],
        }

        expect(deepDiff(actual, expected)).toEqual([
            { path: '$.prompts', kind: 'array-length', actual: 3, expected: 2 },
            { path: '$.prompts[1]', kind: 'value', actual: 'actual-second', expected: 'expected-second' },
            { path: '$.prompts[2]', kind: 'unexpected', actual: 'extra-third' },
            { path: '$.settings.extra', kind: 'unexpected', actual: true },
            { path: '$.settings.height', kind: 'missing', expected: 1024 },
            { path: '$.settings.width', kind: 'type', actual: '1024', expected: 1024 },
        ])
    })

    it('formats differences so assertion failures are directly actionable', () => {
        const differences = deepDiff(
            { output: { format: 'png' } },
            { output: { format: 'webp', metadataMode: 'sidecar-only' } },
        )
        const formatted = formatDeepDiff(differences)

        expect(formatted).toContain('$.output.format: value')
        expect(formatted).toContain("expected: 'webp'")
        expect(formatted).toContain("actual:   'png'")
        expect(formatted).toContain('$.output.metadataMode: missing')
    })

    it('throws a typed error containing the differences and optional context', () => {
        let caught: unknown
        try {
            assertDeepEqual({ seed: 1 }, { seed: 2 }, 'payload parity failed')
        } catch (error) {
            caught = error
        }

        expect(caught).toBeInstanceOf(DeepDiffAssertionError)
        expect(caught).toMatchObject({
            name: 'DeepDiffAssertionError',
            differences: [{ path: '$.seed', kind: 'value', actual: 1, expected: 2 }],
        })
        expect((caught as Error).message).toContain('payload parity failed')
    })

    it('accepts deep equality and enforces the configured difference limit', () => {
        expect(() => assertDeepEqual({ a: [1, 2] }, { a: [1, 2] })).not.toThrow()
        expect(deepDiff({ c: 3, b: 2, a: 1 }, { c: 0, b: 0, a: 0 }, {
            maxDifferences: 2,
        })).toEqual([
            { path: '$.a', kind: 'value', actual: 1, expected: 0 },
            { path: '$.b', kind: 'value', actual: 2, expected: 0 },
        ])
        expect(() => deepDiff({}, {}, { maxDifferences: 0 })).toThrow(RangeError)
    })

    it('handles cycles without recursing forever', () => {
        const actual: Record<string, unknown> = { value: 1 }
        const expected: Record<string, unknown> = { value: 2 }
        actual.self = actual
        expected.self = expected

        expect(deepDiff(actual, expected)).toEqual([
            { path: '$.value', kind: 'value', actual: 1, expected: 2 },
        ])
    })
})
