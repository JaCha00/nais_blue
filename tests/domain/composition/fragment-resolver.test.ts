import { beforeAll, describe, expect, it, vi } from 'vitest'

import {
    createFragmentLookup,
    resolveFragments,
    type FragmentDefinitionSnapshot,
    type FragmentLookup,
    type FragmentSequenceSnapshot,
    type ResolveFragmentsInput,
} from '@/domain/composition/fragment-resolver'
import { loadFixtureJson } from '../../helpers'

interface ResolverFixtureCase {
    input: string
    expected: string
    expectedCounter?: number
    nextCounter?: number
}

interface ResolverFixtureFragment {
    id: string
    lookupKey: string
    lines: string[]
}

interface ResolverFixture {
    schemaVersion: 1
    case: string
    seed: number
    scope: string
    fragments: ResolverFixtureFragment[]
    sequenceSnapshot: FragmentSequenceSnapshot
    cases: {
        named: ResolverFixtureCase
        nested: ResolverFixtureCase
        inlineSlash: ResolverFixtureCase
        folderAlias: ResolverFixtureCase
        sequential: ResolverFixtureCase
    }
}

let fixture: ResolverFixture
let lookup: FragmentLookup

beforeAll(async () => {
    fixture = await loadFixtureJson<ResolverFixture>('fragments/composition-resolver-v2.json')
    lookup = createFragmentLookup(fixture.fragments.map(fragment => ({
        id: fragment.id,
        path: fragment.lookupKey,
        lines: fragment.lines,
    } satisfies FragmentDefinitionSnapshot)))
})

function request(overrides: Partial<ResolveFragmentsInput> = {}): ResolveFragmentsInput {
    return {
        text: fixture.cases.named.input,
        seed: fixture.seed,
        scope: fixture.scope,
        lookup,
        sequenceSnapshot: fixture.sequenceSnapshot,
        mode: 'generate',
        maxRecursion: 10,
        strictness: 'compatible',
        ...overrides,
    }
}

describe('Composition fragment grammar', () => {
    it('resolves a named multi-line fragment after excluding empty and comment lines', () => {
        const result = resolveFragments(request())

        expect(result.resolvedText).toBe(fixture.cases.named.expected)
        expect(result.success).toBe(true)
        expect(result.usedFragmentIds).toEqual(['fragment:hair'])
        expect(result.randomTrace).toHaveLength(1)
        expect(result.randomTrace[0]).toMatchObject({
            ruleId: 'fragment-random:fragment:hair',
            streamKey: `${fixture.scope}/fragment:fragment:hair`,
            drawIndex: 0,
            seed: fixture.seed,
        })
        expect(result.randomTrace[0].result).not.toMatch(/^\s*#|^\s*$/)
    })

    it('preserves inline hashes while excluding only full comment lines', () => {
        const commentLookup = createFragmentLookup([{
            id: 'fragment:comment-rule',
            path: 'comment-rule',
            lines: [' # hidden', '', 'keep # inline'],
        }])

        expect(resolveFragments(request({
            text: '<comment-rule>',
            lookup: commentLookup,
        })).resolvedText).toBe('keep # inline')
    })

    it('supports nested named fragments and records every selection', () => {
        const result = resolveFragments(request({ text: fixture.cases.nested.input }))

        expect(result.resolvedText).toBe(fixture.cases.nested.expected)
        expect(result.usedFragmentIds).toEqual(['fragment:nested', 'fragment:hair'])
        expect(result.randomTrace.map(trace => trace.ruleId)).toEqual([
            'fragment-random:fragment:nested',
            'fragment-random:fragment:hair',
        ])
    })

    it('preserves the angle → parenthesis → simple slash grammar and URL guard', () => {
        const result = resolveFragments(request({ text: fixture.cases.inlineSlash.input }))

        expect(result.resolvedText).toBe(fixture.cases.inlineSlash.expected)
        expect(result.randomTrace).toHaveLength(3)
        expect(result.randomTrace.map(trace => trace.ruleId)).toEqual([
            expect.stringContaining('fragment-inline:'),
            expect.stringContaining('fragment-parenthesis:'),
            expect.stringContaining('fragment-slash:'),
        ])
        expect(result.resolvedText).toContain('https://example.com/a/b')
    })

    it('accepts case, backslash, leading slash, slash whitespace, and basename aliases', () => {
        const fullPath = resolveFragments(request({ text: fixture.cases.folderAlias.input }))
        const basename = resolveFragments(request({ text: '<CASUAL>' }))

        expect(fullPath.resolvedText).toBe(fixture.cases.folderAlias.expected)
        expect(basename.resolvedText).toBe(fixture.cases.folderAlias.expected)
        expect(fullPath.usedFragmentIds).toEqual(['fragment:casual'])
        expect(basename.usedFragmentIds).toEqual(['fragment:casual'])
    })

    it('never lets an earlier basename alias shadow a canonical root path', () => {
        const collisionLookup = createFragmentLookup([
            { id: 'fragment:folder-shared', path: 'folder/shared', lines: ['folder'] },
            { id: 'fragment:root-shared', path: 'shared', lines: ['root'] },
        ])

        expect(resolveFragments(request({ text: '<folder/shared>', lookup: collisionLookup })).resolvedText)
            .toBe('folder')
        expect(resolveFragments(request({ text: '<shared>', lookup: collisionLookup })).resolvedText)
            .toBe('root')
    })

    it('keeps simple slash choices line-local and leaves spaced choices unchanged', () => {
        const result = resolveFragments(request({
            text: 'red/blue, red hair/blue hair\ngreen/yellow, http://example.com/a/b',
        }))

        expect(result.resolvedText.split('\n')).toHaveLength(2)
        expect(result.resolvedText).toContain('red hair/blue hair')
        expect(result.resolvedText).toContain('http://example.com/a/b')
        expect(result.randomTrace).toHaveLength(2)
    })

    it('allows commas inside parenthesized slash options', () => {
        const result = resolveFragments(request({
            text: '(white hair, blue eyes/red hair, purple eyes)',
        }))

        expect([
            'white hair, blue eyes',
            'red hair, purple eyes',
        ]).toContain(result.resolvedText)
        expect(result.randomTrace).toHaveLength(1)
    })

    it('gives inline pipe syntax precedence over named and sequential syntax', () => {
        const result = resolveFragments(request({ text: '<*hair|literal>, <hair|literal>' }))

        expect(result.usedFragmentIds).toEqual([])
        expect(result.randomTrace).toHaveLength(2)
        expect(result.randomTrace.every(trace => trace.ruleId.startsWith('fragment-inline:'))).toBe(true)
    })
})

describe('Composition fragment failures', () => {
    it.each([
        {
            strictness: 'compatible' as const,
            success: true,
            warningCodes: ['W_FRAGMENT_MISSING'],
            errorCodes: [],
        },
        {
            strictness: 'strict' as const,
            success: false,
            warningCodes: [],
            errorCodes: ['E_FRAGMENT_MISSING'],
        },
    ])('handles a missing fragment under $strictness policy', ({
        strictness,
        success,
        warningCodes,
        errorCodes,
    }) => {
        const result = resolveFragments(request({ text: '<missing>', strictness }))

        expect(result.resolvedText).toBe('<missing>')
        expect(result.success).toBe(success)
        expect(result.warnings.map(issue => issue.code)).toEqual(warningCodes)
        expect(result.errors.map(issue => issue.code)).toEqual(errorCodes)
        expect(result.sequenceCommitProposal).toBeNull()
    })

    it.each([
        { token: '<folder/missing>', strictness: 'compatible' as const, code: 'W_FRAGMENT_MISSING' },
        { token: '<folder/missing>', strictness: 'strict' as const, code: 'E_FRAGMENT_MISSING' },
        { token: '<*folder/missing>', strictness: 'compatible' as const, code: 'W_FRAGMENT_MISSING' },
        { token: '<*folder/missing>', strictness: 'strict' as const, code: 'E_FRAGMENT_MISSING' },
    ])('preserves unresolved folder token $token under $strictness policy', ({ token, strictness, code }) => {
        const result = resolveFragments(request({ text: token, strictness }))

        expect(result.resolvedText).toBe(token)
        expect([...result.warnings, ...result.errors].map(issue => issue.code)).toEqual([code])
        expect(result.randomTrace).toEqual([])
        expect(result.sequenceCommitProposal).toBeNull()
    })

    it('treats a fragment with only empty/comment lines as missing', () => {
        const result = resolveFragments(request({ text: '<empty>' }))

        expect(result.resolvedText).toBe('<empty>')
        expect(result.warnings).toEqual([
            expect.objectContaining({
                code: 'W_FRAGMENT_MISSING',
                fragmentId: 'fragment:empty',
                fragmentPath: 'empty',
                blocking: false,
            }),
        ])
        expect(result.usedFragmentIds).toEqual([])
        expect(result.randomTrace).toEqual([])
    })

    it('stops recursive fragments at the configured limit with a blocking error', () => {
        const result = resolveFragments(request({ text: '<loop>', maxRecursion: 3 }))

        expect(result.resolvedText).toBe('<loop>')
        expect(result.success).toBe(false)
        expect(result.errors).toEqual([
            expect.objectContaining({
                code: 'E_FRAGMENT_RECURSION_LIMIT',
                fragmentPath: 'loop',
                fragmentStack: ['fragment:loop', 'fragment:loop', 'fragment:loop'],
                blocking: true,
            }),
        ])
        expect(result.randomTrace).toHaveLength(3)
        expect(result.sequenceCommitProposal).toBeNull()
    })

    it('converts lookup exceptions into errors without throwing', () => {
        const failingLookup: FragmentLookup = {
            getFragment: () => {
                throw new Error('synthetic lookup failure')
            },
        }
        const result = resolveFragments(request({ text: '<hair>', lookup: failingLookup }))

        expect(result.resolvedText).toBe('<hair>')
        expect(result.success).toBe(false)
        expect(result.errors).toEqual([
            expect.objectContaining({
                code: 'E_FRAGMENT_LOOKUP_FAILED',
                fragmentPath: 'hair',
            }),
        ])
        expect(result.sequenceCommitProposal).toBeNull()
    })
})

describe('Composition sequential fragments', () => {
    it('previews the current line without consuming or proposing a counter change', () => {
        const snapshotBefore = structuredClone(fixture.sequenceSnapshot)
        const first = resolveFragments(request({
            text: '<*outfit>, <*wardrobe/outfit>',
            mode: 'preview',
        }))
        const second = resolveFragments(request({
            text: '<*outfit>, <*wardrobe/outfit>',
            mode: 'preview',
        }))

        expect(first.resolvedText).toBe('dress, dress')
        expect(second).toEqual(first)
        expect(first.randomTrace.map(trace => trace.drawIndex)).toEqual([1, 1])
        expect(first.sequenceCommitProposal).toBeNull()
        expect(fixture.sequenceSnapshot).toEqual(snapshotBefore)
    })

    it('returns a CAS proposal for generation without mutating the snapshot', () => {
        const snapshotBefore = structuredClone(fixture.sequenceSnapshot)
        const result = resolveFragments(request({
            text: fixture.cases.sequential.input,
            mode: 'generate',
        }))

        expect(result.resolvedText).toBe(fixture.cases.sequential.expected)
        expect(result.randomTrace).toEqual([
            expect.objectContaining({
                ruleId: 'fragment-sequential:fragment:outfit',
                drawIndex: fixture.cases.sequential.expectedCounter,
                result: fixture.cases.sequential.expected,
            }),
        ])
        expect(result.sequenceCommitProposal).toEqual({
            expectedRevision: fixture.sequenceSnapshot.revision,
            changes: [{
                fragmentId: 'fragment:outfit',
                fragmentPath: 'wardrobe/outfit',
                expectedCounter: fixture.cases.sequential.expectedCounter,
                nextCounter: fixture.cases.sequential.nextCounter,
            }],
        })
        expect(fixture.sequenceSnapshot).toEqual(snapshotBefore)
    })

    it('allocates repeated aliases against one stable fragment ID counter', () => {
        const result = resolveFragments(request({
            text: '<*outfit>, <*wardrobe/outfit>',
            mode: 'generate',
        }))

        expect(result.resolvedText).toBe('dress, uniform')
        expect(result.randomTrace.map(trace => trace.drawIndex)).toEqual([1, 2])
        expect(result.sequenceCommitProposal?.changes).toEqual([{
            fragmentId: 'fragment:outfit',
            fragmentPath: 'outfit',
            expectedCounter: 1,
            nextCounter: 3,
        }])
    })

    it('suppresses every staged commit when a later strict resolution fails', () => {
        const snapshotBefore = structuredClone(fixture.sequenceSnapshot)
        const result = resolveFragments(request({
            text: '<*outfit>, <missing>',
            mode: 'generate',
            strictness: 'strict',
        }))

        expect(result.resolvedText).toBe('dress, <missing>')
        expect(result.errors.map(issue => issue.code)).toEqual(['E_FRAGMENT_MISSING'])
        expect(result.sequenceCommitProposal).toBeNull()
        expect(fixture.sequenceSnapshot).toEqual(snapshotBefore)
    })
})

describe('Composition fragment determinism', () => {
    it('keeps named-fragment selection independent from unrelated syntax scopes', () => {
        const namedOnly = resolveFragments(request({ text: '<hair>' }))
        const withInlinePrefix = resolveFragments(request({ text: '<a|b>, <hair>' }))

        expect(withInlinePrefix.resolvedText.split(', ').at(-1)).toBe(namedOnly.resolvedText)
        expect(withInlinePrefix.randomTrace.at(-1)?.streamKey).toBe(
            namedOnly.randomTrace[0].streamKey,
        )
        expect(withInlinePrefix.randomTrace.at(-1)?.result).toBe(
            namedOnly.randomTrace[0].result,
        )
    })

    it('returns byte-for-byte equivalent output for the same complete input', () => {
        const input = request({
            text: '<nested>, <red|blue>, (day/night), warm/cool, <*outfit>',
            mode: 'generate',
        })

        expect(resolveFragments(input)).toEqual(resolveFragments(input))
    })

    it('remains stable across 10,000 complete resolutions', () => {
        const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('ambient randomness must not be used')
        })
        const input = request({
            text: '<nested>, <red|blue>, warm/cool, <*outfit>',
            mode: 'generate',
        })
        try {
            const expected = JSON.stringify(resolveFragments(input))

            for (let index = 0; index < 10_000; index += 1) {
                expect(JSON.stringify(resolveFragments(input))).toBe(expected)
            }
            expect(randomSpy).not.toHaveBeenCalled()
        } finally {
            randomSpy.mockRestore()
        }
    })
})
