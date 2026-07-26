import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'

export const STYLE_PREFERENCE_EVENT_SCHEMA_VERSION = 1 as const

export type StylePreferenceAction =
    | 'impression'
    | 'like'
    | 'collect'
    | 'apply'
    | 'hide'
    | 'pair-win'
    | 'pair-tie'
    | 'skip'
    | 'undo'

export type StylePreferenceSlot = 'left' | 'right' | `market-${number}`

export interface StylePreferenceEvent {
    schemaVersion: typeof STYLE_PREFERENCE_EVENT_SCHEMA_VERSION
    id: string
    action: StylePreferenceAction
    comboId: string
    opponentId?: string
    boardId?: string
    slot?: StylePreferenceSlot
    contextId?: string
    supersedesId?: string
    createdAt: number
}

export type CreateStylePreferenceEventInput = Omit<StylePreferenceEvent, 'schemaVersion' | 'id'>

const STYLE_PREFERENCE_ACTIONS = new Set<StylePreferenceAction>([
    'impression',
    'like',
    'collect',
    'apply',
    'hide',
    'pair-win',
    'pair-tie',
    'skip',
    'undo',
])

function eventId(event: Omit<StylePreferenceEvent, 'id'>): string {
    return `style-event:${hashCanonicalValue(event)}`
}

/**
 * UI use cases provide semantic actions and timestamps; this constructor enforces
 * pair/undo dependencies and derives a content-addressed ID. The repository can
 * therefore retry an append idempotently without manufacturing duplicate evidence.
 */
export function createStylePreferenceEvent(
    input: CreateStylePreferenceEventInput,
): StylePreferenceEvent {
    const comboId = input.comboId.trim()
    if (!comboId) throw new TypeError('Preference comboId must not be empty')
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
        throw new TypeError('Preference createdAt must be a non-negative integer')
    }
    if ((input.action === 'pair-win' || input.action === 'pair-tie') && !input.opponentId) {
        throw new TypeError(`${input.action} requires opponentId`)
    }
    if (input.action === 'collect' && !input.boardId?.trim()) {
        throw new TypeError('collect requires boardId')
    }
    if (input.action === 'undo' && !input.supersedesId) {
        throw new TypeError('undo requires supersedesId')
    }
    if (input.opponentId === comboId) {
        throw new TypeError('Preference opponentId must differ from comboId')
    }

    const eventWithoutId: Omit<StylePreferenceEvent, 'id'> = {
        schemaVersion: STYLE_PREFERENCE_EVENT_SCHEMA_VERSION,
        action: input.action,
        comboId,
        ...(input.opponentId === undefined ? {} : { opponentId: input.opponentId }),
        ...(input.boardId === undefined ? {} : { boardId: input.boardId }),
        ...(input.slot === undefined ? {} : { slot: input.slot }),
        ...(input.contextId === undefined ? {} : { contextId: input.contextId }),
        ...(input.supersedesId === undefined ? {} : { supersedesId: input.supersedesId }),
        createdAt: input.createdAt,
    }
    return Object.freeze({ ...eventWithoutId, id: eventId(eventWithoutId) })
}

/** Undo events are compensating log entries; consumers operate on this active view. */
export function activeStylePreferenceEvents(
    events: readonly StylePreferenceEvent[],
): StylePreferenceEvent[] {
    const supersededIds = new Set(events
        .filter(event => event.action === 'undo' && event.supersedesId)
        .map(event => event.supersedesId as string))
    return events.filter(event => event.action !== 'undo' && !supersededIds.has(event.id))
}

/** Repository hydration uses a structural guard; semantic constructors remain stricter for new writes. */
export function isStylePreferenceEvent(value: unknown): value is StylePreferenceEvent {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const candidate = value as Partial<StylePreferenceEvent>
    return candidate.schemaVersion === STYLE_PREFERENCE_EVENT_SCHEMA_VERSION
        && typeof candidate.id === 'string'
        && candidate.id.startsWith('style-event:')
        && typeof candidate.action === 'string'
        && STYLE_PREFERENCE_ACTIONS.has(candidate.action as StylePreferenceAction)
        && typeof candidate.comboId === 'string'
        && candidate.comboId.length > 0
        && (candidate.opponentId === undefined || typeof candidate.opponentId === 'string')
        && (candidate.boardId === undefined || typeof candidate.boardId === 'string')
        && (candidate.slot === undefined || typeof candidate.slot === 'string')
        && (candidate.contextId === undefined || typeof candidate.contextId === 'string')
        && (candidate.supersedesId === undefined || typeof candidate.supersedesId === 'string')
        && Number.isSafeInteger(candidate.createdAt)
        && (candidate.createdAt as number) >= 0
}
