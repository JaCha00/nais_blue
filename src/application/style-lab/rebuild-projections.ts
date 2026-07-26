import {
    gaussianPreferenceModel,
    type PreferenceCandidatePrior,
    type PreferenceProjection,
    type StylePreferenceEvent,
} from '@/domain/style-lab'
import type { StyleLabRepository } from './style-lab-repository'

export interface RebuildPreferenceProjectionsInput {
    candidates: readonly PreferenceCandidatePrior[]
    repository: StyleLabRepository
    /** A caller that already loaded the log can avoid a second repository read. */
    events?: readonly StylePreferenceEvent[]
}

/**
 * Projection persistence is an acceleration cache behind the append-only event
 * log. A cache failure is reported for diagnostics but cannot turn an already
 * committed preference action into a retryable UI failure and duplicate evidence.
 */
export async function persistPreferenceProjectionCache(
    repository: StyleLabRepository,
    projections: readonly PreferenceProjection[],
): Promise<void> {
    try {
        await repository.replacePreferenceProjections(projections)
    } catch (error) {
        console.warn('[StyleLab] Preference projection cache write failed; replay will repair it:', error)
    }
}

/**
 * Projection rebuilding depends only on candidate priors, the append-only event log,
 * and the versioned domain model. It replaces the IndexedDB cache after replay, so a
 * crash before this write never loses preference evidence and can be repaired later.
 */
export async function rebuildPreferenceProjections(
    input: RebuildPreferenceProjectionsInput,
): Promise<PreferenceProjection[]> {
    const events = input.events ?? await input.repository.listPreferenceEvents()
    const state = gaussianPreferenceModel.replay(input.candidates, events)
    const projections = Object.values(state.projections)
        .sort((left, right) => left.comboId.localeCompare(right.comboId))
    await persistPreferenceProjectionCache(input.repository, projections)
    return projections
}

export function preferenceProjectionRecord(
    projections: readonly PreferenceProjection[],
): Record<string, PreferenceProjection> {
    return Object.fromEntries(projections.map(projection => [projection.comboId, projection]))
}
