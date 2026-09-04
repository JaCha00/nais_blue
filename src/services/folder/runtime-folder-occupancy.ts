import type { GenerationJob } from '@/domain/queue/types'
import type { FolderOccupancyResult } from '@/application/folder/apply-folder-changes'
import type { IndexedDBQueueRepository } from '@/services/queue/indexeddb-queue-repository'
import type { IndexedDBArtifactRepository } from '@/services/organizer/artifact-repository'

export interface FolderOccupancyAuthority {
    readonly queue: Pick<IndexedDBQueueRepository, 'getJob' | 'getOutputReservation' | 'listJobs'>
    readonly artifacts: Pick<IndexedDBArtifactRepository, 'list'>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type SnapshotFolderSelector =
    | { readonly kind: 'selected'; readonly folderId: string }
    | { readonly kind: 'outside' }
    | { readonly kind: 'unknown' }

/** Distinguishes an intentional no-Folder output from an unreadable legacy selector. */
function snapshotFolderSelector(job: GenerationJob): SnapshotFolderSelector {
    const parameters = job.snapshot.parameters
    if (!isRecord(parameters)) return { kind: 'unknown' }
    const mainWorkflow = parameters.mainWorkflow
    if (mainWorkflow !== undefined) {
        if (!isRecord(mainWorkflow) || !isRecord(mainWorkflow.output)) return { kind: 'unknown' }
        const folderId = mainWorkflow.output.generationFolderId
        if (typeof folderId === 'string') return { kind: 'selected', folderId }
        return folderId === null ? { kind: 'outside' } : { kind: 'unknown' }
    }
    const sceneWorkflow = parameters.sceneWorkflow
    if (sceneWorkflow !== undefined) {
        if (!isRecord(sceneWorkflow) || !isRecord(sceneWorkflow.outputContext)) return { kind: 'unknown' }
        const folderId = sceneWorkflow.outputContext.generationFolderId
        if (typeof folderId === 'string') return { kind: 'selected', folderId }
        return folderId === undefined || folderId === null ? { kind: 'outside' } : { kind: 'unknown' }
    }
    return { kind: 'unknown' }
}

/** Joins immutable Queue snapshots with Artifact lineage; uncertainty blocks structural edits. */
export async function inspectFolderOccupancy(
    authority: FolderOccupancyAuthority,
    workspaceId: string,
    folderIds: readonly string[],
): Promise<FolderOccupancyResult> {
    const targets = new Set(folderIds)
    if (targets.size === 0) return { status: 'empty' }
    try {
        const { queue, artifacts } = authority
        const jobs = new Map<string, GenerationJob>()
        let jobCursor: string | null = null
        do {
            const page = await queue.listJobs({ cursor: jobCursor, limit: 500 })
            page.items.forEach(job => jobs.set(job.id, job))
            jobCursor = page.nextCursor
        } while (jobCursor !== null)

        const occupied = new Set<string>()
        const unknown = new Set<string>()
        const markUnknown = (selector: SnapshotFolderSelector): void => {
            if (selector.kind === 'unknown') folderIds.forEach(id => unknown.add(id))
            else if (selector.kind === 'selected' && targets.has(selector.folderId)) unknown.add(selector.folderId)
        }
        for (const job of jobs.values()) {
            const snapshot = job.snapshot.outputReservation
            if (snapshot?.folderBinding.resourceId !== workspaceId) continue
            const selector = snapshotFolderSelector(job)
            const reservation = await queue.getOutputReservation(snapshot.reservationId)
            if (reservation === null
                || reservation.batchId !== job.batchId
                || reservation.jobId !== job.id
                || reservation.reservationId !== snapshot.reservationId
                || reservation.folderBinding.resourceType !== snapshot.folderBinding.resourceType
                || reservation.folderBinding.resourceId !== snapshot.folderBinding.resourceId
                || reservation.folderBinding.revision !== snapshot.folderBinding.revision
                || reservation.folderBinding.contentHash !== snapshot.folderBinding.contentHash
                || reservation.directoryIdentity !== snapshot.directoryIdentity
                || reservation.relativePath !== snapshot.relativePath
                || reservation.collisionPolicy !== snapshot.collisionPolicy
                || reservation.expectedExistingDigest !== snapshot.expectedExistingDigest) {
                markUnknown(selector)
                continue
            }
            if (reservation.state === 'abandoned') continue
            if (selector.kind === 'unknown') folderIds.forEach(id => unknown.add(id))
            else if (selector.kind === 'selected' && targets.has(selector.folderId)) occupied.add(selector.folderId)
        }

        let artifactCursor: string | null = null
        do {
            const page = await artifacts.list({ cursor: artifactCursor, limit: 500 })
            for (const artifact of page.items) {
                if (artifact.sourceJobId === null) {
                    folderIds.forEach(id => unknown.add(id))
                    continue
                }
                const job = jobs.get(artifact.sourceJobId) ?? await queue.getJob(artifact.sourceJobId)
                if (job === null) {
                    folderIds.forEach(id => unknown.add(id))
                    continue
                }
                const binding = job.snapshot.outputReservation?.folderBinding
                if (binding !== undefined && binding.resourceId !== workspaceId) continue
                const selector = snapshotFolderSelector(job)
                if (selector.kind === 'unknown') folderIds.forEach(id => unknown.add(id))
                else if (selector.kind === 'selected' && targets.has(selector.folderId)) occupied.add(selector.folderId)
            }
            artifactCursor = page.nextCursor
        } while (artifactCursor !== null)

        if (occupied.size > 0) return { status: 'occupied', folderIds: [...occupied].sort() }
        if (unknown.size > 0) return { status: 'unknown', folderIds: [...unknown].sort() }
        return { status: 'empty' }
    } catch {
        return { status: 'unknown', folderIds: [...targets].sort() }
    }
}

export async function inspectRuntimeFolderOccupancy(
    workspaceId: string,
    folderIds: readonly string[],
): Promise<FolderOccupancyResult> {
    const [{ getRuntimeQueueRepository }, { getRuntimeArtifactRepository }] = await Promise.all([
        import('@/services/queue/indexeddb-queue-repository'),
        import('@/services/organizer/runtime'),
    ])
    return inspectFolderOccupancy({
        queue: getRuntimeQueueRepository(),
        artifacts: getRuntimeArtifactRepository(),
    }, workspaceId, folderIds)
}
