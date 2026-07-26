import {
    createStylePreferenceEvent,
    gaussianPreferenceModel,
    type PreferenceCandidatePrior,
    type PreferenceProjection,
    type StyleEvaluationContext,
    type StylePreferenceEvent,
} from '@/domain/style-lab'
import { persistPreferenceProjectionCache } from './rebuild-projections'
import type { StyleLabRepository } from './style-lab-repository'

export interface ExposeArenaPairInput {
    candidates: readonly PreferenceCandidatePrior[]
    pair: [string, string]
    context: StyleEvaluationContext
    repository: StyleLabRepository
    events?: readonly StylePreferenceEvent[]
    now?: number
}

export interface ArenaPairExposure {
    pair: [string, string]
    context: StyleEvaluationContext
    impressions: readonly [StylePreferenceEvent, StylePreferenceEvent]
    projections: readonly PreferenceProjection[]
}

/** Records a selected or comparison-tray pair under one immutable context. */
export async function exposeArenaPair(input: ExposeArenaPairInput): Promise<ArenaPairExposure> {
    if (input.pair[0] === input.pair[1]
        || input.pair.some(id => !input.candidates.some(candidate => candidate.id === id))) {
        throw new TypeError('Arena exposure requires two distinct active candidates')
    }
    const events = input.events ?? await input.repository.listPreferenceEvents()
    let preferenceState = gaussianPreferenceModel.replay(input.candidates, events)
    const createdAt = input.now ?? Date.now()
    const impressions = [
        createStylePreferenceEvent({
            action: 'impression', comboId: input.pair[0], opponentId: input.pair[1],
            slot: 'left', contextId: input.context.id, createdAt,
        }),
        createStylePreferenceEvent({
            action: 'impression', comboId: input.pair[1], opponentId: input.pair[0],
            slot: 'right', contextId: input.context.id, createdAt,
        }),
    ] as const
    await input.repository.appendPreferenceEvents(input.context, impressions)
    for (const impression of impressions) {
        preferenceState = gaussianPreferenceModel.applyEvent(preferenceState, impression)
    }
    const projections = Object.values(preferenceState.projections)
        .sort((left, right) => left.comboId.localeCompare(right.comboId))
    await persistPreferenceProjectionCache(input.repository, projections)
    return { pair: input.pair, context: input.context, impressions, projections }
}
