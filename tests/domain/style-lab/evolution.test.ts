import { describe, expect, it } from 'vitest'
import {
    createEvolutionLineage,
    mutateStyleGenome,
    proposeStyleEvolution,
    styleCombinationIdentity,
    updateStyleEvolutionArchive,
    type MutableStyleEvolutionOperator,
    type StyleEvolutionTag,
} from '@/domain/style-lab'

const parentA: StyleEvolutionTag[] = [
    { tag: 'a', artist: 'a', kind: 'artist', weight: 0.8 },
    { tag: 'b', artist: 'b', kind: 'artist', weight: 1 },
    { tag: 'c', artist: 'c', kind: 'artist', weight: 1.2 },
    { tag: 'd', artist: 'd', kind: 'artist', weight: 1 },
    { tag: 'e', artist: 'e', kind: 'artist', weight: 0.9 },
]
const parentB: StyleEvolutionTag[] = [
    { tag: 'f', artist: 'f', kind: 'artist', weight: 1.6 },
    { tag: 'g', artist: 'g', kind: 'artist', weight: 0.5 },
    { tag: 'c', artist: 'c', kind: 'artist', weight: 1.4 },
    { tag: 'h', artist: 'h', kind: 'artist', weight: 1 },
]

function only(operator: MutableStyleEvolutionOperator) {
    return Object.fromEntries([
        'tag-add', 'tag-delete', 'tag-replace', 'weight-jitter',
        'weight-mix', 'order-swap', 'order-move', 'parent-splice',
    ].map(name => [name, name === operator ? 1 : 0]))
}

describe('MAP-Elites-lite evolution', () => {
    it('keeps mutation count, uniqueness, and weight invariants for every operator', () => {
        const operators: MutableStyleEvolutionOperator[] = [
            'tag-add', 'tag-delete', 'tag-replace', 'weight-jitter',
            'weight-mix', 'order-swap', 'order-move', 'parent-splice',
        ]
        for (const [index, operator] of operators.entries()) {
            const result = mutateStyleGenome({
                parentA,
                parentB,
                artistPool: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
                minTags: 3,
                maxTags: 8,
                minWeight: 0.4,
                maxWeight: 1.7,
                rngSeed: index + 1,
                weights: only(operator),
            })
            expect(result.tags.length).toBeGreaterThanOrEqual(3)
            expect(result.tags.length).toBeLessThanOrEqual(8)
            expect(new Set(result.tags.map(tag => `${tag.kind}:${tag.tag}`)).size).toBe(result.tags.length)
            expect(result.tags.every(tag => tag.weight >= 0.4 && tag.weight <= 1.7)).toBe(true)
            expect(result.diff.length).toBeGreaterThan(0)
        }
    })

    it('replays proposals exactly and avoids existing render identities', () => {
        const input = {
            boardId: 'board-a',
            candidates: [
                { id: 'a', tags: parentA, generation: 1, predictedUtility: 1, uncertainty: 0.6 },
                { id: 'b', tags: parentB, generation: 2, predictedUtility: 0.5, uncertainty: 1.1 },
            ],
            artistPool: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
            childCount: 8,
            minTags: 3,
            maxTags: 8,
            minWeight: 0.4,
            maxWeight: 1.8,
            rootSeed: 123,
        }
        const first = proposeStyleEvolution(input)
        const replay = proposeStyleEvolution(input)
        const existing = new Set(input.candidates.map(candidate => styleCombinationIdentity(candidate.tags).renderHash))

        expect(first).toEqual(replay)
        expect(first.length).toBeGreaterThan(0)
        expect(first.every(proposal => !existing.has(styleCombinationIdentity(proposal.tags).renderHash))).toBe(true)
        expect(new Set(first.map(proposal => styleCombinationIdentity(proposal.tags).renderHash)).size).toBe(first.length)
    })

    it('retains distinct elite, challenger, and novel members in one cell', () => {
        const candidates = [
            { comboId: 'elite', tags: parentA, score: 3, uncertainty: 0.1, novelty: 0.1, niche: 'same' },
            { comboId: 'challenger', tags: parentA, score: 2, uncertainty: 4, novelty: 0.2, niche: 'same' },
            { comboId: 'novel', tags: parentA, score: 1, uncertainty: 0.2, novelty: 2, niche: 'different' },
        ]
        const [cell] = updateStyleEvolutionArchive({
            boardId: 'board-a', existing: [], candidates, updatedAt: 10,
        })

        expect(cell.elite?.comboId).toBe('elite')
        expect(cell.challenger?.comboId).toBe('challenger')
        expect(cell.novel?.comboId).toBe('novel')
        expect(new Set([cell.elite?.comboId, cell.challenger?.comboId, cell.novel?.comboId]).size).toBe(3)
    })

    it('records reproducible lineage facts', () => {
        const lineage = createEvolutionLineage({
            childId: 'child', boardId: 'board-a', parentIds: ['a', 'b'],
            operator: 'parent-splice', diff: ['splice:2:1'], rngSeed: 7,
            generation: 3, createdAt: 10,
        })
        expect(lineage).toEqual(createEvolutionLineage({
            childId: 'child', boardId: 'board-a', parentIds: ['a', 'b'],
            operator: 'parent-splice', diff: ['splice:2:1'], rngSeed: 7,
            generation: 3, createdAt: 10,
        }))
        expect(lineage.algorithmVersion).toBe('style-map-elites-lite-v1')
    })
})
