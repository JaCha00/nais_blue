import type { GenerationBatchSummary, GenerationJobState } from '@/domain/queue/types'
import type { SingleImageDraftStatus } from '@/domain/workflow/single-image-draft'

export type GuidedQueueIssue = 'failed' | 'cancelled' | 'needs-attention'
export type GuidedActivityStatus = SingleImageDraftStatus | GuidedQueueIssue

/** Maps durable terminal Queue states to the recovery state Guided can explain. */
export function deriveGuidedQueueIssue(
    states: readonly GenerationJobState[],
): GuidedQueueIssue | null {
    if (states.includes('failed')) return 'failed'
    if (states.includes('blocked')) return 'needs-attention'
    if (states.includes('cancelled') || states.includes('skipped')) return 'cancelled'
    return null
}

/**
 * A queued draft may finish while its Guided route is not mounted. The durable
 * Queue projection is authoritative for presentation, while draft persistence
 * remains owned by the Guided workflow CAS path.
 */
export function deriveDraftActivityStatus(
    persistedStatus: SingleImageDraftStatus,
    summary: GenerationBatchSummary | null,
): GuidedActivityStatus {
    if (persistedStatus !== 'queued' || summary === null || summary.total === 0) {
        return persistedStatus
    }

    if (summary.states.succeeded === summary.total) return 'completed'
    return deriveGuidedQueueIssue(([
        'failed',
        'blocked',
        'cancelled',
        'skipped',
    ] as const).filter(state => summary.states[state] > 0)) ?? persistedStatus
}

/** Terminal Guided work always resumes at its result or recovery surface. */
export function resolveGuidedActivityTargetNode(
    currentNodeId: string,
    status: GuidedActivityStatus,
): string {
    return status === 'completed'
        || status === 'failed'
        || status === 'cancelled'
        || status === 'needs-attention'
        ? 'result'
        : currentNodeId
}
