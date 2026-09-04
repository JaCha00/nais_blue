import { IndexedDbGenerationFolderRepository } from '@/adapters/folder/indexeddb-generation-folder-repository'
import {
    preserveGenerationFolderV1Preimage,
    readGenerationFolderAuthorityMarker,
    writeGenerationFolderAuthorityMarker,
    type GenerationFolderAuthorityMarker,
} from '@/adapters/folder/indexeddb-generation-folder-migration'
import type { GenerationFolderRepositoryPort } from '@/application/folder/generation-folder-repository'
import {
    migrateGenerationFolderV1Projection,
    normalizeGenerationFolderV1Projection,
    type GenerationFolderDocument,
    type GenerationFolderV1Projection,
} from '@/domain/generation-folders'

export const DEFAULT_GENERATION_FOLDER_WORKSPACE_ID = 'local' as const

export interface GenerationFolderMigrationPersistence {
    preservePreimage(): Promise<string | null>
    readMarker(): Promise<GenerationFolderAuthorityMarker | null>
    writeMarker(marker: GenerationFolderAuthorityMarker): Promise<void>
}

const indexedDbMigrationPersistence: GenerationFolderMigrationPersistence = {
    preservePreimage: preserveGenerationFolderV1Preimage,
    readMarker: readGenerationFolderAuthorityMarker,
    writeMarker: writeGenerationFolderAuthorityMarker,
}

export type GenerationFolderMigrationStartupResult =
    | {
        readonly status: 'V2_ACTIVE'
        readonly document: GenerationFolderDocument
        readonly legacy: GenerationFolderV1Projection | null
    }
    | {
        readonly status: 'V1_FALLBACK'
        readonly reason: 'ROLLED_BACK' | 'INVALID_V2' | 'COMMIT_FAILED'
        readonly legacy: GenerationFolderV1Projection | null
    }

function sameInitialContent(left: GenerationFolderDocument, right: GenerationFolderDocument): boolean {
    return JSON.stringify({ ...left, revision: 1 }) === JSON.stringify({ ...right, revision: 1 })
}

/** Verifies a preserved V1 projection before enabling the Folder V2 writer. */
export async function runGenerationFolderMigrationStartup(dependencies: {
    readonly repository?: GenerationFolderRepositoryPort
    readonly workspaceId?: string
    readonly now?: () => string
    readonly persistence?: GenerationFolderMigrationPersistence
} = {}): Promise<GenerationFolderMigrationStartupResult> {
    const repository = dependencies.repository ?? new IndexedDbGenerationFolderRepository()
    const workspaceId = dependencies.workspaceId ?? DEFAULT_GENERATION_FOLDER_WORKSPACE_ID
    const persistence = dependencies.persistence ?? indexedDbMigrationPersistence
    await persistence.preservePreimage()
    const marker = await persistence.readMarker()
    const legacy = await repository.readLegacyProjection()
    if (marker?.reader === 'v1') return { status: 'V1_FALLBACK', reason: 'ROLLED_BACK', legacy }

    try {
        const existing = await repository.getDocument(workspaceId)
        if (marker?.reader === 'v2') {
            if (existing === null) {
                await persistence.writeMarker({ reader: 'v1' })
                return { status: 'V1_FALLBACK', reason: 'INVALID_V2', legacy }
            }
            return { status: 'V2_ACTIVE', document: existing, legacy }
        }

        const initial = migrateGenerationFolderV1Projection(
            workspaceId,
            legacy ?? normalizeGenerationFolderV1Projection({}),
        )
        let document: GenerationFolderDocument
        if (existing === null) {
            const committed = await repository.commit(initial, 0)
            if (committed.status !== 'COMMITTED') {
                return { status: 'V1_FALLBACK', reason: 'COMMIT_FAILED', legacy }
            }
            document = committed.document
        } else {
            if (!sameInitialContent(existing, initial)) {
                return { status: 'V1_FALLBACK', reason: 'INVALID_V2', legacy }
            }
            document = existing
        }
        const readback = await repository.getDocument(workspaceId)
        if (readback === null || JSON.stringify(readback) !== JSON.stringify(document)) {
            return { status: 'V1_FALLBACK', reason: 'INVALID_V2', legacy }
        }
        await persistence.writeMarker({
            reader: 'v2',
            verifiedAt: dependencies.now?.() ?? new Date().toISOString(),
        })
        return { status: 'V2_ACTIVE', document: readback, legacy }
    } catch {
        return { status: 'V1_FALLBACK', reason: 'COMMIT_FAILED', legacy }
    }
}

/** Rollback changes only reader selection; V2 data and the exact preimage stay intact. */
export async function rollbackGenerationFolderAuthority(
    persistence: GenerationFolderMigrationPersistence = indexedDbMigrationPersistence,
): Promise<void> {
    await persistence.writeMarker({ reader: 'v1' })
}
