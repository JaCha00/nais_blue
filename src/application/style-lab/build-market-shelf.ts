import {
    buildMarketplaceShelf as buildMarketplaceShelfPolicy,
    createStyleLabRandom,
    createStylePreferenceEvent,
    gaussianPreferenceModel,
    marketplaceInteractionState,
    predictContextualPreference,
    trainContextualPreferenceModel,
    type MarketplaceShelfItem,
    type PreferenceCandidatePrior,
    type PreferenceProjection,
    type StylePreferenceEvent,
    type TasteBoard,
    type StyleEvaluationContext,
} from '@/domain/style-lab'
import { persistPreferenceProjectionCache } from './rebuild-projections'
import type { StyleLabRepository } from './style-lab-repository'

export interface MarketplaceCandidateSource extends PreferenceCandidatePrior {
    generation: number
    createdAt: number
    tags: readonly { tag: string; kind?: string; weight?: number }[]
}

export interface BuildMarketShelfInput {
    candidates: readonly MarketplaceCandidateSource[]
    board: TasteBoard
    randomSeed: number
    repository: StyleLabRepository
    limit?: number
    now?: number
    context?: StyleEvaluationContext | null
}

export interface MarketShelfResult {
    shelf: readonly MarketplaceShelfItem[]
    impressions: readonly StylePreferenceEvent[]
    projections: readonly PreferenceProjection[]
    likedIds: ReadonlySet<string>
    collectedIds: ReadonlySet<string>
    hiddenIds: ReadonlySet<string>
}

function candidateFeatures(candidate: MarketplaceCandidateSource): string[] {
    return candidate.tags.flatMap(tag => {
        const normalized = tag.tag.trim().toLowerCase()
        return normalized ? [normalized, `${tag.kind ?? 'tag'}:${normalized}`] : []
    })
}

/**
 * A shelf exposure is committed before UI display. Its recommendation is pure and
 * seeded; impressions then advance views and anti-repeat state for the next shelf.
 */
export async function buildMarketShelf(input: BuildMarketShelfInput): Promise<MarketShelfResult> {
    const events = await input.repository.listPreferenceEvents()
    let preferenceState = gaussianPreferenceModel.replay(input.candidates, events)
    const contextualCandidates = input.candidates.map(candidate => ({
        id: candidate.id,
        tags: candidate.tags,
        generation: candidate.generation,
    }))
    const contextualState = trainContextualPreferenceModel({
        boardId: input.board.id,
        candidates: contextualCandidates,
        events,
        contexts: input.context ? [input.context] : [],
    })
    const contextual = Object.fromEntries(contextualCandidates.map(candidate => {
        const prediction = predictContextualPreference({
            state: contextualState,
            candidate,
            context: input.context,
            exploration: input.board.exploration,
        })
        return [candidate.id, prediction]
    }))
    const random = createStyleLabRandom(input.randomSeed, `market-shelf:${input.board.id}`)
    const shelf = buildMarketplaceShelfPolicy({
        candidates: input.candidates.map(candidate => ({
            id: candidate.id,
            generation: candidate.generation,
            createdAt: candidate.createdAt,
            featureKeys: candidateFeatures(candidate),
            contextualMu: contextual[candidate.id]?.mu,
            contextualSigma: contextual[candidate.id]?.sigma,
        })),
        projections: preferenceState.projections,
        events,
        board: input.board,
        random: () => random.nextFloat(),
        limit: input.limit,
    })
    const createdAt = input.now ?? Date.now()
    const impressions = shelf.map((item, index) => createStylePreferenceEvent({
        action: 'impression',
        comboId: item.comboId,
        boardId: input.board.id,
        slot: `market-${index}`,
        createdAt,
    }))
    await input.repository.appendPreferenceEvents(null, impressions)
    for (const impression of impressions) {
        preferenceState = gaussianPreferenceModel.applyEvent(preferenceState, impression)
    }
    const projections = Object.values(preferenceState.projections)
        .sort((left, right) => left.comboId.localeCompare(right.comboId))
    await persistPreferenceProjectionCache(input.repository, projections)
    const interactions = marketplaceInteractionState(events, input.board.id)
    return {
        shelf,
        impressions,
        projections,
        likedIds: interactions.likedIds,
        collectedIds: interactions.collectedIds,
        hiddenIds: interactions.hiddenIds,
    }
}
