import { describe, expect, it } from 'vitest'
import {
    DEFAULT_TASTE_BOARD_ID,
    STYLE_PREFERENCE_MODEL_VERSION,
    buildMarketplaceShelf,
    createStyleLabRandom,
    createStylePreferenceEvent,
    createTasteBoard,
    isTasteBoard,
    marketplaceInteractionState,
    type MarketplaceCandidate,
    type PreferenceProjection,
} from '@/domain/style-lab'

function board(id = DEFAULT_TASTE_BOARD_ID, exploration = 0.35) {
    return createTasteBoard({ id, name: id, exploration, createdAt: 1 })
}

function projection(comboId: string, overrides: Partial<PreferenceProjection> = {}): PreferenceProjection {
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

function candidates(count: number): MarketplaceCandidate[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `candidate-${String(index).padStart(2, '0')}`,
        generation: index % 4,
        createdAt: index,
        featureKeys: [`family-${index % 5}`, `artist-${index}`],
    }))
}

describe('TasteBoard domain', () => {
    it('creates a validated board with bounded exploration and stable explicit identity', () => {
        const result = createTasteBoard({
            id: ' board-a ',
            name: ' Portraits ',
            exploration: 4,
            createdAt: 10,
        })

        expect(result).toMatchObject({
            id: 'board-a',
            name: 'Portraits',
            exploration: 1,
            autoEvolution: false,
            budgetId: null,
        })
        expect(isTasteBoard(result)).toBe(true)
        expect(() => createTasteBoard({ name: ' ', createdAt: 0 })).toThrow(/name/)
    })
})

describe('Marketplace shelf policy', () => {
    it('replays a deterministic 8/4/2/2 role-balanced shelf', () => {
        const pool = candidates(24)
        const projections = Object.fromEntries(pool.map(candidate => [
            candidate.id,
            projection(candidate.id, { mu: Number(candidate.id.slice(-2)) / 100 }),
        ]))
        const firstRandom = createStyleLabRandom(2026, 'market')
        const secondRandom = createStyleLabRandom(2026, 'market')
        const first = buildMarketplaceShelf({
            candidates: pool,
            projections,
            events: [],
            board: board(),
            random: () => firstRandom.nextFloat(),
        })
        const replay = buildMarketplaceShelf({
            candidates: pool,
            projections,
            events: [],
            board: board(),
            random: () => secondRandom.nextFloat(),
        })

        expect(replay).toEqual(first)
        expect(first).toHaveLength(16)
        expect(first.filter(item => item.bucket === 'preferred')).toHaveLength(8)
        expect(first.filter(item => item.bucket === 'explore')).toHaveLength(4)
        expect(first.filter(item => item.bucket === 'fresh')).toHaveLength(2)
        expect(first.filter(item => item.bucket === 'diverse')).toHaveLength(2)
        expect(new Set(first.map(item => item.comboId))).toHaveLength(16)
    })

    it('separates board recommendations using collected style families', () => {
        const pool: MarketplaceCandidate[] = [
            { id: 'red-anchor', generation: 0, createdAt: 0, featureKeys: ['red', 'portrait'] },
            { id: 'blue-anchor', generation: 0, createdAt: 0, featureKeys: ['blue', 'landscape'] },
            ...Array.from({ length: 8 }, (_, index) => ({
                id: `red-${index}`,
                generation: 0,
                createdAt: index + 1,
                featureKeys: ['red', 'portrait'],
            })),
            ...Array.from({ length: 8 }, (_, index) => ({
                id: `blue-${index}`,
                generation: 0,
                createdAt: index + 1,
                featureKeys: ['blue', 'landscape'],
            })),
        ]
        const projections = Object.fromEntries(pool.map(candidate => [
            candidate.id,
            projection(candidate.id, { sigma: 0.25, views: 2 }),
        ]))
        const redBoard = board('red-board', 0)
        const blueBoard = board('blue-board', 0)
        const redCollect = createStylePreferenceEvent({
            action: 'collect', comboId: 'red-anchor', boardId: redBoard.id, createdAt: 2,
        })
        const blueCollect = createStylePreferenceEvent({
            action: 'collect', comboId: 'blue-anchor', boardId: blueBoard.id, createdAt: 2,
        })
        const redRandom = createStyleLabRandom(11, 'board-shelf')
        const blueRandom = createStyleLabRandom(11, 'board-shelf')
        const redShelf = buildMarketplaceShelf({
            candidates: pool,
            projections,
            events: [redCollect, blueCollect],
            board: redBoard,
            random: () => redRandom.nextFloat(),
            limit: 8,
        })
        const blueShelf = buildMarketplaceShelf({
            candidates: pool,
            projections,
            events: [redCollect, blueCollect],
            board: blueBoard,
            random: () => blueRandom.nextFloat(),
            limit: 8,
        })

        const redPreferred = redShelf.filter(item => item.bucket === 'preferred')
        const bluePreferred = blueShelf.filter(item => item.bucket === 'preferred')
        expect(redPreferred.every(item => item.comboId.startsWith('red-'))).toBe(true)
        expect(bluePreferred.every(item => item.comboId.startsWith('blue-'))).toBe(true)
        expect(redPreferred.every(item => item.reason === 'board-similar')).toBe(true)
        expect(bluePreferred.every(item => item.reason === 'board-similar')).toBe(true)
    })

    it('penalizes a repeatedly exposed top candidate instead of pinning it to preferred slots', () => {
        const pool = candidates(20)
        const projections = Object.fromEntries(pool.map(candidate => [
            candidate.id,
            projection(candidate.id, candidate.id === 'candidate-00'
                ? { mu: 2, sigma: 0.25, views: 20 }
                : { sigma: 0.25 }),
        ]))
        const events = Array.from({ length: 4 }, (_, index) => createStylePreferenceEvent({
            action: 'impression',
            comboId: 'candidate-00',
            boardId: DEFAULT_TASTE_BOARD_ID,
            slot: `market-${index}`,
            createdAt: 10 + index,
        }))
        const random = createStyleLabRandom(77, 'repeat')
        const shelf = buildMarketplaceShelf({
            candidates: pool,
            projections,
            events,
            board: board(DEFAULT_TASTE_BOARD_ID, 0),
            random: () => random.nextFloat(),
        })

        expect(shelf.find(item => item.comboId === 'candidate-00')?.bucket).not.toBe('preferred')
    })

    it('derives global and board-specific toggles from active events', () => {
        const liked = createStylePreferenceEvent({ action: 'like', comboId: 'a', createdAt: 1 })
        const hidden = createStylePreferenceEvent({ action: 'hide', comboId: 'b', createdAt: 2 })
        const collected = createStylePreferenceEvent({
            action: 'collect', comboId: 'c', boardId: 'board-a', createdAt: 3,
        })
        const undoHidden = createStylePreferenceEvent({
            action: 'undo', comboId: 'b', supersedesId: hidden.id, createdAt: 4,
        })
        const state = marketplaceInteractionState([liked, hidden, collected, undoHidden], 'board-a')

        expect(state.likedIds).toEqual(new Set(['a']))
        expect(state.hiddenIds).toEqual(new Set())
        expect(state.collectedIds).toEqual(new Set(['c']))
        expect(marketplaceInteractionState([collected], 'board-b').collectedIds).toEqual(new Set())
    })
})
