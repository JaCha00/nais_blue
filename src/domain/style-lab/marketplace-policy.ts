import type { PreferenceProjection } from './preference-model'
import {
    activeStylePreferenceEvents,
    type StylePreferenceEvent,
} from './preference-event'
import type { TasteBoard } from './taste-board'

export type MarketplaceBucket = 'preferred' | 'explore' | 'fresh' | 'diverse'
export type MarketplaceReason =
    | 'taste-match'
    | 'exploring'
    | 'board-similar'
    | 'board-context'
    | 'new-lineage'
    | 'diverse'

export interface MarketplaceCandidate {
    id: string
    generation: number
    createdAt: number
    featureKeys: readonly string[]
    contextualMu?: number
    contextualSigma?: number
}

export interface MarketplaceShelfItem {
    comboId: string
    bucket: MarketplaceBucket
    reason: MarketplaceReason
    score: number
}

export interface MarketplaceInteractionState {
    likedIds: ReadonlySet<string>
    collectedIds: ReadonlySet<string>
    hiddenIds: ReadonlySet<string>
    appliedIds: ReadonlySet<string>
}

export interface BuildMarketplaceShelfInput {
    candidates: readonly MarketplaceCandidate[]
    projections: Readonly<Record<string, PreferenceProjection>>
    events: readonly StylePreferenceEvent[]
    board: TasteBoard
    random: () => number
    limit?: number
}

interface ScoredCandidate {
    candidate: MarketplaceCandidate
    sampledTaste: number
    feedScore: number
    exploreScore: number
    freshScore: number
    affinity: number
    novelty: number
    contextualMu: number
}

function unitRandom(random: () => number): number {
    const value = random()
    if (!Number.isFinite(value)) return 0.5
    return Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, value))
}

/** Box-Muller turns the versioned uniform stream into a deterministic normal draw. */
export function sampleStandardNormal(random: () => number): number {
    const radius = Math.sqrt(-2 * Math.log(unitRandom(random)))
    return radius * Math.cos(2 * Math.PI * unitRandom(random))
}

function normalizedFeatures(candidate: MarketplaceCandidate): ReadonlySet<string> {
    return new Set(candidate.featureKeys.map(key => key.trim().toLowerCase()).filter(Boolean))
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
    if (left.size === 0 || right.size === 0) return 0
    let intersection = 0
    for (const key of left) if (right.has(key)) intersection += 1
    return intersection / (left.size + right.size - intersection)
}

/** Active unary events are projected into UI state; absence remains neutral. */
export function marketplaceInteractionState(
    events: readonly StylePreferenceEvent[],
    boardId: string,
): MarketplaceInteractionState {
    const active = activeStylePreferenceEvents(events)
    return {
        likedIds: new Set(active.filter(event => event.action === 'like').map(event => event.comboId)),
        collectedIds: new Set(active
            .filter(event => event.action === 'collect' && event.boardId === boardId)
            .map(event => event.comboId)),
        hiddenIds: new Set(active.filter(event => event.action === 'hide').map(event => event.comboId)),
        appliedIds: new Set(active.filter(event => event.action === 'apply').map(event => event.comboId)),
    }
}

function recentMarketplaceImpressions(
    events: readonly StylePreferenceEvent[],
    boardId: string,
): ReadonlyMap<string, number> {
    const counts = new Map<string, number>()
    const recent = activeStylePreferenceEvents(events)
        .filter(event => event.action === 'impression' && event.boardId === boardId)
        .slice(-64)
    for (const event of recent) counts.set(event.comboId, (counts.get(event.comboId) ?? 0) + 1)
    return counts
}

function bucketQuotas(limit: number): Record<MarketplaceBucket, number> {
    const preferred = Math.ceil(limit * 0.5)
    const explore = Math.floor(limit * 0.25)
    const fresh = Math.floor(limit * 0.125)
    return {
        preferred,
        explore,
        fresh,
        diverse: Math.max(0, limit - preferred - explore - fresh),
    }
}

function sortedBy(
    candidates: readonly ScoredCandidate[],
    score: (candidate: ScoredCandidate) => number,
): ScoredCandidate[] {
    return [...candidates].sort((left, right) => (
        score(right) - score(left)
        || left.candidate.id.localeCompare(right.candidate.id)
    ))
}

function takeUnique(
    candidates: readonly ScoredCandidate[],
    count: number,
    selected: Set<string>,
): ScoredCandidate[] {
    const result: ScoredCandidate[] = []
    for (const candidate of candidates) {
        if (result.length >= count) break
        if (selected.has(candidate.candidate.id)) continue
        selected.add(candidate.candidate.id)
        result.push(candidate)
    }
    return result
}

function item(candidate: ScoredCandidate, bucket: MarketplaceBucket): MarketplaceShelfItem {
    const reason: MarketplaceReason = candidate.contextualMu >= 0.25
        ? 'board-context'
        : candidate.affinity >= 0.25
        ? 'board-similar'
        : bucket === 'explore'
            ? 'exploring'
            : bucket === 'fresh'
                ? 'new-lineage'
                : bucket === 'diverse'
                    ? 'diverse'
                    : 'taste-match'
    return {
        comboId: candidate.candidate.id,
        bucket,
        reason,
        score: candidate.feedScore,
    }
}

function interleaveBuckets(
    buckets: Record<MarketplaceBucket, MarketplaceShelfItem[]>,
    random: () => number,
): MarketplaceShelfItem[] {
    const pattern: MarketplaceBucket[] = [
        'preferred', 'explore', 'preferred', 'fresh',
        'preferred', 'diverse', 'preferred', 'explore',
    ]
    const offset = Math.floor(unitRandom(random) * pattern.length)
    const rotated = [...pattern.slice(offset), ...pattern.slice(0, offset)]
    const result: MarketplaceShelfItem[] = []
    while (Object.values(buckets).some(bucket => bucket.length > 0)) {
        let progressed = false
        for (const bucketName of rotated) {
            const next = buckets[bucketName].shift()
            if (!next) continue
            result.push(next)
            progressed = true
        }
        if (!progressed) break
    }
    return result
}

/**
 * Builds a role-balanced shelf. Global mu/sigma supplies taste uncertainty, board
 * collections supply local affinity, and recent impressions penalize repetition.
 * Every stochastic decision consumes the caller's versioned seeded stream.
 */
export function buildMarketplaceShelf(input: BuildMarketplaceShelfInput): MarketplaceShelfItem[] {
    const limit = Math.max(1, Math.min(64, Math.floor(input.limit ?? 16)))
    const interactions = marketplaceInteractionState(input.events, input.board.id)
    const visible = input.candidates
        .filter(candidate => !interactions.hiddenIds.has(candidate.id))
        .filter(candidate => !interactions.collectedIds.has(candidate.id))
        .sort((left, right) => left.id.localeCompare(right.id))
    if (visible.length === 0) return []

    const allById = new Map(input.candidates.map(candidate => [candidate.id, candidate]))
    const boardFeatureSets = [...interactions.collectedIds]
        .map(id => allById.get(id))
        .filter((candidate): candidate is MarketplaceCandidate => candidate !== undefined)
        .map(normalizedFeatures)
    const recentImpressions = recentMarketplaceImpressions(input.events, input.board.id)
    const maximumGeneration = Math.max(0, ...input.candidates.map(candidate => candidate.generation))
    const scored: ScoredCandidate[] = visible.map(candidate => {
        const projection = input.projections[candidate.id]
        const contextualMu = Number.isFinite(candidate.contextualMu) ? candidate.contextualMu as number : 0
        const contextualSigma = Number.isFinite(candidate.contextualSigma)
            ? Math.max(0.2, candidate.contextualSigma as number)
            : 0
        const mu = (projection?.mu ?? 0) + contextualMu * 0.65
        const sigma = contextualSigma === 0
            ? projection?.sigma ?? 1.4
            : Math.sqrt((projection?.sigma ?? 1.4) ** 2 + contextualSigma ** 2) / Math.SQRT2
        const views = projection?.views ?? 0
        const features = normalizedFeatures(candidate)
        const affinity = boardFeatureSets.length === 0
            ? 0
            : Math.max(...boardFeatureSets.map(boardFeatures => jaccard(features, boardFeatures)))
        const novelty = 1 / Math.sqrt(1 + views)
        const freshness = (views === 0 ? 0.8 : 0)
            + (maximumGeneration === 0 ? 0 : candidate.generation / maximumGeneration) * 0.4
        const repeatPenalty = (recentImpressions.get(candidate.id) ?? 0) * 0.9
            + Math.min(views, 50) * 0.015
        const normal = sampleStandardNormal(input.random)
        const sampledTaste = mu + sigma * (0.3 + input.board.exploration) * normal
        const feedScore = sampledTaste
            + affinity * 1.25
            + novelty * (0.25 + input.board.exploration * 0.35)
            + freshness * 0.3
            - repeatPenalty
        return {
            candidate,
            sampledTaste,
            feedScore,
            exploreScore: sigma * (0.7 + input.board.exploration)
                + novelty
                + sampledTaste * 0.15
                - repeatPenalty,
            freshScore: freshness + novelty * 0.4 + sampledTaste * 0.1 - repeatPenalty,
            affinity,
            novelty,
            contextualMu,
        }
    })

    const quotas = bucketQuotas(Math.min(limit, scored.length))
    const selected = new Set<string>()
    const preferred = takeUnique(sortedBy(scored, value => value.feedScore), quotas.preferred, selected)
    const explore = takeUnique(sortedBy(scored, value => value.exploreScore), quotas.explore, selected)
    const fresh = takeUnique(sortedBy(scored, value => value.freshScore), quotas.fresh, selected)
    const selectedFeatures = [...selected]
        .map(id => allById.get(id))
        .filter((candidate): candidate is MarketplaceCandidate => candidate !== undefined)
        .map(normalizedFeatures)
    const diverseOrder = sortedBy(scored, value => {
        const features = normalizedFeatures(value.candidate)
        const referenceFeatures = [...boardFeatureSets, ...selectedFeatures]
        const overlap = referenceFeatures.length === 0
            ? 0
            : Math.max(...referenceFeatures.map(reference => jaccard(features, reference)))
        return (1 - overlap) + value.novelty * 0.35 + value.sampledTaste * 0.1
    })
    const diverse = takeUnique(diverseOrder, quotas.diverse, selected)

    // Sparse pools can leave a role under-filled; fill the shelf without duplicating
    // candidates while retaining the preferred role as the general fallback.
    const target = Math.min(limit, scored.length)
    const fallback = takeUnique(sortedBy(scored, value => value.feedScore), target - selected.size, selected)
    return interleaveBuckets({
        preferred: [...preferred, ...fallback].map(value => item(value, 'preferred')),
        explore: explore.map(value => item(value, 'explore')),
        fresh: fresh.map(value => item(value, 'fresh')),
        diverse: diverse.map(value => item(value, 'diverse')),
    }, input.random).slice(0, target)
}
