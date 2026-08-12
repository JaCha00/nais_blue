import type { ArtifactRecord } from '@/domain/organizer/types'
import {
    childOutputRef,
    type OutputDestinationRequest,
    type OutputPlatformAdapter,
    type ResolvedOutputDirectory,
} from '@/services/output/platform-adapter'

const ARTIFACT_HISTORY_SHADOW_PAGE_SIZE = 500

export interface ArtifactHistoryDiskEntry {
    readonly name: string
    readonly path: string
}

export interface ArtifactHistoryLineage {
    readonly artifactId: string
    readonly sourceJobId?: string
    readonly sourceSceneId?: string
}

export interface ArtifactHistoryShadowPage {
    readonly items: readonly ArtifactRecord[]
    readonly nextCursor: string | null
}

/** Read-only subset: History must not make Artifact authority mutations. */
export interface ArtifactHistoryShadowRepository {
    list(options: { cursor?: string | null; limit?: number }): Promise<ArtifactHistoryShadowPage>
}

export interface ArtifactHistoryShadow {
    /** Keyed by `artifactHistoryPathKey`, so UI scan entries retain their own display path. */
    readonly lineageByPath: ReadonlyMap<string, ArtifactHistoryLineage>
    /** Durable records whose current portable original is not present in the disk scan. */
    readonly unmatchedArtifactIds: readonly string[]
    /** Disk files which currently have no matching durable artifact record. */
    readonly unmatchedDiskPaths: readonly string[]
}

type HistoryShadowPlatform = Pick<OutputPlatformAdapter, 'resolveDirectory'>

function outputRequest(record: ArtifactRecord): OutputDestinationRequest {
    return {
        portableDirectory: record.original.file.directory,
        workflowDefaultDirectory: 'NAI_Blue_Output',
    }
}

function lineageFor(record: ArtifactRecord): ArtifactHistoryLineage {
    return {
        artifactId: record.artifactId,
        ...(record.sourceJobId === null ? {} : { sourceJobId: record.sourceJobId }),
        ...(record.sourceSceneId === null ? {} : { sourceSceneId: record.sourceSceneId }),
    }
}

function shouldPrefer(next: ArtifactHistoryLineage, current: ArtifactHistoryLineage): boolean {
    // A Queue-backed record carries the job identity History needs for its
    // Organizer handoff. Prefer it over a legacy/manual import of the same file.
    return current.sourceJobId === undefined && next.sourceJobId !== undefined
}

/**
 * Produces a comparison key without persisting a native path. Windows paths
 * are case-insensitive, while POSIX paths retain case so two distinct files do
 * not collapse into one History lineage entry.
 */
export function artifactHistoryPathKey(path: string): string {
    const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
        ? normalized.toLowerCase()
        : normalized
}

async function displayPathFor(
    record: ArtifactRecord,
    platform: HistoryShadowPlatform,
): Promise<string> {
    const directory: ResolvedOutputDirectory = await platform.resolveDirectory(outputRequest(record))
    return childOutputRef(directory, record.original.file.fileName).displayPath
}

/**
 * Joins the disk-derived History projection to immutable Artifact records.
 * Both sides remain authorities for their own concern: disk scanning decides
 * visibility, while ArtifactRepository only supplies durable lineage. A bad
 * portable grant is treated as an unmatched shadow record rather than breaking
 * the user's History panel.
 */
export async function buildArtifactHistoryShadow(
    diskEntries: readonly ArtifactHistoryDiskEntry[],
    repository: ArtifactHistoryShadowRepository,
    platform: HistoryShadowPlatform,
): Promise<ArtifactHistoryShadow> {
    const diskByPath = new Map<string, ArtifactHistoryDiskEntry>()
    const fileNames = new Set<string>()
    for (const entry of diskEntries) {
        diskByPath.set(artifactHistoryPathKey(entry.path), entry)
        fileNames.add(entry.name)
    }

    const lineageByPath = new Map<string, ArtifactHistoryLineage>()
    const matchedDiskPaths = new Set<string>()
    const unmatchedArtifactIds: string[] = []
    const seenCursors = new Set<string>()
    let cursor: string | null = null

    do {
        const page = await repository.list({ cursor, limit: ARTIFACT_HISTORY_SHADOW_PAGE_SIZE })
        for (const record of page.items) {
            // Most records are irrelevant to the limited History grid. Filter
            // before resolving a platform grant, keeping refresh read-only and
            // cheap even when Organizer retains a much larger catalog.
            if (!fileNames.has(record.original.file.fileName)) {
                // A filename absent from the disk projection is already a
                // definitive mismatch, so do not resolve its directory grant.
                unmatchedArtifactIds.push(record.artifactId)
                continue
            }
            try {
                const key = artifactHistoryPathKey(await displayPathFor(record, platform))
                if (!diskByPath.has(key)) {
                    unmatchedArtifactIds.push(record.artifactId)
                    continue
                }
                const next = lineageFor(record)
                const current = lineageByPath.get(key)
                if (current === undefined || shouldPrefer(next, current)) {
                    lineageByPath.set(key, next)
                }
                matchedDiskPaths.add(key)
            } catch {
                // A missing bookmark/portable root cannot affect disk History.
                // Keep the record observable as unmatched for future authority
                // migration, but never let it blank the current scan.
                unmatchedArtifactIds.push(record.artifactId)
            }
        }
        cursor = page.nextCursor
        if (cursor !== null && seenCursors.has(cursor)) break
        if (cursor !== null) seenCursors.add(cursor)
    } while (cursor !== null)

    return {
        lineageByPath,
        unmatchedArtifactIds: [...new Set(unmatchedArtifactIds)].sort(),
        unmatchedDiskPaths: [...diskByPath.keys()]
            .filter(path => !matchedDiskPaths.has(path))
            .sort(),
    }
}
