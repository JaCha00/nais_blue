import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import {
    DEFAULT_STYLE_LAB_ARTISTS,
    STYLE_LAB_DEFAULT_TEMPLATE,
    WeightedArtistTag,
    breedWeightedTags,
    calculateElo,
    createRandomWeightedTags,
    getCombinationSignature,
    normalizeArtistList,
    parseArtistInput,
} from '@/lib/style-lab'

export type StyleLabLeague = 'all' | 'favorites'

export interface StyleCombination {
    id: string
    tags: WeightedArtistTag[]
    elo: number
    wins: number
    losses: number
    battles: number
    favorite: boolean
    locked: boolean
    note: string
    generation: number
    createdAt: number
    updatedAt: number
    previewImage?: string
    previewPath?: string
    previewSeed?: number
    previewPrompt?: string
    previewProgress?: number
    isPreviewing?: boolean
    previewError?: string
}

export interface EvolutionLogItem {
    id: string
    timestamp: number
    generation: number
    parentIds: string[]
    childIds: string[]
    note: string
}

export interface StyleLabSettings {
    minTags: number
    maxTags: number
    minWeight: number
    maxWeight: number
    randomBatchCount: number
    battleLeague: StyleLabLeague
    promptTemplate: string
    previewDelayMs: number
    evolutionParentCount: number
    evolutionChildrenCount: number
    mutationRate: number
}

interface StyleLabState {
    artists: string[]
    combinations: StyleCombination[]
    evolutionLogs: EvolutionLogItem[]
    settings: StyleLabSettings
    activeBattlePair: [string, string] | null
    isPreviewQueueRunning: boolean
    previewQueueTotal: number
    previewQueueDone: number

    addArtists: (input: string) => number
    removeArtist: (artist: string) => void
    resetArtistsToDefault: () => void
    resetLabData: () => void
    updateSettings: (settings: Partial<StyleLabSettings>) => void

    generateRandomCombinations: (count?: number) => number
    addCombinationFromTags: (tags: WeightedArtistTag[], generation?: number) => string | null
    removeCombination: (id: string) => void
    toggleFavorite: (id: string) => void
    toggleLock: (id: string) => void
    updateNote: (id: string, note: string) => void

    pickBattlePair: () => [string, string] | null
    setBattleLeague: (league: StyleLabLeague) => void
    recordBattle: (winnerId: string, loserId: string) => void

    evolve: () => string[]
    cleanup: (minBattles: number, eloBelow: number) => number

    setPreviewQueueState: (running: boolean, total?: number, done?: number) => void
    updateCombinationPreview: (id: string, patch: Partial<Pick<StyleCombination, 'previewImage' | 'previewPath' | 'previewSeed' | 'previewPrompt' | 'previewProgress' | 'isPreviewing' | 'previewError'>>) => void
    clearPreviewRuntime: () => void
}

const now = () => Date.now()
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

const defaultSettings: StyleLabSettings = {
    minTags: 5,
    maxTags: 10,
    minWeight: 0.2,
    maxWeight: 2.0,
    randomBatchCount: 8,
    battleLeague: 'all',
    promptTemplate: STYLE_LAB_DEFAULT_TEMPLATE,
    previewDelayMs: 500,
    evolutionParentCount: 6,
    evolutionChildrenCount: 8,
    mutationRate: 0.18,
}

function createCombination(tags: WeightedArtistTag[], generation = 0): StyleCombination {
    return {
        id: makeId('combo'),
        tags,
        elo: 1200,
        wins: 0,
        losses: 0,
        battles: 0,
        favorite: false,
        locked: false,
        note: '',
        generation,
        createdAt: now(),
        updatedAt: now(),
    }
}

function sanitizeSettings(settings: Partial<StyleLabSettings>): StyleLabSettings {
    const merged = { ...defaultSettings, ...settings }
    const minTags = Math.max(1, Math.min(20, Math.floor(merged.minTags)))
    const maxTags = Math.max(minTags, Math.min(30, Math.floor(merged.maxTags)))
    const minWeight = Math.max(0.2, Math.min(2.0, Number(merged.minWeight)))
    const maxWeight = Math.max(minWeight, Math.min(2.0, Number(merged.maxWeight)))

    return {
        ...merged,
        minTags,
        maxTags,
        minWeight,
        maxWeight,
        randomBatchCount: Math.max(1, Math.min(100, Math.floor(merged.randomBatchCount))),
        previewDelayMs: Math.max(250, Math.min(10000, Math.floor(merged.previewDelayMs))),
        evolutionParentCount: Math.max(2, Math.min(50, Math.floor(merged.evolutionParentCount))),
        evolutionChildrenCount: Math.max(1, Math.min(100, Math.floor(merged.evolutionChildrenCount))),
        mutationRate: Math.max(0, Math.min(1, Number(merged.mutationRate))),
    }
}

function getBattlePool(combinations: StyleCombination[], league: StyleLabLeague): StyleCombination[] {
    return combinations
        .filter(combo => league === 'all' || combo.favorite)
        .sort((a, b) => b.elo - a.elo)
}

export const useStyleLabStore = create<StyleLabState>()(
    persist(
        (set, get) => ({
            artists: DEFAULT_STYLE_LAB_ARTISTS,
            combinations: [],
            evolutionLogs: [],
            settings: defaultSettings,
            activeBattlePair: null,
            isPreviewQueueRunning: false,
            previewQueueTotal: 0,
            previewQueueDone: 0,

            addArtists: (input) => {
                const parsed = parseArtistInput(input)
                if (parsed.length === 0) return 0
                let added = 0
                set(state => {
                    const existing = new Set(state.artists.map(artist => artist.toLowerCase()))
                    const next = [...state.artists]
                    for (const artist of parsed) {
                        const key = artist.toLowerCase()
                        if (existing.has(key)) continue
                        existing.add(key)
                        next.push(artist)
                        added++
                    }
                    return { artists: normalizeArtistList(next) }
                })
                return added
            },

            removeArtist: (artist) => set(state => ({
                artists: state.artists.filter(item => item.toLowerCase() !== artist.toLowerCase()),
            })),

            resetArtistsToDefault: () => set({ artists: DEFAULT_STYLE_LAB_ARTISTS }),

            resetLabData: () => set({
                artists: DEFAULT_STYLE_LAB_ARTISTS,
                combinations: [],
                evolutionLogs: [],
                settings: defaultSettings,
                activeBattlePair: null,
                isPreviewQueueRunning: false,
                previewQueueTotal: 0,
                previewQueueDone: 0,
            }),

            updateSettings: (patch) => set(state => ({
                settings: sanitizeSettings({ ...state.settings, ...patch }),
            })),

            generateRandomCombinations: (count) => {
                const state = get()
                const target = count ?? state.settings.randomBatchCount
                const signatures = new Set(state.combinations.map(combo => getCombinationSignature(combo.tags)))
                const created: StyleCombination[] = []
                let attempts = 0

                while (created.length < target && attempts < target * 40) {
                    attempts++
                    const tags = createRandomWeightedTags(
                        state.artists,
                        state.settings.minTags,
                        state.settings.maxTags,
                        state.settings.minWeight,
                        state.settings.maxWeight,
                    )
                    if (tags.length === 0) break
                    const signature = getCombinationSignature(tags)
                    if (signatures.has(signature)) continue
                    signatures.add(signature)
                    created.push(createCombination(tags))
                }

                if (created.length > 0) {
                    set(current => ({ combinations: [...created, ...current.combinations] }))
                }
                return created.length
            },

            addCombinationFromTags: (tags, generation = 0) => {
                const normalizedTags = tags
                    .map(tag => ({ artist: tag.artist.trim(), weight: Math.max(0.2, Math.min(2.0, Number(tag.weight))) }))
                    .filter(tag => tag.artist)
                if (normalizedTags.length === 0) return null

                const signature = getCombinationSignature(normalizedTags)
                if (get().combinations.some(combo => getCombinationSignature(combo.tags) === signature)) return null

                const combination = createCombination(normalizedTags, generation)
                set(state => ({ combinations: [combination, ...state.combinations] }))
                return combination.id
            },

            removeCombination: (id) => set(state => ({
                combinations: state.combinations.filter(combo => combo.id !== id || combo.locked),
                activeBattlePair: state.activeBattlePair?.includes(id) ? null : state.activeBattlePair,
            })),

            toggleFavorite: (id) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, favorite: !combo.favorite, updatedAt: now() }
                    : combo),
            })),

            toggleLock: (id) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, locked: !combo.locked, updatedAt: now() }
                    : combo),
            })),

            updateNote: (id, note) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, note, updatedAt: now() }
                    : combo),
            })),

            pickBattlePair: () => {
                const state = get()
                const pool = getBattlePool(state.combinations, state.settings.battleLeague)
                if (pool.length < 2) {
                    set({ activeBattlePair: null })
                    return null
                }

                const firstIndex = Math.floor(Math.random() * pool.length)
                let secondIndex = Math.floor(Math.random() * pool.length)
                while (secondIndex === firstIndex) {
                    secondIndex = Math.floor(Math.random() * pool.length)
                }

                const pair: [string, string] = [pool[firstIndex].id, pool[secondIndex].id]
                set({ activeBattlePair: pair })
                return pair
            },

            setBattleLeague: (league) => {
                set(state => ({ settings: { ...state.settings, battleLeague: league }, activeBattlePair: null }))
            },

            recordBattle: (winnerId, loserId) => {
                const winner = get().combinations.find(combo => combo.id === winnerId)
                const loser = get().combinations.find(combo => combo.id === loserId)
                if (!winner || !loser) return

                const updated = calculateElo(winner.elo, loser.elo)
                set(state => ({
                    combinations: state.combinations.map(combo => {
                        if (combo.id === winnerId) {
                            return {
                                ...combo,
                                elo: updated.winner,
                                wins: combo.wins + 1,
                                battles: combo.battles + 1,
                                updatedAt: now(),
                            }
                        }
                        if (combo.id === loserId) {
                            return {
                                ...combo,
                                elo: updated.loser,
                                losses: combo.losses + 1,
                                battles: combo.battles + 1,
                                updatedAt: now(),
                            }
                        }
                        return combo
                    }),
                    activeBattlePair: null,
                }))
            },

            evolve: () => {
                const state = get()
                const rankedPool = state.combinations
                    .filter(combo => combo.favorite || combo.battles > 0)
                    .sort((a, b) => b.elo - a.elo || b.battles - a.battles)
                const fallbackPool = [...state.combinations].sort((a, b) => b.elo - a.elo)
                const parents = (rankedPool.length >= 2 ? rankedPool : fallbackPool).slice(0, state.settings.evolutionParentCount)
                if (parents.length < 2) return []

                const nextGeneration = Math.max(0, ...state.combinations.map(combo => combo.generation)) + 1
                const existingSignatures = new Set(state.combinations.map(combo => getCombinationSignature(combo.tags)))
                const children: StyleCombination[] = []
                let attempts = 0

                while (children.length < state.settings.evolutionChildrenCount && attempts < state.settings.evolutionChildrenCount * 50) {
                    attempts++
                    const parentA = parents[Math.floor(Math.random() * parents.length)]
                    let parentB = parents[Math.floor(Math.random() * parents.length)]
                    while (parentB.id === parentA.id) {
                        parentB = parents[Math.floor(Math.random() * parents.length)]
                    }

                    const tags = breedWeightedTags(
                        parentA.tags,
                        parentB.tags,
                        state.artists,
                        state.settings.minTags,
                        state.settings.maxTags,
                        state.settings.minWeight,
                        state.settings.maxWeight,
                        state.settings.mutationRate,
                    )
                    const signature = getCombinationSignature(tags)
                    if (existingSignatures.has(signature)) continue
                    existingSignatures.add(signature)
                    children.push(createCombination(tags, nextGeneration))
                }

                if (children.length === 0) return []

                const log: EvolutionLogItem = {
                    id: makeId('evolution'),
                    timestamp: now(),
                    generation: nextGeneration,
                    parentIds: parents.map(parent => parent.id),
                    childIds: children.map(child => child.id),
                    note: `상위 ${parents.length}개 조합에서 ${children.length}개 자식 생성`,
                }

                set(current => ({
                    combinations: [...children, ...current.combinations],
                    evolutionLogs: [log, ...current.evolutionLogs].slice(0, 50),
                }))

                return children.map(child => child.id)
            },

            cleanup: (minBattles, eloBelow) => {
                const state = get()
                const removable = state.combinations.filter(combo =>
                    !combo.locked &&
                    combo.battles >= minBattles &&
                    combo.elo < eloBelow
                )
                if (removable.length === 0) return 0
                const ids = new Set(removable.map(combo => combo.id))
                set(current => ({
                    combinations: current.combinations.filter(combo => !ids.has(combo.id)),
                    activeBattlePair: current.activeBattlePair?.some(id => ids.has(id)) ? null : current.activeBattlePair,
                }))
                return removable.length
            },

            setPreviewQueueState: (running, total, done) => set(state => ({
                isPreviewQueueRunning: running,
                previewQueueTotal: total ?? state.previewQueueTotal,
                previewQueueDone: done ?? state.previewQueueDone,
            })),

            updateCombinationPreview: (id, patch) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, ...patch, updatedAt: now() }
                    : combo),
            })),

            clearPreviewRuntime: () => set(state => ({
                combinations: state.combinations.map(combo => ({
                    ...combo,
                    previewProgress: 0,
                    isPreviewing: false,
                })),
                isPreviewQueueRunning: false,
                previewQueueTotal: 0,
                previewQueueDone: 0,
            })),
        }),
        {
            name: 'nais2-style-lab',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                artists: state.artists,
                combinations: state.combinations.map(combo => ({
                    ...combo,
                    previewImage: undefined,
                    previewProgress: 0,
                    isPreviewing: false,
                    previewError: undefined,
                })),
                evolutionLogs: state.evolutionLogs,
                settings: state.settings,
                activeBattlePair: state.activeBattlePair,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return
                state.artists = normalizeArtistList(state.artists?.length ? state.artists : DEFAULT_STYLE_LAB_ARTISTS)
                state.settings = sanitizeSettings(state.settings || defaultSettings)
                state.combinations = (state.combinations || []).map(combo => ({
                    ...combo,
                    elo: combo.elo ?? 1200,
                    wins: combo.wins ?? 0,
                    losses: combo.losses ?? 0,
                    battles: combo.battles ?? 0,
                    favorite: combo.favorite ?? false,
                    locked: combo.locked ?? false,
                    note: combo.note ?? '',
                    generation: combo.generation ?? 0,
                    createdAt: combo.createdAt ?? now(),
                    updatedAt: combo.updatedAt ?? now(),
                    previewImage: undefined,
                    previewProgress: 0,
                    isPreviewing: false,
                    previewError: undefined,
                }))
                state.evolutionLogs = state.evolutionLogs || []
                state.isPreviewQueueRunning = false
                state.previewQueueTotal = 0
                state.previewQueueDone = 0
            },
        }
    )
)
