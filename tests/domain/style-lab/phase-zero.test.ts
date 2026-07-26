import { describe, expect, it } from 'vitest'
import {
    arenaPairKey,
    createStyleEvaluationContext,
    createStyleLabRandom,
    createStylePreferenceEvent,
    recentArenaPairKeys,
    suggestArenaPair,
} from '@/domain/style-lab'
import {
    createEvolutionPlan,
    createRandomWeightedTags,
} from '@/lib/style-lab/genome'

describe('Style-Lab Phase 0 deterministic domain contracts', () => {
    it('keeps a versioned RNG golden vector stable', () => {
        const random = createStyleLabRandom(123456, 'arena')
        expect(Array.from({ length: 5 }, () => random.nextUint32())).toEqual([
            639220975,
            554619277,
            2631831122,
            4018795480,
            4020371201,
        ])
    })

    it('derives the same evaluation identity from equivalent snapshots', () => {
        const left = createStyleEvaluationContext({
            prompt: { template: '{{base}}, {{tags}}', base: 'portrait' },
            plan: { sampler: 'k_euler', dimensions: { width: 832, height: 1216 } },
            model: 'nai-diffusion-4-5-full',
            sampler: 'k_euler',
            seedPack: [41, 42],
            createdAt: 100,
        })
        const right = createStyleEvaluationContext({
            prompt: { base: 'portrait', template: '{{base}}, {{tags}}' },
            plan: { dimensions: { height: 1216, width: 832 }, sampler: 'k_euler' },
            model: 'nai-diffusion-4-5-full',
            sampler: 'k_euler',
            seedPack: [41, 42],
            createdAt: 200,
        })

        expect(right.id).toBe(left.id)
        expect(right.promptHash).toBe(left.promptHash)
        expect(right.planHash).toBe(left.planHash)
        expect(right.createdAt).not.toBe(left.createdAt)
        expect(createStyleEvaluationContext({
            prompt: { template: '{{base}}, {{tags}}', base: 'portrait' },
            plan: { sampler: 'k_euler', dimensions: { width: 832, height: 1216 } },
            model: 'nai-diffusion-4-5-full',
            sampler: 'k_euler',
            seedPack: [99],
        }).id).not.toBe(left.id)
    })

    it('avoids a recently exposed pair while retaining deterministic selection', () => {
        const candidates = ['a', 'b', 'c', 'd'].map((id, index) => ({
            id,
            elo: 1200 - index,
            favorite: true,
        }))
        const firstRandom = createStyleLabRandom(77, 'pair')
        const first = suggestArenaPair(candidates, 'all', {
            random: () => firstRandom.nextFloat(),
        })
        expect(first).not.toBeNull()
        if (first === null) return

        const secondRandom = createStyleLabRandom(77, 'pair')
        const second = suggestArenaPair(candidates, 'all', {
            random: () => secondRandom.nextFloat(),
            recentPairKeys: new Set([arenaPairKey(first[0], first[1])]),
        })
        expect(second).not.toBeNull()
        expect(second && arenaPairKey(second[0], second[1])).not.toBe(arenaPairKey(first[0], first[1]))
    })

    it('projects recent pair history from semantic events', () => {
        const event = createStylePreferenceEvent({
            action: 'impression',
            comboId: 'left',
            opponentId: 'right',
            slot: 'left',
            contextId: 'context',
            createdAt: 10,
        })
        expect(recentArenaPairKeys([event])).toEqual(new Set([arenaPairKey('left', 'right')]))
        expect(() => createStylePreferenceEvent({
            action: 'pair-win',
            comboId: 'left',
            createdAt: 11,
        })).toThrow(/opponentId/)
    })

    it('replays blueprint generation and evolution with the same seed', () => {
        const artists = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
        const randomA = createStyleLabRandom(2026, 'blueprint')
        const randomB = createStyleLabRandom(2026, 'blueprint')
        const tagsA = createRandomWeightedTags(artists, 3, 4, 0.5, 1.5, () => randomA.nextFloat())
        const tagsB = createRandomWeightedTags(artists, 3, 4, 0.5, 1.5, () => randomB.nextFloat())
        expect(tagsB).toEqual(tagsA)

        const candidates = [
            { id: 'one', tags: tagsA, elo: 1300, battles: 4, favorite: true, generation: 0 },
            { id: 'two', tags: tagsA.slice().reverse(), elo: 1250, battles: 3, favorite: true, generation: 0 },
        ]
        const options = {
            artistPool: artists,
            minTags: 2,
            maxTags: 4,
            minWeight: 0.5,
            maxWeight: 1.5,
            parentCount: 2,
            childCount: 2,
            mutationRate: 0.25,
        }
        const evolutionA = createStyleLabRandom(99, 'evolution')
        const evolutionB = createStyleLabRandom(99, 'evolution')
        expect(createEvolutionPlan(candidates, options, () => evolutionA.nextFloat())).toEqual(
            createEvolutionPlan(candidates, options, () => evolutionB.nextFloat()),
        )
    })
})
