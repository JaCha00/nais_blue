export const GUIDED_DRAFTS_CHANGED_EVENT = 'nai-blue:guided-drafts-changed'
export const GUIDED_QUEUE_ACTIVITY_REFRESH_EVENT = 'nai-blue:guided-queue-activity-refresh'

/** Keeps the Guided activity rail current without adding another polling loop. */
export function announceGuidedDraftChange(): void {
    window.dispatchEvent(new Event(GUIDED_DRAFTS_CHANGED_EVENT))
}

/** Lets Guided result views reuse the activity rail's durable Queue refresh cadence. */
export function announceGuidedQueueActivityRefresh(): void {
    window.dispatchEvent(new Event(GUIDED_QUEUE_ACTIVITY_REFRESH_EVENT))
}
