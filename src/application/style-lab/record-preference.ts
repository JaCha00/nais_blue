import {
    createStylePreferenceEvent,
    type PreferenceCandidatePrior,
    type PreferenceProjection,
    type StyleEvaluationContext,
    type StylePreferenceAction,
    type StylePreferenceEvent,
} from '@/domain/style-lab'
import { rebuildPreferenceProjections } from './rebuild-projections'
import type { StyleLabRepository } from './style-lab-repository'

interface RecordArenaPreferenceInput {
    candidates: readonly PreferenceCandidatePrior[]
    context: StyleEvaluationContext
    repository: StyleLabRepository
    now?: number
}

export interface RecordArenaWinInput extends RecordArenaPreferenceInput {
    winnerId: string
    loserId: string
}

export interface RecordArenaNeutralInput extends RecordArenaPreferenceInput {
    leftId: string
    rightId: string
}

export interface RecordArenaPreferenceResult {
    event: StylePreferenceEvent
    projections: readonly PreferenceProjection[]
}

async function recordArenaPreference(
    input: RecordArenaPreferenceInput,
    action: Extract<StylePreferenceAction, 'pair-win' | 'pair-tie' | 'skip'>,
    comboId: string,
    opponentId: string,
): Promise<RecordArenaPreferenceResult> {
    const event = createStylePreferenceEvent({
        action,
        comboId,
        opponentId,
        contextId: input.context.id,
        createdAt: input.now ?? Date.now(),
    })
    await input.repository.appendPreferenceEvents(input.context, [event])
    const projections = await rebuildPreferenceProjections({
        candidates: input.candidates,
        repository: input.repository,
    })
    return { event, projections }
}

/**
 * The Arena UI calls this use case before updating the legacy Elo projection.
 * Repository-first ordering keeps the preference event authoritative if a later
 * cache write is interrupted; future projection rebuilds can replay this evidence.
 */
export function recordArenaWin(input: RecordArenaWinInput): Promise<RecordArenaPreferenceResult> {
    return recordArenaPreference(input, 'pair-win', input.winnerId, input.loserId)
}

/** A tie reduces relative uncertainty without declaring either candidate the winner. */
export function recordArenaTie(input: RecordArenaNeutralInput): Promise<RecordArenaPreferenceResult> {
    return recordArenaPreference(input, 'pair-tie', input.leftId, input.rightId)
}

/** Skip is durable evidence of no judgement and leaves mu/sigma unchanged. */
export function recordArenaSkip(input: RecordArenaNeutralInput): Promise<RecordArenaPreferenceResult> {
    return recordArenaPreference(input, 'skip', input.leftId, input.rightId)
}
