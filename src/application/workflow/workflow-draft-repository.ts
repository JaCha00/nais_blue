import type { WorkflowDraft } from '@/domain/workflow/single-image-draft'

export interface CommitWorkflowDraftInput {
    /** Null creates a new ID; a number replaces only that exact revision. */
    readonly expectedRevision: number | null
    readonly draft: WorkflowDraft
}

export type CommitWorkflowDraftResult =
    | { readonly status: 'committed'; readonly draft: WorkflowDraft }
    | { readonly status: 'conflict'; readonly current: WorkflowDraft | null }

/** Durable draft authority; presentation state may cache but never bypass CAS. */
export interface WorkflowDraftRepositoryPort {
    get(id: string): Promise<WorkflowDraft | null>
    list(): Promise<readonly WorkflowDraft[]>
    commit(input: CommitWorkflowDraftInput): Promise<CommitWorkflowDraftResult>
}
