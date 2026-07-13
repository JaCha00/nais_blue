import { describe, expect, it } from 'vitest'

import {
    CANONICAL_MAIN_PROMPT_SLOT_ORDER,
    composePromptContributions,
    finalizePromptComposition,
    mapPromptCompositionDraft,
    mapPromptCompositionDraftAsync,
    normalizePromptContributions,
    removePromptCommentLines,
} from '@/domain/composition/prompt-normalizer'
import type {
    PromptContribution,
    PromptTarget,
} from '@/domain/composition/types'

interface ContributionFixture {
    id: string
    orderKey: string
    target: PromptTarget
    text: string
    enabled?: boolean
    merge?: PromptContribution['merge']
    separator?: PromptContribution['separator']
}

const actor = { kind: 'agent', id: 'actor:prompt-normalizer-test' } as const
const timestamp = '2026-07-11T00:00:00.000Z'

function contribution(fixture: ContributionFixture): PromptContribution {
    return {
        id: fixture.id,
        orderKey: fixture.orderKey,
        revision: 1,
        createdAt: timestamp,
        createdBy: actor,
        updatedAt: timestamp,
        updatedBy: actor,
        enabled: fixture.enabled ?? true,
        target: fixture.target,
        text: fixture.text,
        merge: fixture.merge ?? 'append',
        ...(fixture.separator === undefined ? {} : { separator: fixture.separator }),
    }
}

function positive(slot: Extract<PromptTarget, { kind: 'positive' }>['slot']): PromptTarget {
    return { kind: 'positive', slot }
}

describe('Composition Domain v2 prompt normalizer', () => {
    it('removes only full comment lines and preserves inline hashes', () => {
        const source = [
            '# remove',
            '   # remove after leading whitespace',
            '\t# remove after a tab',
            'keep # inline',
            'also keep#inline',
        ].join('\r\n')

        expect(removePromptCommentLines(source)).toBe('keep # inline\nalso keep#inline')
    })

    it('uses the canonical main slot order and folds compatibility slots into workflow', () => {
        const result = normalizePromptContributions([
            contribution({ id: 'c:detail', orderKey: '01', target: positive('detail'), text: 'detail' }),
            contribution({ id: 'c:workflow', orderKey: '01', target: positive('workflow'), text: 'workflow' }),
            contribution({ id: 'c:base', orderKey: '01', target: positive('base'), text: 'base' }),
            contribution({ id: 'c:additional', orderKey: '01', target: positive('additional'), text: 'additional' }),
            contribution({ id: 'c:inpainting', orderKey: '01', target: positive('inpainting'), text: 'inpainting' }),
            contribution({ id: 'c:scene', orderKey: '02', target: positive('scene'), text: 'scene-compatible' }),
            contribution({ id: 'c:style', orderKey: '03', target: positive('style'), text: 'style-compatible' }),
            contribution({ id: 'c:quality', orderKey: '04', target: positive('quality'), text: 'quality-compatible' }),
        ])

        expect(CANONICAL_MAIN_PROMPT_SLOT_ORDER).toEqual([
            'base',
            'inpainting',
            'additional',
            'workflow',
            'detail',
        ])
        expect(result.main).toEqual({
            base: 'base',
            inpainting: 'inpainting',
            additional: 'additional',
            workflow: 'workflow, scene-compatible, style-compatible, quality-compatible',
            detail: 'detail',
        })
        expect(result.positive).toBe(
            'base, inpainting, additional, workflow, scene-compatible, style-compatible, quality-compatible, detail',
        )
    })

    it.each([
        {
            name: 'append',
            fixtures: [
                { id: 'c:a', orderKey: '01', text: 'alpha', merge: 'append' as const },
                { id: 'c:b', orderKey: '02', text: 'beta', merge: 'append' as const },
            ],
            expected: 'alpha, beta',
        },
        {
            name: 'prepend',
            fixtures: [
                { id: 'c:a', orderKey: '01', text: 'alpha', merge: 'append' as const },
                { id: 'c:b', orderKey: '02', text: 'beta', merge: 'prepend' as const },
            ],
            expected: 'beta, alpha',
        },
        {
            name: 'replace',
            fixtures: [
                { id: 'c:a', orderKey: '01', text: 'discarded', merge: 'append' as const },
                { id: 'c:b', orderKey: '02', text: 'replacement', merge: 'replace' as const },
                { id: 'c:c', orderKey: '03', text: 'tail', merge: 'append' as const },
            ],
            expected: 'replacement, tail',
        },
        {
            name: 'stable ID tie-break',
            fixtures: [
                { id: 'c:z', orderKey: 'same', text: 'second', merge: 'append' as const },
                { id: 'c:a', orderKey: 'same', text: 'first', merge: 'append' as const },
            ],
            expected: 'first, second',
        },
    ])('applies $name in orderKey and stable ID order', ({ fixtures, expected }) => {
        const draft = composePromptContributions(fixtures.map(fixture => contribution({
            ...fixture,
            target: positive('base'),
        })))

        expect(draft.main.base).toBe(expected)
    })

    it('skips disabled contributions and applies comment removal to character polarities', () => {
        const draft = composePromptContributions([
            contribution({
                id: 'c:main',
                orderKey: '01',
                target: positive('base'),
                text: '# comment\nkeep # inline\n  # another comment\nlast',
                separator: 'newline',
            }),
            contribution({
                id: 'c:disabled',
                orderKey: '02',
                target: positive('base'),
                text: 'must-not-appear',
                enabled: false,
            }),
            contribution({
                id: 'c:character-positive',
                orderKey: '01',
                target: { kind: 'character', characterId: 'character:a', polarity: 'positive' },
                text: '  # hidden\nhero # inline',
            }),
            contribution({
                id: 'c:character-negative',
                orderKey: '01',
                target: { kind: 'character', characterId: 'character:a', polarity: 'negative' },
                text: '# hidden\nblur',
            }),
        ])

        expect(draft.main.base).toBe('keep # inline\nlast')
        expect(draft.characters).toEqual([{
            characterId: 'character:a',
            positive: 'hero # inline',
            negative: 'blur',
        }])
    })

    it('keeps positive, negative, and each character polarity in independent dedupe scopes', () => {
        const result = normalizePromptContributions([
            contribution({ id: 'c:positive', orderKey: '01', target: positive('base'), text: 'shared, positive-only' }),
            contribution({ id: 'c:negative', orderKey: '01', target: { kind: 'negative' }, text: 'shared, negative-only' }),
            contribution({
                id: 'c:char-a-pos',
                orderKey: '01',
                target: { kind: 'character', characterId: 'character:a', polarity: 'positive' },
                text: 'shared, shared',
            }),
            contribution({
                id: 'c:char-a-neg',
                orderKey: '01',
                target: { kind: 'character', characterId: 'character:a', polarity: 'negative' },
                text: 'shared',
            }),
            contribution({
                id: 'c:char-b-pos',
                orderKey: '01',
                target: { kind: 'character', characterId: 'character:b', polarity: 'positive' },
                text: 'shared',
            }),
        ])

        expect(result.positive).toBe('shared, positive-only')
        expect(result.negative).toBe('shared, negative-only')
        expect(result.characters).toEqual([
            { characterId: 'character:a', positive: 'shared', negative: 'shared' },
            { characterId: 'character:b', positive: 'shared', negative: '' },
        ])
    })

    it('applies ordered operations after target-local initial character text', () => {
        const draft = composePromptContributions([
            contribution({
                id: 'c:character-prepend',
                orderKey: '01',
                target: { kind: 'character', characterId: 'character:a', polarity: 'positive' },
                text: 'portrait',
                merge: 'prepend',
            }),
            contribution({
                id: 'c:character-append',
                orderKey: '02',
                target: { kind: 'character', characterId: 'character:a', polarity: 'positive' },
                text: 'blue eyes',
            }),
        ], {
            characters: [{ characterId: 'character:a', positive: 'hero base', negative: 'hat' }],
        })

        expect(draft.characters).toEqual([{
            characterId: 'character:a',
            positive: 'portrait, hero base, blue eyes',
            negative: 'hat',
        }])
    })

    it.each([
        {
            policy: 'exact-token' as const,
            expectedBase: 'cat, dog, {cat:1.2}, [cat], 1.2::cat::',
            expectedAdditional: 'bird',
        },
        {
            policy: 'none' as const,
            expectedBase: 'cat, dog, cat, {cat:1.2}, {cat:1.2}, [cat], 1.2::cat::, 1.2::cat::',
            expectedAdditional: 'cat, bird',
        },
    ])('supports $policy dedupe without conflating weighted syntax', ({ policy, expectedBase, expectedAdditional }) => {
        const result = normalizePromptContributions([
            contribution({
                id: 'c:base',
                orderKey: '01',
                target: positive('base'),
                text: ' cat, dog, cat , {cat:1.2}, {cat:1.2}, [cat], 1.2::cat::, 1.2::cat:: ',
            }),
            contribution({
                id: 'c:additional',
                orderKey: '01',
                target: positive('additional'),
                text: 'cat, bird',
            }),
        ], { dedupe: policy })

        expect(result.main.base).toBe(expectedBase)
        expect(result.main.additional).toBe(expectedAdditional)
    })

    it('places wildcard expansion between composition and exact-token dedupe', () => {
        const draft = composePromptContributions([
            contribution({
                id: 'c:wildcard',
                orderKey: '01',
                target: positive('base'),
                text: '__animal__, cat',
            }),
        ])
        expect(draft.main.base).toBe('__animal__, cat')

        const expanded = mapPromptCompositionDraft(draft, text => text.replace('__animal__', 'cat'))
        const finalized = finalizePromptComposition(expanded)

        expect(finalized.main.base).toBe('cat')
        expect(finalized.positive).toBe('cat')
    })

    it('supports an async caller-owned wildcard boundary without implementing a resolver', async () => {
        const draft = composePromptContributions([
            contribution({ id: 'c:wildcard', orderKey: '01', target: positive('base'), text: '__animal__, cat' }),
            contribution({
                id: 'c:character-positive',
                orderKey: '01',
                target: { kind: 'character', characterId: 'character:a', polarity: 'positive' },
                text: '__hair__, blue hair',
            }),
            contribution({
                id: 'c:character-negative',
                orderKey: '01',
                target: { kind: 'character', characterId: 'character:a', polarity: 'negative' },
                text: 'hat',
            }),
        ])
        const calls: string[] = []
        const expanded = await mapPromptCompositionDraftAsync(draft, async (text, target) => {
            calls.push(target.kind === 'positive'
                ? target.slot
                : target.kind === 'negative'
                    ? 'negative'
                    : `${target.characterId}:${target.polarity}`)
            await Promise.resolve()
            return text.replace('__animal__', 'cat').replace('__hair__', 'blue hair')
        })

        expect(finalizePromptComposition(expanded).positive).toBe('cat')
        expect(finalizePromptComposition(expanded).characters).toEqual([{
            characterId: 'character:a',
            positive: 'blue hair',
            negative: 'hat',
        }])
        expect(calls).toEqual([
            'base',
            'inpainting',
            'additional',
            'workflow',
            'detail',
            'negative',
            'character:a:positive',
            'character:a:negative',
        ])
    })
})
