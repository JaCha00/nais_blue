import type { GenerationFolderV2Defaults } from '@/domain/generation-folders'
import type { GenerationFolderRepositoryPort } from './generation-folder-repository'
import {
    planGenerationFolderChanges,
    type GenerationFolderChange,
    type PlanGenerationFolderChangesResult,
} from './plan-folder-changes'

export type FolderOccupancyResult =
    | { readonly status: 'empty' }
    | { readonly status: 'occupied'; readonly folderIds: readonly string[] }
    | { readonly status: 'unknown'; readonly folderIds: readonly string[] }

type PlannedFolderChanges = Extract<PlanGenerationFolderChangesResult, { status: 'PLANNED' }>

export type ApplyGenerationFolderChangesResult =
    | { readonly status: 'COMMITTED'; readonly plan: PlannedFolderChanges }
    | { readonly status: 'NOT_FOUND' }
    | { readonly status: 'REVISION_CONFLICT' }
    | { readonly status: 'PLAN_CONFLICT' }
    | { readonly status: 'COLLISION'; readonly plan: PlannedFolderChanges }
    | { readonly status: 'INVALID'; readonly reason: string }
    | { readonly status: 'STORAGE_CONFLICT' }
    | {
        readonly status: 'UNSUPPORTED'
        readonly reason: 'unsupported-needs-relocation-policy'
        readonly occupancy: Exclude<FolderOccupancyResult, { status: 'empty' }>
    }

export interface ApplyGenerationFolderChangesInput {
    readonly repository: GenerationFolderRepositoryPort
    readonly workspaceId: string
    readonly expectedRevision: number
    readonly expectedPlanHash: `sha256:${string}`
    readonly changes: readonly GenerationFolderChange[]
    readonly defaults: GenerationFolderV2Defaults
    readonly occupancyGuard: (folderIds: readonly string[]) => Promise<FolderOccupancyResult>
}

/** Replans and commits one Folder CAS; it never moves files or mutates Artifact authority. */
export async function applyGenerationFolderChanges(
    input: ApplyGenerationFolderChangesInput,
): Promise<ApplyGenerationFolderChangesResult> {
    const current = await input.repository.getDocument(input.workspaceId)
    if (current === null) return { status: 'NOT_FOUND' }
    if (current.revision !== input.expectedRevision) return { status: 'REVISION_CONFLICT' }

    const plan = planGenerationFolderChanges(current, input.changes, input.defaults)
    if (plan.status === 'INVALID') return { status: 'INVALID', reason: plan.reason }
    if (plan.planHash !== input.expectedPlanHash) return { status: 'PLAN_CONFLICT' }
    if (plan.collisions.length > 0) return { status: 'COLLISION', plan }

    const deletedIds = input.changes.flatMap(change => (
        'op' in change && change.op === 'delete' ? [change.folderId] : []
    ))
    const guardedIds = [...new Set([...plan.pathMoves.map(move => move.folderId), ...deletedIds])].sort()
    if (guardedIds.length > 0) {
        const occupancy = await input.occupancyGuard(guardedIds)
        if (occupancy.status !== 'empty') {
            return {
                status: 'UNSUPPORTED',
                reason: 'unsupported-needs-relocation-policy',
                occupancy,
            }
        }
    }

    const committed = await input.repository.commit(plan.document, input.expectedRevision)
    if (committed.status === 'REVISION_CONFLICT') return { status: 'REVISION_CONFLICT' }
    if (committed.status === 'STORAGE_CONFLICT') return { status: 'STORAGE_CONFLICT' }
    return { status: 'COMMITTED', plan: { ...plan, document: committed.document } }
}
