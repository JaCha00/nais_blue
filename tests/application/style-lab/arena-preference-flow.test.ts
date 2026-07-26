import { describe, expect, it, vi } from 'vitest'
import type { StyleLabRepository } from '@/application/style-lab/style-lab-repository'
import { exposeArenaPair } from '@/application/style-lab/expose-arena-pair'
import {
    recordArenaSkip,
    recordArenaTie,
    recordArenaWin,
} from '@/application/style-lab/record-preference'
import { suggestArenaPair } from '@/application/style-lab/suggest-arena-pair'
import {
    arenaPairKey,
    createStyleEvaluationContext,
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

    constructor(private readonly failProjectionWrites = false) {}

    async appendPreferenceEvents(
        context: StyleEvaluationContext | null,
        events: readonly StylePreferenceEvent[],
    ): Promise<void> {
        if (context !== null && !this.contexts.some(existing => existing.id === context.id)) {
            this.contexts.push(context)
        }
        this.events.push(...events)
    }

    async listRecentPreferenceEvents(limit = 100): Promise<StylePreferenceEvent[]> {
        return this.events.slice(-limit)
    }

    async listPreferenceEvents(): Promise<StylePreferenceEvent[]> {
        return [...this.events]
    }

    async replacePreferenceProjections(
        projections: readonly PreferenceProjection[],
    ): Promise<void> {
        if (this.failProjectionWrites) throw new Error('synthetic projection cache failure')
        this.projections = [...projections]
    }

    async listPreferenceProjections(): Promise<PreferenceProjection[]> {
        return [...this.projections]
    }

    async putTasteBoard(board: TasteBoard): Promise<void> {
        this.boards = [...this.boards.filter(existing => existing.id !== board.id), board]
    }

    async deleteTasteBoard(boardId: string): Promise<void> {
        this.boards = this.boards.filter(board => board.id !== boardId)
    }

    async listTasteBoards(): Promise<TasteBoard[]> {
        return [...this.boards]
    }
}

function evaluationContext() {
    return createStyleEvaluationContext({
        prompt: { base: 'portrait' },
        plan: { model: 'model' },
        model: 'model',
        sampler: 'sampler',
        seedPack: [7],
        createdAt: 1,
    })
}

describe('Style-Lab Arena preference flow', () => {
    it('records exposure before returning and avoids it on the next suggestion', async () => {
        const repository = new MemoryStyleLabRepository()
        const context = evaluationContext()
        const candidates = ['a', 'b', 'c'].map(id => ({ id, elo: 1200, favorite: true }))
        const first = await suggestArenaPair({
            candidates,
            league: 'all',
            context,
            randomSeed: 91,
            repository,
            now: 2,
        })
        expect(first).not.toBeNull()
        expect(repository.contexts).toEqual([context])
        expect(repository.events.map(event => event.action)).toEqual(['impression', 'impression'])
        if (first === null) return

        const second = await suggestArenaPair({
            candidates,
            league: 'all',
            context,
            randomSeed: 91,
            repository,
            now: 3,
        })
        expect(second).not.toBeNull()
        if (second === null) return
        expect(arenaPairKey(second.pair[0], second.pair[1])).not.toBe(
            arenaPairKey(first.pair[0], first.pair[1]),
        )

        const win = await recordArenaWin({
            winnerId: second.pair[0],
            loserId: second.pair[1],
            candidates,
            context,
            repository,
            now: 4,
        })
        expect(win.event.action).toBe('pair-win')
        expect(repository.events.at(-1)).toEqual(win.event)
        expect(repository.projections).toEqual(win.projections)
        expect(repository.projections.find(item => item.comboId === second.pair[0])?.mu)
            .toBeGreaterThan(repository.projections.find(item => item.comboId === second.pair[1])?.mu ?? 0)
    })

    it('persists tie and skip while skip leaves the derived preference unchanged', async () => {
        const repository = new MemoryStyleLabRepository()
        const context = evaluationContext()
        const candidates = [{ id: 'left' }, { id: 'right' }]
        const tie = await recordArenaTie({
            candidates,
            leftId: 'left',
            rightId: 'right',
            context,
            repository,
            now: 10,
        })
        const skip = await recordArenaSkip({
            candidates,
            leftId: 'left',
            rightId: 'right',
            context,
            repository,
            now: 11,
        })

        expect(tie.event.action).toBe('pair-tie')
        expect(tie.projections.every(projection => projection.evidence === 0.75)).toBe(true)
        expect(skip.event.action).toBe('skip')
        expect(skip.projections).toEqual(tie.projections)
        expect(repository.events.map(event => event.action)).toEqual(['pair-tie', 'skip'])
    })

    it('returns committed evidence when only the derived projection cache write fails', async () => {
        const repository = new MemoryStyleLabRepository(true)
        const context = evaluationContext()
        const candidates = [{ id: 'left' }, { id: 'right' }]
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        try {
            const result = await recordArenaWin({
                candidates,
                winnerId: 'left',
                loserId: 'right',
                context,
                repository,
                now: 20,
            })

            expect(result.event.action).toBe('pair-win')
            expect(result.projections.find(item => item.comboId === 'left')?.mu).toBeGreaterThan(0)
            expect(repository.events).toEqual([result.event])
            expect(repository.projections).toEqual([])
            expect(warning).toHaveBeenCalledOnce()
        } finally {
            warning.mockRestore()
        }
    })

    it('records a comparison-tray pair under one immutable Arena context', async () => {
        const repository = new MemoryStyleLabRepository()
        const context = evaluationContext()
        const candidates = [{ id: 'left' }, { id: 'right' }, { id: 'other' }]
        const result = await exposeArenaPair({
            candidates,
            pair: ['left', 'right'],
            context,
            repository,
            now: 30,
        })

        expect(result.pair).toEqual(['left', 'right'])
        expect(result.impressions.map(event => event.slot)).toEqual(['left', 'right'])
        expect(result.impressions.every(event => event.contextId === context.id)).toBe(true)
        expect(result.projections.find(item => item.comboId === 'left')?.views).toBe(1)
        expect(result.projections.find(item => item.comboId === 'right')?.views).toBe(1)
    })
})
