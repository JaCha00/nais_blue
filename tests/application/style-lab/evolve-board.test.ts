import { describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import type { GenerationJob } from '@/domain/queue/types'
import { createStylePreferenceEvent, createTasteBoard, styleCombinationIdentity } from '@/domain/style-lab'
import { evolveStyleBoard } from '@/application/style-lab/evolve-board'
import { IndexedDbStyleLabRepository } from '@/services/style-lab/indexeddb-style-lab-repository'
import type { StyleCombination, StyleLabSettings } from '@/stores/style-lab-store'

function memoryStorage(): StateStorage {
    const values = new Map<string, string>()
    return {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value) },
        removeItem: async key => { values.delete(key) },
    }
}

function combination(id: string, names: string[], preference = false): StyleCombination {
    const tags = names.map(name => ({ tag: name, artist: name, kind: 'artist' as const, weight: 1 }))
    return {
        id,
        tags,
        ...styleCombinationIdentity(tags),
        lifecycle: 'draft',
        elo: 1200,
        legacyElo: 1200,
        wins: 0,
        losses: 0,
        ties: 0,
        battles: preference ? 1 : 0,
        legacyBattles: 0,
        favorite: preference,
        legacyFavorite: false,
        locked: false,
        note: '',
        generation: 0,
        createdAt: 1,
        updatedAt: 1,
    }
}

const settings: StyleLabSettings = {
    minTags: 2,
    maxTags: 5,
    minWeight: 0.4,
    maxWeight: 1.8,
    randomBatchCount: 8,
    battleLeague: 'all',
    promptTemplate: '{{artist_tags}}',
    previewDelayMs: 500,
    autoPreviewBattlePair: false,
    evolutionParentCount: 4,
    evolutionChildrenCount: 8,
    mutationRate: 0.2,
}

describe('evolveStyleBoard', () => {
    it('persists child lineage/archive and never auto-renders beyond the configured slice', async () => {
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'evolve-board')
        const candidates = [
            combination('a', ['a', 'b', 'c'], true),
            combination('b', ['d', 'e', 'f'], true),
            combination('c', ['g', 'h', 'i']),
        ]
        await repository.appendPreferenceEvents(null, [
            createStylePreferenceEvent({ action: 'collect', comboId: 'a', boardId: 'board-a', createdAt: 2 }),
            createStylePreferenceEvent({ action: 'apply', comboId: 'b', boardId: 'board-a', createdAt: 3 }),
        ])
        const board = createTasteBoard({
            id: 'board-a', name: 'Board A', autoEvolution: true,
            budgetId: 'budget-auto-a', createdAt: 1,
        })
        let nextId = 0
        let requestedIds: readonly string[] = []
        const result = await evolveStyleBoard({
            candidates,
            board,
            settings,
            artistPool: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
            randomSeed: 77,
            repository,
            addCombination: () => `child-${nextId++}`,
            now: 10,
            autoRenderLimit: 2,
            requestRenders: async ids => {
                requestedIds = ids
                return {
                    jobs: ids.map(id => ({ id }) as GenerationJob),
                    reservations: [],
                    rejected: [],
                }
            },
        })

        expect(result.childIds.length).toBeGreaterThan(0)
        expect(result.lineages.map(lineage => lineage.childId)).toEqual(result.childIds)
        expect(await repository.listEvolutionLineages()).toEqual(result.lineages)
        expect(await repository.listEvolutionArchive('board-a')).toEqual(result.archive)
        expect(requestedIds).toEqual(result.childIds.slice(0, 2))
        expect(result.queuedRenderCount).toBeLessThanOrEqual(2)
    })
})
