import { describe, expect, it } from 'vitest'
import {
    collectPromptFrequencySortTokens,
    sortPromptByFrequency,
} from '@/lib/prompt-frequency-sort'

describe('prompt frequency sorting', () => {
    it('collects weighted leaves and strips only emphasis wrappers', () => {
        expect(collectPromptFrequencySortTokens('  {{rare}} , 2::common, [middle] ::, tail')).toEqual([
            'rare',
            'common',
            'middle',
            'tail',
        ])
    })

    it('stably sorts exact tags ascending and puts unresolved tags last', () => {
        const result = sortPromptByFrequency(' common,unknown, rare, tied-a,tied-b', [
            { postCount: 100, exactMatch: true },
            { postCount: null, exactMatch: false },
            { postCount: 1, exactMatch: true },
            { postCount: 50, exactMatch: true },
            { postCount: 50, exactMatch: true },
        ])

        expect(result.text).toBe(' rare,tied-a, tied-b, common,unknown')
        expect(result).toMatchObject({ changed: true, movedCount: 5, sortableCount: 4, unresolvedCount: 1 })
    })

    it('treats an official zero-count tag as sortable, not unresolved', () => {
        const result = sortPromptByFrequency('known,zero,missing', [
            { postCount: 8, exactMatch: true },
            { postCount: 0, exactMatch: true },
            { postCount: null, exactMatch: false },
        ])

        expect(result.text).toBe('zero,known,missing')
        expect(result).toMatchObject({ sortableCount: 2, unresolvedCount: 1 })
    })

    it('keeps line boundaries as independent blocks', () => {
        const result = sortPromptByFrequency('high, low\r\nsecond, first', [
            { postCount: 9, exactMatch: true },
            { postCount: 1, exactMatch: true },
            { postCount: 5, exactMatch: true },
            { postCount: 2, exactMatch: true },
        ])

        expect(result.text).toBe('low, high\r\nfirst, second')
    })

    it('keeps a numeric weight group fixed while sorting only its leaves', () => {
        const result = sortPromptByFrequency('outer, 2::frequent, rare ::, tail', [
            { postCount: 1, exactMatch: true },
            { postCount: 99, exactMatch: true },
            { postCount: 2, exactMatch: true },
            { postCount: 0, exactMatch: true },
        ])

        expect(result.text).toBe('outer, 2::rare, frequent ::, tail')
        expect(result.movedCount).toBe(2)
    })

    it.each([
        ['1.1:::swept bangs ::, other', 'malformed numeric weight group'],
        ['2::open, group', 'unclosed numeric weight group'],
        ['# comment, untouched', 'comment skipped'],
        ['tag, <fragment>', 'fragment skipped'],
    ])('does not change unsafe input %s', (source, diagnostic) => {
        const result = sortPromptByFrequency(source, [])
        expect(result.text).toBe(source)
        expect(result.changed).toBe(false)
        expect(result.diagnostics).toContain(`line 1: ${diagnostic}`)
    })

    it('round-trips byte-for-byte when the stable order already matches', () => {
        const source = '  {{zero}} , [rare], duplicate, duplicate  \r\n   \r\na,  ,b'
        const result = sortPromptByFrequency(source, [
            { postCount: 0, exactMatch: true },
            { postCount: 1, exactMatch: true },
            { postCount: 2, exactMatch: true },
            { postCount: 2, exactMatch: true },
            { postCount: 3, exactMatch: true },
            { postCount: 4, exactMatch: true },
        ])

        expect(result.text).toBe(source)
        expect(result).toMatchObject({ changed: false, movedCount: 0 })
        expect(result.diagnostics).toEqual([])
    })
})
