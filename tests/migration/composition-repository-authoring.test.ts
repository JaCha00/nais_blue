import { describe, expect, it } from 'vitest'

import { createCompositionChangeSet } from '@/domain/composition/authoring'
import {
    CompositionRepository,
    compositionDocumentCounts,
    compositionDocumentHash,
    createCommittedCompositionRepositoryRecord,
    type CompositionMigrationMarker,
    type CompositionRepositoryStorage,
} from '@/domain/composition/repository'
import type { CompositionDocument } from '@/domain/composition/types'
import { typeFixtureActor, typeFixtureDocument } from '@/domain/composition/types.typecheck'

const NOW = '2026-07-13T01:00:00.000Z'

class MemoryStorage implements CompositionRepositoryStorage {
    readonly values = new Map<string, string>()

    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }

    compareAndSet(key: string, expected: string | null, next: string): boolean {
        if ((this.values.get(key) ?? null) !== expected) return false
        this.values.set(key, next)
        return true
    }
}

function document(): CompositionDocument {
    return structuredClone(typeFixtureDocument) as CompositionDocument
}

function marker(value: CompositionDocument): CompositionMigrationMarker {
    return {
        migrationId: 'migration:authoring-fixture',
        registryVersion: 1,
        sourceHash: 'sha256:source',
        sourceCounts: { stores: 1 },
        targetHash: compositionDocumentHash(value),
        targetCounts: compositionDocumentCounts(value),
        reportHash: 'sha256:report',
        committedAt: NOW,
        startupVerifiedAt: NOW,
    }
}

function repositoryFixture(): { repository: CompositionRepository; storage: MemoryStorage; value: CompositionDocument } {
    const storage = new MemoryStorage()
    const value = document()
    const record = createCommittedCompositionRepositoryRecord(value, {
        updatedAt: NOW,
        authority: 'v2',
        revision: 7,
        migrationMarker: marker(value),
    })
    storage.values.set('nais2-composition-repository', JSON.stringify(record))
    return { repository: new CompositionRepository(storage), storage, value }
}

describe('CompositionRepository authoring commit', () => {
    it('CAS commits a validated change set, refreshes the hash, and retires the migration marker', async () => {
        const { repository, value } = repositoryFixture()
        const changeSet = createCompositionChangeSet({
            document: value,
            id: 'change:repository-edit',
            updatedAt: NOW,
            updatedBy: typeFixtureActor,
            changes: [{
                kind: 'upsert-module',
                value: { ...value.modules[0], name: 'Repository edit' },
            }],
        })

        const committed = await repository.applyChangeSet(changeSet, NOW)
        expect(committed.revision).toBe(8)
        expect(committed.committedDocument?.revision).toBe(1)
        expect(committed.committedDocument?.modules[0].name).toBe('Repository edit')
        expect(committed.committedHash).toBe(compositionDocumentHash(committed.committedDocument!))
        expect(committed.committedHash).not.toBe(compositionDocumentHash(value))
        expect(committed.migrationMarker).toBeUndefined()
    })

    it('rejects stale drafts before mutation', async () => {
        const { repository, storage, value } = repositoryFixture()
        const before = storage.values.get('nais2-composition-repository')
        const changeSet = createCompositionChangeSet({
            document: { ...value, revision: value.revision - 1 },
            id: 'change:stale',
            updatedAt: NOW,
            updatedBy: typeFixtureActor,
            changes: [],
        })

        await expect(repository.applyChangeSet(changeSet, NOW)).rejects.toMatchObject({
            code: 'E_AUTHORING_STALE_REVISION',
        })
        expect(storage.values.get('nais2-composition-repository')).toBe(before)
    })

    it('rejects authoring while a live migration lease exists', async () => {
        const { repository, value } = repositoryFixture()
        await repository.acquireMigrationLock({
            id: 'lock:authoring',
            owner: 'migration-test',
            now: NOW,
            ttlMs: 60_000,
        })
        const changeSet = createCompositionChangeSet({
            document: value,
            id: 'change:while-locked',
            updatedAt: NOW,
            updatedBy: typeFixtureActor,
            changes: [],
        })

        await expect(repository.applyChangeSet(changeSet, NOW)).rejects.toMatchObject({
            code: 'E_MIGRATION_LOCKED',
        })
    })

    it('rejects semantic blocking errors without changing the committed document', async () => {
        const { repository, value } = repositoryFixture()
        const changeSet = createCompositionChangeSet({
            document: value,
            id: 'change:invalid-reference',
            updatedAt: NOW,
            updatedBy: typeFixtureActor,
            changes: [{
                kind: 'upsert-recipe',
                value: {
                    ...value.recipes[0],
                    steps: [{ ...value.recipes[0].steps[0], moduleId: 'module:missing' }],
                },
            }],
        })

        await expect(repository.applyChangeSet(changeSet, NOW)).rejects.toMatchObject({
            code: 'E_AUTHORING_VALIDATION_FAILED',
        })
        expect((await repository.read(NOW)).committedDocument).toEqual(value)
    })
})
