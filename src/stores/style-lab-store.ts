import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import {
    STYLE_LAB_RANDOM_ALGORITHM,
    createStyleLabRandom,
    styleCombinationIdentity,
    type StyleCombinationLifecycle,
    type EvolutionLineage,
    type StyleEvaluationContext,
} from '@/domain/style-lab'
import {
    DEFAULT_STYLE_LAB_ARTISTS,
    STYLE_LAB_DEFAULT_TEMPLATE,
    WeightedPromptTag,
    applyArenaBattleResult,
    applyArenaTieResult,
    createEvolutionPlan,
    createRandomWeightedTags,
    genomeSignature,
    normalizePromptTag,
    normalizeArtistList,
    parseArtistInput,
    StyleLabArenaLeague,
} from '@/lib/style-lab'
import {
    STYLE_LAB_STORE_SCHEMA_VERSION,
    STYLE_LAB_STORE_VERSION,
    migrateStyleLabPersistedState,
    type StyleLabRandomState,
} from '@/lib/style-lab/store-migration'

export type StyleLabLeague = StyleLabArenaLeague

export interface StyleCombination {
    id: string
    tags: WeightedPromptTag[]
    semanticHash: string
    renderHash: string
    lifecycle: StyleCombinationLifecycle
    lineage?: EvolutionLineage
    elo: number
    legacyElo: number
    wins: number
    losses: number
    ties: number
    battles: number
    legacyBattles: number
    favorite: boolean
    legacyFavorite: boolean
    locked: boolean
    note: string
    generation: number
    createdAt: number
    updatedAt: number
    previewImage?: string
    previewPath?: string
    previewThumbnail?: string
    previewSeed?: number
    previewPrompt?: string
    previewContextId?: string
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
    parentCount?: number
    childCount?: number
    note?: string
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
    autoPreviewBattlePair: boolean
    evolutionParentCount: number
    evolutionChildrenCount: number
    mutationRate: number
}

interface StyleLabState {
    schemaVersion: typeof STYLE_LAB_STORE_SCHEMA_VERSION
    artists: string[]
    combinations: StyleCombination[]
    evolutionLogs: EvolutionLogItem[]
    settings: StyleLabSettings
    activeBattlePair: [string, string] | null
    activeEvaluationContext: StyleEvaluationContext | null
    randomState: StyleLabRandomState
    isPreviewQueueRunning: boolean
    previewQueueTotal: number
    previewQueueDone: number

    addArtists: (input: string) => number
    removeArtist: (artist: string) => void
    resetArtistsToDefault: () => void
    resetLabData: () => void
    updateSettings: (settings: Partial<StyleLabSettings>) => void

    generateRandomCombinations: (count?: number) => number
    addCombinationFromTags: (tags: WeightedPromptTag[], generation?: number) => string | null
    removeCombination: (id: string) => void
    toggleFavorite: (id: string) => void
    toggleLock: (id: string) => void
    updateNote: (id: string, note: string) => void

    setArenaRound: (pair: [string, string], context: StyleEvaluationContext) => void
    reserveRandomSeed: (scope: string) => number
    setBattleLeague: (league: StyleLabLeague) => void
    recordBattle: (winnerId: string, loserId: string) => void
    recordBattleTie: (leftId: string, rightId: string) => void
    clearArenaRound: () => void

    evolve: () => string[]
    recordEvolutionResult: (input: Omit<EvolutionLogItem, 'id' | 'timestamp'>) => void
    cleanup: (minBattles: number, eloBelow: number) => number

    setPreviewQueueState: (running: boolean, total?: number, done?: number) => void
    updateCombinationPreview: (id: string, patch: Partial<Pick<StyleCombination, 'previewImage' | 'previewPath' | 'previewThumbnail' | 'previewSeed' | 'previewPrompt' | 'previewContextId' | 'previewProgress' | 'isPreviewing' | 'previewError'>>) => void
    setCombinationLifecycle: (id: string, lifecycle: StyleCombinationLifecycle) => void
    setCombinationLineages: (lineages: readonly EvolutionLineage[]) => void
    clearPreviewRuntime: () => void
}

const now = () => Date.now()
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

function createEntropySeed(): number {
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    }
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

function createRandomState(): StyleLabRandomState {
    return {
        algorithm: STYLE_LAB_RANDOM_ALGORITHM,
        seed: createEntropySeed(),
        sequence: 0,
    }
}

function nextRandomState(state: StyleLabRandomState): StyleLabRandomState {
    return { ...state, sequence: state.sequence + 1 }
}

const defaultSettings: StyleLabSettings = {
    minTags: 5,
    maxTags: 10,
    minWeight: 0.2,
    maxWeight: 2.0,
    randomBatchCount: 8,
    battleLeague: 'all',
    promptTemplate: STYLE_LAB_DEFAULT_TEMPLATE,
    previewDelayMs: 500,
    autoPreviewBattlePair: false,
    evolutionParentCount: 6,
    evolutionChildrenCount: 8,
    mutationRate: 0.18,
}

function isTemporaryPreviewPath(path?: string): boolean {
    return Boolean(path?.startsWith('memory://'))
}

function normalizeCombinationTags(tags: WeightedPromptTag[]): WeightedPromptTag[] {
    return tags
        .map(normalizePromptTag)
        .filter(tag => tag.tag)
}

function createCombination(tags: WeightedPromptTag[], generation = 0): StyleCombination {
    const normalizedTags = normalizeCombinationTags(tags)
    const identity = styleCombinationIdentity(normalizedTags)
    return {
        id: makeId('combo'),
        tags: normalizedTags,
        ...identity,
        lifecycle: 'draft',
        elo: 1200,
        legacyElo: 1200,
        wins: 0,
        losses: 0,
        ties: 0,
        battles: 0,
        legacyBattles: 0,
        favorite: false,
        legacyFavorite: false,
        locked: false,
        note: '',
        generation,
        createdAt: now(),
        updatedAt: now(),
    }
}

function shouldTouchCombinationUpdatedAt(patch: Partial<StyleCombination>): boolean {
    return patch.previewPath !== undefined ||
        patch.previewThumbnail !== undefined ||
        patch.previewSeed !== undefined ||
        patch.previewPrompt !== undefined ||
        patch.previewContextId !== undefined
}

/** Legacy preview fields remain a UI read model; this helper derives the durable
 * candidate lifecycle from the asset context carried by each committed preview. */
function applyPreviewPatch(
    combo: StyleCombination,
    patch: Partial<Pick<StyleCombination, 'previewImage' | 'previewPath' | 'previewThumbnail' | 'previewSeed' | 'previewPrompt' | 'previewContextId' | 'previewProgress' | 'isPreviewing' | 'previewError'>>,
): StyleCombination {
    const next = { ...combo, ...patch }
    const hasPreview = Boolean(next.previewPath || next.previewThumbnail || next.previewImage)
    const lifecycle = combo.lifecycle === 'archived'
        ? 'archived'
        : hasPreview && next.previewContextId && Number.isSafeInteger(next.previewSeed)
            ? 'eligible'
            : hasPreview ? 'previewed' : combo.lifecycle
    return {
        ...next,
        lifecycle,
        updatedAt: shouldTouchCombinationUpdatedAt(patch) ? now() : combo.updatedAt,
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
        autoPreviewBattlePair: Boolean(merged.autoPreviewBattlePair),
        evolutionParentCount: Math.max(2, Math.min(50, Math.floor(merged.evolutionParentCount))),
        evolutionChildrenCount: Math.max(1, Math.min(100, Math.floor(merged.evolutionChildrenCount))),
        mutationRate: Math.max(0, Math.min(1, Number(merged.mutationRate))),
    }
}

export const useStyleLabStore = create<StyleLabState>()(
    persist(
        (set, get) => ({
            schemaVersion: STYLE_LAB_STORE_SCHEMA_VERSION,
            artists: DEFAULT_STYLE_LAB_ARTISTS,
            combinations: [],
            evolutionLogs: [],
            settings: defaultSettings,
            activeBattlePair: null,
            activeEvaluationContext: null,
            randomState: createRandomState(),
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
                schemaVersion: STYLE_LAB_STORE_SCHEMA_VERSION,
                artists: DEFAULT_STYLE_LAB_ARTISTS,
                combinations: [],
                evolutionLogs: [],
                settings: defaultSettings,
                activeBattlePair: null,
                activeEvaluationContext: null,
                randomState: createRandomState(),
                isPreviewQueueRunning: false,
                previewQueueTotal: 0,
                previewQueueDone: 0,
            }),

            updateSettings: (patch) => set(state => ({
                settings: sanitizeSettings({ ...state.settings, ...patch }),
            })),

            generateRandomCombinations: (count) => {
                const state = get()
                const random = createStyleLabRandom(
                    state.randomState.seed,
                    `blueprint:${state.randomState.sequence}`,
                )
                const target = count ?? state.settings.randomBatchCount
                const signatures = new Set(state.combinations.map(combo => genomeSignature(combo.tags)))
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
                        () => random.nextFloat(),
                    )
                    if (tags.length === 0) break
                    const signature = genomeSignature(tags)
                    if (signatures.has(signature)) continue
                    signatures.add(signature)
                    created.push(createCombination(tags))
                }

                if (created.length > 0) {
                    set(current => ({
                        combinations: [...created, ...current.combinations],
                        randomState: nextRandomState(current.randomState),
                    }))
                } else {
                    set(current => ({ randomState: nextRandomState(current.randomState) }))
                }
                return created.length
            },

            addCombinationFromTags: (tags, generation = 0) => {
                const normalizedTags = normalizeCombinationTags(tags)
                if (normalizedTags.length === 0) return null

                const signature = genomeSignature(normalizedTags)
                if (get().combinations.some(combo => genomeSignature(combo.tags) === signature)) return null

                const combination = createCombination(normalizedTags, generation)
                set(state => ({ combinations: [combination, ...state.combinations] }))
                return combination.id
            },

            removeCombination: (id) => set(state => ({
                combinations: state.combinations.filter(combo => combo.id !== id || combo.locked),
                activeBattlePair: state.activeBattlePair?.includes(id) ? null : state.activeBattlePair,
                activeEvaluationContext: state.activeBattlePair?.includes(id)
                    ? null
                    : state.activeEvaluationContext,
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

            setArenaRound: (pair, context) => set({
                activeBattlePair: pair,
                activeEvaluationContext: context,
            }),

            reserveRandomSeed: (scope) => {
                const state = get()
                const random = createStyleLabRandom(
                    state.randomState.seed,
                    `${scope}:${state.randomState.sequence}`,
                )
                const seed = random.nextUint32()
                set({ randomState: nextRandomState(state.randomState) })
                return seed
            },

            setBattleLeague: (league) => {
                set(state => ({
                    settings: { ...state.settings, battleLeague: league },
                    activeBattlePair: null,
                    activeEvaluationContext: null,
                }))
            },

            recordBattle: (winnerId, loserId) => {
                set(state => ({
                    combinations: applyArenaBattleResult(state.combinations, winnerId, loserId, now()),
                    activeBattlePair: null,
                    activeEvaluationContext: null,
                }))
            },

            recordBattleTie: (leftId, rightId) => {
                set(state => ({
                    combinations: applyArenaTieResult(state.combinations, leftId, rightId, now()),
                    activeBattlePair: null,
                    activeEvaluationContext: null,
                }))
            },

            clearArenaRound: () => set({
                activeBattlePair: null,
                activeEvaluationContext: null,
            }),

            evolve: () => {
                const state = get()
                const random = createStyleLabRandom(
                    state.randomState.seed,
                    `evolution:${state.randomState.sequence}`,
                )
                const plan = createEvolutionPlan(state.combinations, {
                    artistPool: state.artists,
                    minTags: state.settings.minTags,
                    maxTags: state.settings.maxTags,
                    minWeight: state.settings.minWeight,
                    maxWeight: state.settings.maxWeight,
                    parentCount: state.settings.evolutionParentCount,
                    childCount: state.settings.evolutionChildrenCount,
                    mutationRate: state.settings.mutationRate,
                }, () => random.nextFloat())
                if (!plan) {
                    set(current => ({ randomState: nextRandomState(current.randomState) }))
                    return []
                }

                const children = plan.childTags.map(tags => createCombination(tags, plan.generation))

                const log: EvolutionLogItem = {
                    id: makeId('evolution'),
                    timestamp: now(),
                    generation: plan.generation,
                    parentIds: plan.parentIds,
                    childIds: children.map(child => child.id),
                    parentCount: plan.parentCount,
                    childCount: children.length,
                }

                set(current => ({
                    combinations: [...children, ...current.combinations],
                    evolutionLogs: [log, ...current.evolutionLogs].slice(0, 50),
                    randomState: nextRandomState(current.randomState),
                }))

                return children.map(child => child.id)
            },

            recordEvolutionResult: (input) => set(state => ({
                evolutionLogs: [{
                    ...input,
                    id: makeId('evolution'),
                    timestamp: now(),
                }, ...state.evolutionLogs].slice(0, 50),
            })),

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
                    activeEvaluationContext: current.activeBattlePair?.some(id => ids.has(id))
                        ? null
                        : current.activeEvaluationContext,
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
                    ? applyPreviewPatch(combo, patch)
                    : combo),
            })),

            setCombinationLifecycle: (id, lifecycle) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, lifecycle, updatedAt: now() }
                    : combo),
            })),

            setCombinationLineages: (lineages) => set(state => {
                const byChild = new Map(lineages.map(lineage => [lineage.childId, lineage]))
                return {
                    combinations: state.combinations.map(combo => {
                        const lineage = byChild.get(combo.id)
                        return lineage === undefined ? combo : { ...combo, lineage, updatedAt: now() }
                    }),
                }
            }),

            clearPreviewRuntime: () => set(state => ({
                combinations: state.combinations.map(combo => (
                    combo.previewProgress || combo.isPreviewing
                        ? { ...combo, previewProgress: 0, isPreviewing: false }
                        : combo
                )),
                isPreviewQueueRunning: false,
                previewQueueTotal: 0,
                previewQueueDone: 0,
            })),
        }),
        {
            name: 'nai-blue-style-lab',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                schemaVersion: state.schemaVersion,
                artists: state.artists,
                combinations: state.combinations.map(combo => {
                    const previewPath = isTemporaryPreviewPath(combo.previewPath) ? undefined : combo.previewPath
                    return {
                        ...combo,
                        tags: normalizeCombinationTags(combo.tags),
                        previewPath,
                        previewImage: undefined,
                        previewThumbnail: combo.previewThumbnail,
                        previewProgress: 0,
                        isPreviewing: false,
                        previewError: undefined,
                    }
                }),
                evolutionLogs: state.evolutionLogs,
                settings: state.settings,
                randomState: state.randomState,
            }),
            version: STYLE_LAB_STORE_VERSION,
            migrate: (persistedState, persistedVersion) => (
                migrateStyleLabPersistedState(persistedState, persistedVersion) as unknown as StyleLabState
            ),
            onRehydrateStorage: () => (state) => {
                if (!state) return
                const migrated = migrateStyleLabPersistedState(state, STYLE_LAB_STORE_VERSION)
                state.schemaVersion = STYLE_LAB_STORE_SCHEMA_VERSION
                state.randomState = migrated.randomState as StyleLabRandomState
                state.artists = normalizeArtistList(state.artists?.length ? state.artists : DEFAULT_STYLE_LAB_ARTISTS)
                state.settings = sanitizeSettings(state.settings || defaultSettings)
                state.combinations = (state.combinations || []).map(combo => ({
                    ...combo,
                    tags: normalizeCombinationTags(combo.tags || []),
                    ...styleCombinationIdentity(normalizeCombinationTags(combo.tags || [])),
                    lifecycle: combo.lifecycle ?? 'draft',
                    elo: combo.elo ?? 1200,
                    legacyElo: combo.legacyElo ?? combo.elo ?? 1200,
                    wins: combo.wins ?? 0,
                    losses: combo.losses ?? 0,
                    ties: combo.ties ?? 0,
                    battles: combo.battles ?? 0,
                    legacyBattles: combo.legacyBattles ?? combo.battles ?? 0,
                    favorite: combo.favorite ?? false,
                    legacyFavorite: combo.legacyFavorite ?? combo.favorite ?? false,
                    locked: combo.locked ?? false,
                    note: combo.note ?? '',
                    generation: combo.generation ?? 0,
                    createdAt: combo.createdAt ?? now(),
                    updatedAt: combo.updatedAt ?? now(),
                    previewPath: isTemporaryPreviewPath(combo.previewPath) ? undefined : combo.previewPath,
                    previewImage: undefined,
                    previewThumbnail: combo.previewThumbnail,
                    previewContextId: combo.previewContextId,
                    previewProgress: 0,
                    isPreviewing: false,
                    previewError: undefined,
                }))
                state.evolutionLogs = state.evolutionLogs || []
                state.activeBattlePair = null
                state.activeEvaluationContext = null
                state.isPreviewQueueRunning = false
                state.previewQueueTotal = 0
                state.previewQueueDone = 0
            },
        }
    )
)
