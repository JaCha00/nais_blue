import { describe, expect, it } from 'vitest'
import {
    adaptiveMutationWeights,
    createStyleEvaluationContext,
    createStylePreferenceEvent,
    extractContextualStyleFeatures,
    rankContextualStyleCandidates,
    trainContextualPreferenceModel,
} from '@/domain/style-lab'

const candidates = Array.from({ length: 20 }, (_, index) => ({
    id: `candidate-${index}`,
    tags: [
        { tag: index < 10 ? 'dreamy' : 'graphic', kind: 'style', weight: 1.4 },
        { tag: `artist-${index % 3}`, kind: 'artist', weight: 0.8 + (index % 2) * 0.2 },
    ],
    generation: index % 4,
    lineage: { operator: index % 2 === 0 ? 'weight-jitter' : 'parent-splice', parentIds: ['p1', 'p2'] },
}))

const context = createStyleEvaluationContext({
    prompt: { base: 'portrait' }, plan: { resolution: 'square' },
    model: 'nai-v4', sampler: 'k_euler', seedPack: [7], createdAt: 1,
})

describe('Style-Lab contextual preference model', () => {
    it('extracts tag, weight, order, pair, generation, lineage, board, and context features', () => {
        const features = extractContextualStyleFeatures({
            candidate: candidates[0], boardId: 'board-a', context,
        })
        expect(Object.keys(features)).toEqual(expect.arrayContaining([
            'tag:style:dreamy',
            'weight:style:dreamy',
            'order:style:dreamy',
            'pair:artist:artist-0+style:dreamy',
            'generation',
            'lineage:weight-jitter',
            'board:board-a|tag:style:dreamy',
            'context:model:nai-v4',
            'context:sampler:k_euler',
        ]))
    })

    it('learns separate board directions and beats a random half-hit render selection', () => {
        const events = [
            ...candidates.slice(0, 7).flatMap((candidate, index) => [
                createStylePreferenceEvent({
                    action: 'collect', comboId: candidate.id, boardId: 'board-a',
                    contextId: context.id, createdAt: 10 + index * 2,
                }),
                createStylePreferenceEvent({
                    action: 'apply', comboId: candidate.id, boardId: 'board-a',
                    contextId: context.id, createdAt: 11 + index * 2,
                }),
            ]),
            ...candidates.slice(10, 17).flatMap((candidate, index) => [
                createStylePreferenceEvent({
                    action: 'collect', comboId: candidate.id, boardId: 'board-b',
                    contextId: context.id, createdAt: 40 + index * 2,
                }),
                createStylePreferenceEvent({
                    action: 'apply', comboId: candidate.id, boardId: 'board-b',
                    contextId: context.id, createdAt: 41 + index * 2,
                }),
            ]),
        ]
        const boardA = trainContextualPreferenceModel({
            boardId: 'board-a', candidates, events, contexts: [context],
        })
        const boardB = trainContextualPreferenceModel({
            boardId: 'board-b', candidates, events, contexts: [context],
        })
        const rankedA = rankContextualStyleCandidates({ state: boardA, candidates, context })
        const rankedB = rankContextualStyleCandidates({ state: boardB, candidates, context })
        const topAHitRate = rankedA.slice(0, 8).filter(item => Number(item.comboId.split('-')[1]) < 10).length / 8
        const topBHitRate = rankedB.slice(0, 8).filter(item => Number(item.comboId.split('-')[1]) >= 10).length / 8

        expect(topAHitRate).toBeGreaterThan(0.5)
        expect(topBHitRate).toBeGreaterThan(0.5)
        expect(rankedA.map(item => item.comboId)).not.toEqual(rankedB.map(item => item.comboId))
        expect(trainContextualPreferenceModel({
            boardId: 'board-a', candidates, events, contexts: [context],
        })).toEqual(boardA)
    })

    it('turns learned feature families into bounded adaptive mutation weights', () => {
        const events = candidates.slice(0, 5).map((candidate, index) => createStylePreferenceEvent({
            action: 'collect', comboId: candidate.id, boardId: 'board-a', createdAt: index + 1,
        }))
        const state = trainContextualPreferenceModel({ boardId: 'board-a', candidates, events })
        const weights = adaptiveMutationWeights(state)

        expect(weights['tag-add']).toBeGreaterThan(1)
        expect(weights['weight-jitter']).toBeGreaterThan(1)
        expect(Object.values(weights).every(value => value > 0 && value <= 3)).toBe(true)
    })
})
