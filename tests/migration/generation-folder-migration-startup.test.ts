import { describe, expect, it } from 'vitest'

import type { GenerationFolderRepositoryPort } from '@/application/folder/generation-folder-repository'
import {
    normalizeGenerationFolderV1Projection,
    type GenerationFolderDocument,
} from '@/domain/generation-folders'
import {
    rollbackGenerationFolderAuthority,
    runGenerationFolderMigrationStartup,
    type GenerationFolderMigrationPersistence,
} from '@/lib/generation-folder-migration-startup'

const NOW = '2026-09-04T00:00:00.000Z'
const PREIMAGE = '{"version":1,"state":{"savePath":"D:\\\\Images"},"spacing":" preserved "}'
const LEGACY = normalizeGenerationFolderV1Projection({
    savePath: 'D:\\Images',
    useAbsolutePath: true,
})

class MemoryRepository implements GenerationFolderRepositoryPort {
    document: GenerationFolderDocument | null = null
    failCommit = false

    async readLegacyProjection() { return LEGACY }
    async getDocument(workspaceId: string) {
        return this.document?.workspaceId === workspaceId ? structuredClone(this.document) : null
    }
    async listDocuments() {
        return this.document === null ? [] : [{
            workspaceId: this.document.workspaceId,
            revision: this.document.revision,
            folderCount: this.document.folders.length,
        }]
    }
    async commit(next: GenerationFolderDocument, expectedRevision: number) {
        if (this.failCommit) return { status: 'STORAGE_CONFLICT' as const }
        if ((this.document?.revision ?? 0) !== expectedRevision) {
            return { status: 'REVISION_CONFLICT' as const, current: structuredClone(this.document) }
        }
        this.document = structuredClone(next)
        return { status: 'COMMITTED' as const, document: structuredClone(next) }
    }
    async materializeLegacy() { return this.document }
}

function memoryPersistence() {
    let marker: Awaited<ReturnType<GenerationFolderMigrationPersistence['readMarker']>> = null
    const persistence: GenerationFolderMigrationPersistence = {
        preservePreimage: async () => PREIMAGE,
        readMarker: async () => marker,
        writeMarker: async next => { marker = next },
    }
    return { persistence, marker: () => marker }
}

describe('Generation Folder V1 materialization and authority', () => {
    it('preserves the exact preimage, verifies readback, and rolls back only the reader', async () => {
        const repository = new MemoryRepository()
        const memory = memoryPersistence()

        const result = await runGenerationFolderMigrationStartup({
            repository,
            persistence: memory.persistence,
            now: () => NOW,
        })

        expect(result.status).toBe('V2_ACTIVE')
        expect(memory.marker()).toEqual({ reader: 'v2', verifiedAt: NOW })
        expect(PREIMAGE).toBe('{"version":1,"state":{"savePath":"D:\\\\Images"},"spacing":" preserved "}')
        const beforeRollback = structuredClone(repository.document)

        await rollbackGenerationFolderAuthority(memory.persistence)

        expect(memory.marker()).toEqual({ reader: 'v1' })
        expect(repository.document).toEqual(beforeRollback)
    })

    it('keeps a later V2 revision authoritative on reopen', async () => {
        const repository = new MemoryRepository()
        const memory = memoryPersistence()
        const dependencies = { repository, persistence: memory.persistence, now: () => NOW }
        expect((await runGenerationFolderMigrationStartup(dependencies)).status).toBe('V2_ACTIVE')
        repository.document = {
            ...repository.document!,
            revision: 2,
            folders: repository.document!.folders.map(folder => ({ ...folder, displayName: 'Edited' })),
        }

        const reopened = await runGenerationFolderMigrationStartup(dependencies)

        expect(reopened.status).toBe('V2_ACTIVE')
        if (reopened.status === 'V2_ACTIVE') {
            expect(reopened.document).toMatchObject({ revision: 2, folders: [{ displayName: 'Edited' }] })
        }
        expect(memory.marker()).toEqual({ reader: 'v2', verifiedAt: NOW })
    })

    it('does not switch authority when the first CAS cannot commit', async () => {
        const repository = new MemoryRepository()
        repository.failCommit = true
        const memory = memoryPersistence()

        const result = await runGenerationFolderMigrationStartup({
            repository,
            persistence: memory.persistence,
            now: () => NOW,
        })

        expect(result).toMatchObject({ status: 'V1_FALLBACK', reason: 'COMMIT_FAILED' })
        expect(memory.marker()).toBeNull()
        expect(repository.document).toBeNull()
    })
})
