import {
    createStyleLabRandom,
    gaussianPreferenceModel,
    recentArenaPairKeys,
    suggestArenaPair as suggestArenaPairPolicy,
    type ArenaCandidate,
    type PreferenceCandidatePrior,
    type StyleEvaluationContext,
    type StyleLabArenaLeague,
} from '@/domain/style-lab'
import {
    exposeArenaPair,
    type ArenaPairExposure,
} from './expose-arena-pair'
import type { StyleLabRepository } from './style-lab-repository'

export interface SuggestArenaPairInput {
    candidates: readonly (ArenaCandidate & PreferenceCandidatePrior)[]
    league: StyleLabArenaLeague
    context: StyleEvaluationContext
    randomSeed: number
    repository: StyleLabRepository
    now?: number
}

export type ArenaPairSuggestion = ArenaPairExposure

/**
 * Acquisition depends on the repository's recent event projection and the pure
 * seeded policy. It records both slot impressions with the immutable context before
 * returning, so UI exposure and future anti-repeat decisions share one durable fact.
 */
export async function suggestArenaPair(
    input: SuggestArenaPairInput,
): Promise<ArenaPairSuggestion | null> {
    const preferenceEvents = await input.repository.listPreferenceEvents()
    const preferenceState = gaussianPreferenceModel.replay(input.candidates, preferenceEvents)
    const random = createStyleLabRandom(input.randomSeed, `arena-pair:${input.context.id}`)
    const pair = suggestArenaPairPolicy(input.candidates, input.league, {
        random: () => random.nextFloat(),
        recentPairKeys: recentArenaPairKeys(preferenceEvents),
        projections: preferenceState.projections,
        contextId: input.context.id,
    })
    if (pair === null) return null

    return exposeArenaPair({
        candidates: input.candidates,
        pair,
        context: input.context,
        repository: input.repository,
        events: preferenceEvents,
        now: input.now,
    })
}
