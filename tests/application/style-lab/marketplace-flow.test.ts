import { describe, expect, it } from 'vitest'
import { buildMarketShelf } from '@/application/style-lab/build-market-shelf'
import {
    createTasteBoard as createTasteBoardUseCase,
    deleteTasteBoard,
    ensureTasteBoards,
    updateTasteBoard,
} from '@/application/style-lab/manage-taste-boards'
import { recordMarketAction } from '@/application/style-lab/record-market-action'
import type { StyleLabRepository } from '@/application/style-lab/style-lab-repository'
import {
    DEFAULT_TASTE_BOARD_ID,
    type PreferenceProjection,
    type StyleEvaluationContext,
    type StylePreferenceEvent,
    type TasteBoard,
} from '@/domain/style-lab'

class MemoryStyleLabRepository implements StyleLabRepository {
    readonly contexts: StyleEvaluationContext[] = []
    readonly events: StylePreferenceEvent[] = []
    projections: PreferenceProjection[] = []
    boards: TasteBoard[] = []

    async appendPreferenceEvents(
        context: StyleEvaluationContext | null,
        events: readonly StylePreferenceEvent[],
    ): Promise<void> {
        if (context && !this.contexts.some(existing => existing.id === context.id)) {
            this.contexts.push(context)
        }
        this.events.push(...events)
    }

    async listPreferenceEvents(): Promise<StylePreferenceEvent[]> {
        return [...this.events]
    }

    async listRecentPreferenceEvents(limit = 100): Promise<StylePreferenceEvent[]> {
        return this.events.slice(-limit)
    }

    async replacePreferenceProjections(projections: readonly PreferenceProjection[]): Promise<void> {
        this.projections = [...projections]
    }

    async listPreferenceProjections(): Promise<PreferenceProjection[]> {
        return [...this.projections]
    }

    async putTasteBoard(board: TasteBoard): Promise<void> {
        this.boards = [...this.boards.filter(existing => existing.id !== board.id), board]
            .sort((left, right) => left.createdAt - right.createdAt)
    }

    async deleteTasteBoard(boardId: string): Promise<void> {
        this.boards = this.boards.filter(board => board.id !== boardId)
    }

    async listTasteBoards(): Promise<TasteBoard[]> {
        return [...this.boards]
    }
}

function candidates(count: number) {
    return Array.from({ length: count }, (_, index) => ({
        id: `combo-${String(index).padStart(2, '0')}`,
        tags: [{ tag: `family-${index % 6}`, kind: 'artist' }],
        generation: index % 4,
        createdAt: index,
        legacyElo: 1200,
        legacyBattles: 0,
        legacyFavorite: false,
    }))
}

describe('Style-Lab TasteBoard use cases', () => {
    it('creates, updates, and deletes repository-owned boards', async () => {
        const repository = new MemoryStyleLabRepository()
        const initial = await ensureTasteBoards({ repository, defaultName: 'My Taste', now: 1 })
        expect(initial[0]).toMatchObject({ id: DEFAULT_TASTE_BOARD_ID, name: 'My Taste' })

        const created = await createTasteBoardUseCase({ repository, name: 'Landscape', now: 2 })
        const landscape = created.find(board => board.name === 'Landscape')
        expect(landscape).toBeDefined()
        if (!landscape) return
        const updated = await updateTasteBoard({
            repository,
            board: landscape,
            exploration: 0.8,
            now: 3,
        })
        expect(updated.find(board => board.id === landscape.id)?.exploration).toBe(0.8)

        const remaining = await deleteTasteBoard({ repository, boardId: landscape.id })
        expect(remaining.map(board => board.id)).toEqual([DEFAULT_TASTE_BOARD_ID])
    })
})

describe('Style-Lab Marketplace application flow', () => {
    it('commits shelf impressions and changes a repeated seeded shelf', async () => {
        const repository = new MemoryStyleLabRepository()
        const [board] = await ensureTasteBoards({ repository, defaultName: 'My Taste', now: 1 })
        const pool = candidates(40)
        const first = await buildMarketShelf({
            candidates: pool,
            board,
            randomSeed: 77,
            repository,
            now: 10,
        })
        const second = await buildMarketShelf({
            candidates: pool,
            board,
            randomSeed: 77,
            repository,
            now: 11,
        })

        expect(first.shelf).toHaveLength(16)
        expect(first.impressions).toHaveLength(16)
        expect(first.impressions.every(event => (
            event.action === 'impression' && event.boardId === board.id
        ))).toBe(true)
        expect(new Set(first.impressions.map(event => event.slot))).toHaveLength(16)
        expect(repository.events).toHaveLength(32)
        expect(second.shelf.map(item => item.comboId)).not.toEqual(first.shelf.map(item => item.comboId))
        expect(repository.projections.reduce((sum, projection) => sum + projection.views, 0)).toBe(32)
    })

    it('toggles global and board actions through compensating undo events', async () => {
        const repository = new MemoryStyleLabRepository()
        const pool = candidates(3)
        const [boardA] = await ensureTasteBoards({ repository, defaultName: 'Board A', now: 1 })
        const boards = await createTasteBoardUseCase({ repository, name: 'Board B', now: 2 })
        const boardB = boards.find(board => board.id !== boardA.id)
        if (!boardB) throw new Error('Board B fixture was not created')

        const likeOn = await recordMarketAction({
            candidates: pool, action: 'like', comboId: pool[0].id,
            boardId: boardA.id, repository, now: 10,
        })
        const likeOff = await recordMarketAction({
            candidates: pool, action: 'like', comboId: pool[0].id,
            boardId: boardA.id, repository, now: 11,
        })
        expect(likeOn.toggledOn).toBe(true)
        expect(likeOff.event.action).toBe('undo')
        expect(likeOff.interactions.likedIds).toEqual(new Set())

        await recordMarketAction({
            candidates: pool, action: 'collect', comboId: pool[1].id,
            boardId: boardA.id, repository, now: 12,
        })
        const boardBCollect = await recordMarketAction({
            candidates: pool, action: 'collect', comboId: pool[2].id,
            boardId: boardB.id, repository, now: 13,
        })
        expect(boardBCollect.interactions.collectedIds).toEqual(new Set([pool[2].id]))

        const applied = await recordMarketAction({
            candidates: pool, action: 'apply', comboId: pool[2].id,
            boardId: boardB.id, repository, now: 14,
        })
        expect(applied.event.action).toBe('apply')
        expect(applied.interactions.appliedIds).toContain(pool[2].id)
        expect(repository.projections.find(item => item.comboId === pool[2].id)?.mu).toBeGreaterThan(0)
    })

    it('excludes a hidden candidate from subsequent shelves', async () => {
        const repository = new MemoryStyleLabRepository()
        const pool = candidates(20)
        const [board] = await ensureTasteBoards({ repository, defaultName: 'Board', now: 1 })
        await recordMarketAction({
            candidates: pool,
            action: 'hide',
            comboId: pool[0].id,
            boardId: board.id,
            repository,
            now: 2,
        })
        const result = await buildMarketShelf({
            candidates: pool,
            board,
            randomSeed: 3,
            repository,
            now: 3,
        })

        expect(result.hiddenIds).toContain(pool[0].id)
        expect(result.shelf.some(item => item.comboId === pool[0].id)).toBe(false)
    })
})
