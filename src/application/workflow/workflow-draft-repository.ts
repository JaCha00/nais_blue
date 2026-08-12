import type { WorkflowDraft } from '@/domain/workflow/single-image-draft'

export interface CommitWorkflowDraftInput {
    /** Null creates a new ID; a number replaces only that exact revision. */
    readonly expectedRevision: number | null
    readonly draft: WorkflowDraft
}

export type CommitWorkflowDraftResult =
    | { readonly status: 'committed'; readonly draft: WorkflowDraft }
    | { readonly status: 'conflict'; readonly current: WorkflowDraft | null }

export interface TrashedWorkflowDraft {
    readonly draft: WorkflowDraft
    readonly deletedAt: number
    readonly expiresAt: number
}

export type MoveWorkflowDraftToTrashResult =
    | { readonly status: 'trashed'; readonly item: TrashedWorkflowDraft }
    | { readonly status: 'conflict'; readonly current: WorkflowDraft | null }

export type RestoreWorkflowDraftResult =
    | { readonly status: 'restored'; readonly draft: WorkflowDraft }
    | { readonly status: 'conflict' | 'missing' }

/** Durable draft authority; presentation state may cache but never bypass CAS. */
export interface WorkflowDraftRepositoryPort {
    get(id: string): Promise<WorkflowDraft | null>
    list(): Promise<readonly WorkflowDraft[]>
    commit(input: CommitWorkflowDraftInput): Promise<CommitWorkflowDraftResult>
    moveToTrash(id: string, expectedRevision: number, deletedAt: number): Promise<MoveWorkflowDraftToTrashResult>
    listTrash(): Promise<readonly TrashedWorkflowDraft[]>
    restoreFromTrash(id: string): Promise<RestoreWorkflowDraftResult>
    permanentlyDeleteFromTrash(id: string): Promise<boolean>
    pruneExpiredTrash(now: number): Promise<number>
}
