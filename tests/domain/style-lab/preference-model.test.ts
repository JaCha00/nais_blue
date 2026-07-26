import { describe, expect, it } from 'vitest'
import {
    STYLE_PREFERENCE_MODEL_VERSION,
    createPreferencePrior,
    createStylePreferenceEvent,
    isPreferenceProjection,
    replayPreferenceEvents,
    scoreArenaPair,
    suggestArenaPair,
    type PreferenceProjection,
} from '@/domain/style-lab'
import { applyArenaTieResult } from '@/lib/style-lab'

function projection(
    comboId: string,
    overrides: Partial<PreferenceProjection> = {},
): PreferenceProjection {
    return {
        modelVersion: STYLE_PREFERENCE_MODEL_VERSION,
        comboId,
        mu: 0,
        sigma: 1.4,
        evidence: 0,
        views: 0,
        lastShownAt: null,
        updatedAt: 0,
        ...overrides,
    }
}

describe('Style-Lab Gaussian preference model', () => {
    it('deterministically raises a winner while reducing both candidates uncertainty', () => {
        const candidates = [{ id: 'left' }, { id: 'right' }]
        const events = [
            createStylePreferenceEvent({
                action: 'impression',
                comboId: 'left',
                opponentId: 'right',
                createdAt: 10,
            }),
            createStylePreferenceEvent({
                action: 'impression',
                comboId: 'right',
                opponentId: 'left',
                createdAt: 10,
            }),
            createStylePreferenceEvent({
                action: 'pair-win',
                comboId: 'left',
                opponentId: 'right',
                createdAt: 11,
            }),
        ]

        const first = replayPreferenceEvents(candidates, events)
        const replay = replayPreferenceEvents(candidates, events)

        expect(replay).toEqual(first)
        expect(first.projections.left.mu).toBeGreaterThan(0)
        expect(first.projections.right.mu).toBeLessThan(0)
        expect(first.projections.left.sigma).toBeLessThan(1.4)
        expect(first.projections.right.sigma).toBeLessThan(1.4)
        expect(first.projections.left).toMatchObject({ evidence: 1, views: 1, lastShownAt: 10 })
    })

    it('treats a tie as weaker evidence that brings separated means closer', () => {
        const candidates = [
            { id: 'left', legacyElo: 1600 },
            { id: 'right', legacyElo: 800 },
        ]
        const before = replayPreferenceEvents(candidates, [])
        const after = replayPreferenceEvents(candidates, [createStylePreferenceEvent({
            action: 'pair-tie',
            comboId: 'left',
            opponentId: 'right',
            createdAt: 20,
        })])

        const gapBefore = before.projections.left.mu - before.projections.right.mu
        const gapAfter = after.projections.left.mu - after.projections.right.mu
        expect(gapAfter).toBeLessThan(gapBefore)
        expect(after.projections.left.evidence).toBe(0.75)
        expect(after.projections.right.evidence).toBe(0.75)
        expect(after.projections.left.sigma).toBeLessThan(before.projections.left.sigma)
    })

    it('records skip exposure without changing preference evidence', () => {
        const candidates = [{ id: 'left', legacyElo: 1320, legacyBattles: 3 }]
        const prior = createPreferencePrior(candidates[0])
        const events = [
            createStylePreferenceEvent({
                action: 'impression',
                comboId: 'left',
                opponentId: 'right',
                createdAt: 30,
            }),
            createStylePreferenceEvent({
                action: 'skip',
                comboId: 'left',
                opponentId: 'right',
                createdAt: 31,
            }),
        ]
        const result = replayPreferenceEvents(candidates, events).projections.left

        expect(result).toMatchObject({
            mu: prior.mu,
            sigma: prior.sigma,
            evidence: 0,
            views: 1,
            lastShownAt: 30,
        })
    })

    it('rebuilds without an event superseded by append-only undo', () => {
        const win = createStylePreferenceEvent({
            action: 'pair-win',
            comboId: 'left',
            opponentId: 'right',
            createdAt: 40,
        })
        const undo = createStylePreferenceEvent({
            action: 'undo',
            comboId: 'left',
            supersedesId: win.id,
            createdAt: 41,
        })
        const result = replayPreferenceEvents([{ id: 'left' }, { id: 'right' }], [win, undo])

        expect(result.projections.left).toEqual(createPreferencePrior({ id: 'left' }))
        expect(result.projections.right).toEqual(createPreferencePrior({ id: 'right' }))
    })

    it('converts legacy ranking and battle count into a deliberately weak prior', () => {
        const prior = createPreferencePrior({
            id: 'legacy',
            legacyElo: 1600,
            legacyBattles: 20,
            legacyFavorite: true,
        })

        expect(prior.mu).toBeGreaterThan(0)
        expect(prior.mu).toBeLessThan(0.5)
        expect(prior.sigma).toBeLessThan(1.4)
        expect(prior.sigma).toBeGreaterThanOrEqual(0.7)
        expect(prior.evidence).toBe(0)
        expect(isPreferenceProjection({ ...prior, lastShownAt: -1 })).toBe(false)
    })
})

describe('Style-Lab information-value pair policy', () => {
    const candidates = ['a', 'b', 'c', 'd'].map(id => ({ id, elo: 1200, favorite: true }))

    it('prefers a close, uncertain, under-exposed pair', () => {
        const projections = {
            a: projection('a', { mu: 0, sigma: 1.4 }),
            b: projection('b', { mu: 0.05, sigma: 1.3 }),
            c: projection('c', { mu: 0, sigma: 0.35, views: 20 }),
            d: projection('d', { mu: 1.5, sigma: 0.4, views: 20 }),
        }

        expect(scoreArenaPair(candidates[0], candidates[1], { projections })).toBeGreaterThan(
            scoreArenaPair(candidates[2], candidates[3], { projections }),
        )
        const selected = suggestArenaPair(candidates, 'all', {
            projections,
            random: () => 0.25,
        })
        expect(selected && new Set(selected)).toEqual(new Set(['a', 'b']))
    })

    it('strongly penalizes an immediately repeated pair', () => {
        const projections = Object.fromEntries(candidates.map(candidate => [
            candidate.id,
            projection(candidate.id),
        ]))
        const recentPairKeys = new Set(['a\u0000b'])

        expect(scoreArenaPair(candidates[0], candidates[1], { projections, recentPairKeys })).toBeLessThan(
            scoreArenaPair(candidates[0], candidates[2], { projections, recentPairKeys }),
        )
    })
})

describe('Style-Lab legacy Arena compatibility projection', () => {
    it('counts a tie for both candidates without changing Elo or win/loss totals', () => {
        const candidates = ['left', 'right'].map(id => ({
            id,
            elo: 1200,
            favorite: false,
            wins: 1,
            losses: 2,
            ties: 0,
            battles: 3,
            updatedAt: 1,
        }))

        const updated = applyArenaTieResult(candidates, 'left', 'right', 50)

        expect(updated).toEqual(candidates.map(candidate => ({
            ...candidate,
            ties: 1,
            battles: 4,
            updatedAt: 50,
        })))
    })
})
