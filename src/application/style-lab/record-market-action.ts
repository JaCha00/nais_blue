import {
    activeStylePreferenceEvents,
    createStylePreferenceEvent,
    marketplaceInteractionState,
    type MarketplaceInteractionState,
    type PreferenceCandidatePrior,
    type PreferenceProjection,
    type StylePreferenceAction,
    type StylePreferenceEvent,
} from '@/domain/style-lab'
import { rebuildPreferenceProjections } from './rebuild-projections'
import type { StyleLabRepository } from './style-lab-repository'

export type MarketAction = Extract<StylePreferenceAction, 'like' | 'collect' | 'apply' | 'hide'>

export interface RecordMarketActionInput {
    candidates: readonly PreferenceCandidatePrior[]
    action: MarketAction
    comboId: string
    boardId: string
    repository: StyleLabRepository
    now?: number
}

export interface RecordMarketActionResult {
    event: StylePreferenceEvent
    toggledOn: boolean
    interactions: MarketplaceInteractionState
    projections: readonly PreferenceProjection[]
}

export async function loadMarketInteractions(
    repository: StyleLabRepository,
    boardId: string,
): Promise<MarketplaceInteractionState> {
    return marketplaceInteractionState(await repository.listPreferenceEvents(), boardId)
}

function latestMatchingToggle(
    events: readonly StylePreferenceEvent[],
    action: Exclude<MarketAction, 'apply'>,
    comboId: string,
    boardId: string,
): StylePreferenceEvent | null {
    const active = activeStylePreferenceEvents(events)
    for (let index = active.length - 1; index >= 0; index -= 1) {
        const event = active[index]
        if (event.action !== action || event.comboId !== comboId) continue
        if (action === 'collect' && event.boardId !== boardId) continue
        return event
    }
    return null
}

/**
 * Like/collect/hide are reversible through append-only undo events; apply always
 * records a fresh use signal. Rebuilding from the resulting log keeps UI toggles,
 * ranking, and the persistent projection cache on one authority.
 */
export async function recordMarketAction(
    input: RecordMarketActionInput,
): Promise<RecordMarketActionResult> {
    const events = await input.repository.listPreferenceEvents()
    const latestTimestamp = events.length > 0 ? events[events.length - 1].createdAt : -1
    const createdAt = Math.max(input.now ?? Date.now(), latestTimestamp + 1)
    const matching = input.action === 'apply'
        ? null
        : latestMatchingToggle(events, input.action, input.comboId, input.boardId)
    const event = matching === null
        ? createStylePreferenceEvent({
            action: input.action,
            comboId: input.comboId,
            ...(input.action === 'collect' || input.action === 'apply'
                ? { boardId: input.boardId }
                : {}),
            createdAt,
        })
        : createStylePreferenceEvent({
            action: 'undo',
            comboId: input.comboId,
            boardId: matching.boardId,
            supersedesId: matching.id,
            createdAt,
        })
    await input.repository.appendPreferenceEvents(null, [event])
    const nextEvents = [...events, event]
    const projections = await rebuildPreferenceProjections({
        candidates: input.candidates,
        repository: input.repository,
        events: nextEvents,
    })
    return {
        event,
        toggledOn: matching === null,
        interactions: marketplaceInteractionState(nextEvents, input.boardId),
        projections,
    }
}
