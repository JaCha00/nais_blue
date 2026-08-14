import type { GuidedPromptImportValue } from './guided-prompt-import'

export const GUIDED_DRAFTS_CHANGED_EVENT = 'nai-blue:guided-drafts-changed'
export const GUIDED_QUEUE_ACTIVITY_REFRESH_EVENT = 'nai-blue:guided-queue-activity-refresh'
export const GUIDED_GLOBAL_PROMPT_IMPORT_EVENT = 'nai-blue:guided-global-prompt-import'

export interface GuidedGlobalPromptImportDetail {
    readonly kind: 'single' | 'batch'
    readonly draftId: string
    readonly value: GuidedPromptImportValue
}

/** Keeps the Guided activity rail current without adding another polling loop. */
export function announceGuidedDraftChange(): void {
    window.dispatchEvent(new Event(GUIDED_DRAFTS_CHANGED_EVENT))
}

/** Lets Guided result views reuse the activity rail's durable Queue refresh cadence. */
export function announceGuidedQueueActivityRefresh(): void {
    window.dispatchEvent(new Event(GUIDED_QUEUE_ACTIVITY_REFRESH_EVENT))
}

/** Returns true only when the currently mounted draft accepted the import. */
export function dispatchGuidedGlobalPromptImport(detail: GuidedGlobalPromptImportDetail): boolean {
    const event = new CustomEvent<GuidedGlobalPromptImportDetail>(GUIDED_GLOBAL_PROMPT_IMPORT_EVENT, {
        detail,
        cancelable: true,
    })
    return !window.dispatchEvent(event)
}
