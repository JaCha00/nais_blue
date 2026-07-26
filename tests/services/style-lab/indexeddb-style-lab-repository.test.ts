import { describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import {
    createPreferencePrior,
    createStyleEvaluationContext,
    createStylePreferenceEvent,
    createStylePreviewAsset,
    createStyleRenderBudget,
    createEvolutionLineage,
    updateStyleEvolutionArchive,
    createTasteBoard,
} from '@/domain/style-lab'
import { IndexedDbStyleLabRepository } from '@/services/style-lab/indexeddb-style-lab-repository'

function memoryStorage(): StateStorage {
    const values = new Map<string, string>()
    return {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value) },
        removeItem: async key => { values.delete(key) },
    }
}

function evaluationContext() {
    return createStyleEvaluationContext({
        prompt: { base: 'portrait' },
        plan: { model: 'model', sampler: 'sampler' },
        model: 'model',
        sampler: 'sampler',
        seedPack: [123],
        createdAt: 1,
    })
}

describe('IndexedDbStyleLabRepository', () => {
    it('atomically persists contexts and idempotent append-only events', async () => {
        const storage = memoryStorage()
        const repository = new IndexedDbStyleLabRepository(storage, 'test-style-lab')
        const context = evaluationContext()
        const events = [
            createStylePreferenceEvent({
                action: 'impression',
                comboId: 'a',
                opponentId: 'b',
                contextId: context.id,
                slot: 'left',
                createdAt: 2,
            }),
            createStylePreferenceEvent({
                action: 'impression',
                comboId: 'b',
                opponentId: 'a',
                contextId: context.id,
                slot: 'right',
                createdAt: 2,
            }),
        ]

        await repository.appendPreferenceEvents(context, events)
        await repository.appendPreferenceEvents(context, events)
        const projections = [
            createPreferencePrior({ id: 'a' }),
            createPreferencePrior({ id: 'b' }),
        ]
        await repository.replacePreferenceProjections(projections)
        const board = createTasteBoard({ id: 'board-a', name: 'Board A', createdAt: 4 })
        await repository.putTasteBoard(board)

        expect(await repository.listRecentPreferenceEvents()).toEqual(events)
        expect(await repository.listPreferenceEvents()).toEqual(events)
        expect(await repository.listPreferenceProjections()).toEqual(projections)
        expect(await repository.listTasteBoards()).toEqual([board])
        const reloaded = new IndexedDbStyleLabRepository(storage, 'test-style-lab')
        expect(await reloaded.listRecentPreferenceEvents(1)).toEqual([events[1]])
        expect(await reloaded.listPreferenceProjections()).toEqual(projections)
        expect(await reloaded.listTasteBoards()).toEqual([board])
    })

    it('serializes concurrent append batches without losing an event', async () => {
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'test-concurrent')
        const context = evaluationContext()
        const impression = createStylePreferenceEvent({
            action: 'impression',
            comboId: 'a',
            opponentId: 'b',
            contextId: context.id,
            createdAt: 2,
        })
        const win = createStylePreferenceEvent({
            action: 'pair-win',
            comboId: 'a',
            opponentId: 'b',
            contextId: context.id,
            createdAt: 3,
        })

        await Promise.all([
            repository.appendPreferenceEvents(context, [impression]),
            repository.appendPreferenceEvents(context, [win]),
        ])
        expect(await repository.listRecentPreferenceEvents()).toEqual([impression, win])
    })

    it('rejects an event linked to another context', async () => {
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'test-mismatch')
        const context = evaluationContext()
        const event = createStylePreferenceEvent({
            action: 'pair-win',
            comboId: 'a',
            opponentId: 'b',
            contextId: 'different-context',
            createdAt: 3,
        })
        await expect(repository.appendPreferenceEvents(context, [event])).rejects.toThrow(/does not match/)
    })

    it('reads schema v1 logs and upgrades them when writing the projection cache', async () => {
        const storage = memoryStorage()
        const context = evaluationContext()
        const event = createStylePreferenceEvent({
            action: 'pair-win',
            comboId: 'a',
            opponentId: 'b',
            contextId: context.id,
            createdAt: 3,
        })
        await storage.setItem('test-v1', JSON.stringify({
            schemaVersion: 1,
            contexts: [context],
            events: [event],
        }))
        const repository = new IndexedDbStyleLabRepository(storage, 'test-v1')

        expect(await repository.listPreferenceEvents()).toEqual([event])
        expect(await repository.listPreferenceProjections()).toEqual([])
        await repository.replacePreferenceProjections([createPreferencePrior({ id: 'a' })])

        const upgraded = JSON.parse(await storage.getItem('test-v1') ?? '{}') as {
            schemaVersion?: number
            projections?: unknown[]
        }
        expect(upgraded.schemaVersion).toBe(5)
        expect(upgraded.projections).toHaveLength(1)
        expect(await repository.listTasteBoards()).toEqual([])
    })

    it('discards a malformed derived cache without stranding authoritative events', async () => {
        const storage = memoryStorage()
        const context = evaluationContext()
        const event = createStylePreferenceEvent({
            action: 'pair-win',
            comboId: 'a',
            opponentId: 'b',
            contextId: context.id,
            createdAt: 3,
        })
        await storage.setItem('test-bad-cache', JSON.stringify({
            schemaVersion: 2,
            contexts: [context],
            events: [event],
            projections: [{ modelVersion: 'retired-model', comboId: 'a' }],
        }))
        const repository = new IndexedDbStyleLabRepository(storage, 'test-bad-cache')

        expect(await repository.listPreferenceEvents()).toEqual([event])
        expect(await repository.listPreferenceProjections()).toEqual([])
    })

    it('preserves a valid schema v2 projection while initializing empty boards', async () => {
        const storage = memoryStorage()
        const projection = createPreferencePrior({ id: 'a' })
        await storage.setItem('test-v2', JSON.stringify({
            schemaVersion: 2,
            contexts: [],
            events: [],
            projections: [projection],
        }))
        const repository = new IndexedDbStyleLabRepository(storage, 'test-v2')

        expect(await repository.listPreferenceProjections()).toEqual([projection])
        expect(await repository.listTasteBoards()).toEqual([])
    })

    it('deletes a board without deleting its historical collect event', async () => {
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'test-board-delete')
        const board = createTasteBoard({ id: 'board-a', name: 'Board A', createdAt: 1 })
        const event = createStylePreferenceEvent({
            action: 'collect', comboId: 'a', boardId: board.id, createdAt: 2,
        })
        await repository.putTasteBoard(board)
        await repository.appendPreferenceEvents(null, [event])
        await repository.deleteTasteBoard(board.id)

        expect(await repository.listTasteBoards()).toEqual([])
        expect(await repository.listPreferenceEvents()).toEqual([event])
    })

    it('stores 1:N preview assets and finds duplicate source bytes by SHA-256', async () => {
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'test-assets')
        const sha256 = `sha256:${'b'.repeat(64)}`
        const asset = (comboId: string, seed: number) => createStylePreviewAsset({
            comboId,
            sha256,
            mimeType: 'image/png',
            byteSize: 3,
            source: 'generated',
            vaultRef: `style-lab-vault/originals/${comboId}-${seed}.png`,
            contextId: 'context-a',
            seed,
            verificationState: 'context-verified',
            rawMetadata: null,
            normalizedMetadata: null,
            createdAt: seed,
        })
        const first = asset('combo-a', 1)
        const second = asset('combo-a', 2)
        const shared = asset('combo-b', 1)

        await repository.putPreviewAsset(first)
        await repository.putPreviewAsset(second)
        await repository.putPreviewAsset(shared)
        await repository.putPreviewAsset(first)

        expect(await repository.listPreviewAssets('combo-a')).toEqual([first, second])
        expect(await repository.findPreviewAssetsBySha256(sha256)).toEqual([first, second, shared])
    })

    it('reserves, binds, and settles budget exactly once', async () => {
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'test-budget')
        await repository.putRenderBudget(createStyleRenderBudget({
            id: 'auto-board-a', boardId: 'board-a', limit: 2, createdAt: 1,
        }))
        const reserved = await repository.reserveRenderBudget({
            budgetId: 'auto-board-a', units: 1, idempotencyKey: 'render-a', createdAt: 2,
        })
        const replay = await repository.reserveRenderBudget({
            budgetId: 'auto-board-a', units: 1, idempotencyKey: 'render-a', createdAt: 3,
        })

        expect(replay).toEqual(reserved)
        expect((await repository.getRenderBudget('auto-board-a'))?.reserved).toBe(1)
        const bound = await repository.bindRenderReservationJob(reserved!.id, 'job-a')
        expect(bound.jobId).toBe('job-a')
        await repository.settleRenderReservation(reserved!.id, 'spent', 4)
        await repository.settleRenderReservation(reserved!.id, 'spent', 5)
        expect(await repository.getRenderBudget('auto-board-a')).toMatchObject({ reserved: 0, spent: 1 })

        const second = await repository.reserveRenderBudget({
            budgetId: 'auto-board-a', units: 1, idempotencyKey: 'render-b', createdAt: 6,
        })
        expect(second).not.toBeNull()
        expect(await repository.reserveRenderBudget({
            budgetId: 'auto-board-a', units: 1, idempotencyKey: 'render-c', createdAt: 7,
        })).toBeNull()
        await repository.settleRenderReservation(second!.id, 'released', 8)
        expect(await repository.getRenderBudget('auto-board-a')).toMatchObject({ reserved: 0, spent: 1 })
    })

    it('persists lineage facts and replaces one board archive projection', async () => {
        const repository = new IndexedDbStyleLabRepository(memoryStorage(), 'test-evolution')
        const lineage = createEvolutionLineage({
            childId: 'child-a', boardId: 'board-a', parentIds: ['a', 'b'],
            operator: 'tag-add', diff: ['add:c'], rngSeed: 9, generation: 2, createdAt: 3,
        })
        const archive = updateStyleEvolutionArchive({
            boardId: 'board-a', existing: [], updatedAt: 4,
            candidates: [{
                comboId: 'child-a',
                tags: [{ tag: 'a', kind: 'artist', weight: 1 }],
                score: 1,
                uncertainty: 1,
                novelty: 1,
                niche: 'niche-a',
            }],
        })
        await repository.putEvolutionLineages([lineage])
        await repository.putEvolutionLineages([lineage])
        await repository.replaceEvolutionArchive('board-a', archive)

        expect(await repository.listEvolutionLineages('child-a')).toEqual([lineage])
        expect(await repository.listEvolutionArchive('board-a')).toEqual(archive)
    })
})
