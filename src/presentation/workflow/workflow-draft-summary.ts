import type { WorkflowDraft } from '@/domain/workflow/single-image-draft'

/** A bounded tag digest keeps activity surfaces useful without exposing the full prompt. */
export function summarizeWorkflowDraftPrompt(draft: WorkflowDraft): string | null {
    const parts = draft.payload.prompt.positive
        .split(/[\r\n,]+/)
        .map(part => part.trim())
        .filter(part => part.length > 0 && !part.startsWith('#'))
    const compact = parts.slice(0, 3).map(part => part.length > 28 ? `${part.slice(0, 27)}…` : part)
    return compact.length === 0
        ? null
        : `${compact.join(' · ')}${parts.length > 3 ? ` +${parts.length - 3}` : ''}`
}
