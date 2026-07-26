import type { StylePreferenceEvent } from './preference-event'
import {
    DEFAULT_PREFERENCE_SIGMA,
    type PreferenceProjection,
} from './preference-model'

export type StyleLabArenaLeague = 'all' | 'favorites'

export interface ArenaCandidate {
    id: string
    elo: number
    favorite: boolean
    lifecycle?: 'draft' | 'previewed' | 'eligible' | 'archived'
    previewContextId?: string
}

export interface ArenaPairPolicyOptions {
    random?: () => number
    recentPairKeys?: ReadonlySet<string>
    projections?: Readonly<Record<string, PreferenceProjection>>
    sampleSize?: number
    contextId?: string
}

export function arenaPairKey(leftId: string, rightId: string): string {
    return leftId < rightId ? `${leftId}\u0000${rightId}` : `${rightId}\u0000${leftId}`
}

export function getArenaPool<T extends ArenaCandidate>(
    candidates: readonly T[],
    league: StyleLabArenaLeague,
): T[] {
    return candidates
        .filter(candidate => candidate.lifecycle !== 'archived')
        .filter(candidate => league === 'all' || candidate.favorite)
        .sort((left, right) => right.elo - left.elo || left.id.localeCompare(right.id))
}

function randomIndex(random: () => number, maxExclusive: number): number {
    const value = random()
    if (!Number.isFinite(value)) return 0
    return Math.min(maxExclusive - 1, Math.max(0, Math.floor(value * maxExclusive)))
}

interface ScoredArenaPair {
    left: ArenaCandidate
    right: ArenaCandidate
    key: string
    score: number
}

function fallbackProjection(candidate: ArenaCandidate): Pick<PreferenceProjection, 'mu' | 'sigma' | 'views'> {
    return {
        mu: Math.max(-0.4, Math.min(0.4, (candidate.elo - 1200) / 2000)),
        sigma: DEFAULT_PREFERENCE_SIGMA,
        views: 0,
    }
}

/** Exposed for deterministic policy tests and future recommendation explanations. */
export function scoreArenaPair(
    left: ArenaCandidate,
    right: ArenaCandidate,
    options: Pick<ArenaPairPolicyOptions, 'projections' | 'recentPairKeys' | 'contextId'> = {},
): number {
    const leftPreference = options.projections?.[left.id] ?? fallbackProjection(left)
    const rightPreference = options.projections?.[right.id] ?? fallbackProjection(right)
    const combinedUncertainty = Math.sqrt(leftPreference.sigma ** 2 + rightPreference.sigma ** 2)
    const preferenceCloseness = 1 / (
        1 + Math.abs(leftPreference.mu - rightPreference.mu) / (combinedUncertainty + 0.1)
    )
    const exposureBalance = 1 / (
        1
        + 0.1 * (leftPreference.views + rightPreference.views)
        + 0.2 * Math.abs(leftPreference.views - rightPreference.views)
    )
    const antiRepeat = options.recentPairKeys?.has(arenaPairKey(left.id, right.id)) ? 0.05 : 1
    const compatibility = (candidate: ArenaCandidate): number => {
        if (options.contextId === undefined) return 1
        if (candidate.lifecycle === 'eligible' && candidate.previewContextId === options.contextId) return 1
        if (candidate.lifecycle === 'draft' || candidate.lifecycle === undefined) return 0.65
        return 0.35
    }
    const contextCompatibility = compatibility(left) * compatibility(right)
    return preferenceCloseness
        * combinedUncertainty
        * exposureBalance
        * contextCompatibility
        * antiRepeat
}

function enumeratePairs(pool: readonly ArenaCandidate[]): Array<[ArenaCandidate, ArenaCandidate]> {
    const pairs: Array<[ArenaCandidate, ArenaCandidate]> = []
    for (let left = 0; left < pool.length - 1; left += 1) {
        for (let right = left + 1; right < pool.length; right += 1) {
            pairs.push([pool[left], pool[right]])
        }
    }
    return pairs
}

function samplePairs(
    pool: readonly ArenaCandidate[],
    random: () => number,
    sampleSize: number,
): Array<[ArenaCandidate, ArenaCandidate]> {
    const totalPairs = pool.length * (pool.length - 1) / 2
    if (totalPairs <= sampleSize) return enumeratePairs(pool)

    const sampled = new Map<string, [ArenaCandidate, ArenaCandidate]>()
    const attemptLimit = sampleSize * 8
    for (let attempt = 0; attempt < attemptLimit && sampled.size < sampleSize; attempt += 1) {
        const leftIndex = randomIndex(random, pool.length)
        const rightOffset = randomIndex(random, pool.length - 1)
        const rightIndex = rightOffset >= leftIndex ? rightOffset + 1 : rightOffset
        const left = pool[leftIndex]
        const right = pool[rightIndex]
        sampled.set(arenaPairKey(left.id, right.id), [left, right])
    }
    return [...sampled.values()]
}

/**
 * The Arena application layer supplies a seeded random stream and recent event
 * projection. It samples at most 300 pairs, then maximizes closeness, uncertainty,
 * exposure balance, context compatibility, and anti-repeat factors.
 */
export function suggestArenaPair<T extends ArenaCandidate>(
    candidates: readonly T[],
    league: StyleLabArenaLeague,
    options: ArenaPairPolicyOptions = {},
): [string, string] | null {
    const pool = getArenaPool(candidates, league)
    if (pool.length < 2) return null

    const random = options.random ?? Math.random
    const sampleSize = Math.max(1, Math.min(300, Math.floor(options.sampleSize ?? 200)))
    const scored: ScoredArenaPair[] = samplePairs(pool, random, sampleSize).map(([left, right]) => ({
        left,
        right,
        key: arenaPairKey(left.id, right.id),
        score: scoreArenaPair(left, right, options),
    }))
    scored.sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    const selected = scored[0]
    if (!selected) return null
    return random() < 0.5
        ? [selected.left.id, selected.right.id]
        : [selected.right.id, selected.left.id]
}

/** Derives the small anti-repeat projection from the append-only preference log. */
export function recentArenaPairKeys(
    events: readonly StylePreferenceEvent[],
    limit = 12,
): ReadonlySet<string> {
    const keys = new Set<string>()
    for (let index = events.length - 1; index >= 0 && keys.size < limit; index -= 1) {
        const event = events[index]
        if (!event.opponentId) continue
        if (event.action !== 'impression' && event.action !== 'pair-win' && event.action !== 'pair-tie') continue
        keys.add(arenaPairKey(event.comboId, event.opponentId))
    }
    return keys
}
