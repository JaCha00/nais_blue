import { describe, expect, it } from 'vitest'

import { applyCompositionChangeSet, CompositionAuthoringError } from '@/domain/composition/authoring'
import {
    CompositionRepository,
    createCommittedCompositionRepositoryRecord,
    type CompositionRepositoryStorage,
} from '@/domain/composition/repository'
import type { CompositionDocument, RecipeStep } from '@/domain/composition/types'
import { typeFixtureDocument } from '@/domain/composition/types.typecheck'
import {
    createCompositionStudioChangeSet,
    createRepositoryCompositionAuthoringSession,
} from '@/services/composition-authoring-adapter'

function fixture(): CompositionDocument {
    return JSON.parse(JSON.stringify(typeFixtureDocument)) as CompositionDocument
}

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

describe('Composition Studio repository adapter', () => {
    it('creates an entity upsert instead of writing the full document', () => {
        const base = fixture()
        const draft = fixture()
        draft.modules[0].name = 'Edited in the local draft'

        const changeSet = createCompositionStudioChangeSet(base, draft, {
            now: '2026-07-13T00:00:00.000Z',
            id: 'change:edit-module',
        })

        expect(changeSet.changes).toEqual([
            expect.objectContaining({ kind: 'upsert-module' }),
        ])
        const applied = applyCompositionChangeSet(base, changeSet)
        expect(applied.document.modules[0].name).toBe('Edited in the local draft')
        expect(applied.document.revision).toBe(base.revision + 1)
    })

    it('represents a new module as one create upsert and lets the repository stamp its revision metadata', () => {
        const base = fixture()
        const draft = fixture()
        draft.modules.push({
            ...structuredClone(base.modules[0]),
            id: 'module:created-in-studio',
            name: 'Created in Studio',
            contributions: [],
            characterPatches: [],
        })

        const changeSet = createCompositionStudioChangeSet(base, draft, {
            now: '2026-07-13T00:00:30.000Z',
        })
        expect(changeSet.changes).toEqual([
            expect.objectContaining({
                kind: 'upsert-module',
                value: expect.objectContaining({ id: 'module:created-in-studio' }),
            }),
        ])

        const created = applyCompositionChangeSet(base, changeSet).document.modules
            .find(module => module.id === 'module:created-in-studio')
        expect(created).toMatchObject({
            revision: 0,
            createdAt: '2026-07-13T00:00:30.000Z',
            updatedAt: '2026-07-13T00:00:30.000Z',
        })
    })

    it('preserves duplicate module use as independent recipe steps', () => {
        const base = fixture()
        const draft = fixture()
        const original = draft.recipes[0].steps[0]
        const duplicate: RecipeStep = {
            ...original,
            id: 'recipe-step:duplicate-module-use',
            orderKey: 'b0',
            revision: 0,
        }
        draft.recipes[0].steps.push(duplicate)

        const changeSet = createCompositionStudioChangeSet(base, draft, {
            now: '2026-07-13T00:01:00.000Z',
        })
        const applied = applyCompositionChangeSet(base, changeSet).document

        expect(applied.recipes[0].steps).toHaveLength(2)
        expect(applied.recipes[0].steps.map(step => step.moduleId)).toEqual([
            original.moduleId,
            original.moduleId,
        ])
        expect(new Set(applied.recipes[0].steps.map(step => step.id)).size).toBe(2)
    })

    it('commits a cascade delete as referenced-owner upserts plus a tombstone', () => {
        const base = fixture()
        const draft = fixture()
        const moduleId = base.modules[0].id
        draft.modules = []
        draft.profiles[0].moduleIds = draft.profiles[0].moduleIds.filter(id => id !== moduleId)
        draft.recipes[0].steps = draft.recipes[0].steps.filter(step => step.moduleId !== moduleId)

        const changeSet = createCompositionStudioChangeSet(base, draft, {
            now: '2026-07-13T00:02:00.000Z',
        })
        const kinds = changeSet.changes.map(change => change.kind)
        expect(kinds).toEqual(['upsert-profile', 'tombstone', 'upsert-recipe'])

        const applied = applyCompositionChangeSet(base, changeSet)
        expect(applied.validation.valid).toBe(true)
        expect(applied.document.modules[0].deletedAt).toBe('2026-07-13T00:02:00.000Z')
        expect(applied.document.recipes[0].steps).toEqual([])
    })

    it('keeps a non-cascade delete as a tombstone proposal but blocks the invalid final document', () => {
        const base = fixture()
        const draft = fixture()
        draft.modules = []

        const changeSet = createCompositionStudioChangeSet(base, draft, {
            now: '2026-07-13T00:03:00.000Z',
        })
        expect(changeSet.changes).toEqual([
            expect.objectContaining({
                kind: 'tombstone',
                entityKind: 'module',
                entityId: base.modules[0].id,
            }),
        ])
        expect(() => applyCompositionChangeSet(base, changeSet)).toThrowError(
            expect.objectContaining({
                code: 'E_CHANGESET_VALIDATION_FAILED',
            }) as Partial<CompositionAuthoringError>,
        )
    })

    it('rejects document-root edits that the Studio change-set cannot represent', () => {
        const base = fixture()
        const draft = fixture()
        draft.extensions = { changedOutsideStudioScope: true }

        expect(() => createCompositionStudioChangeSet(base, draft)).toThrow(
            'Composition Studio cannot change document-level metadata',
        )
    })

    it('turns a real repository stale revision into a three-way session conflict', async () => {
        const storage = new MemoryStorage()
        const value = fixture()
        const record = createCommittedCompositionRepositoryRecord(value, {
            authority: 'v2',
            revision: 4,
            updatedAt: '2026-07-13T00:04:00.000Z',
        })
        storage.values.set('nais2-composition-repository', JSON.stringify(record))
        const repository = new CompositionRepository(storage)
        const first = createRepositoryCompositionAuthoringSession(repository)
        const second = createRepositoryCompositionAuthoringSession(repository)
        await Promise.all([first.load(), second.load()])

        first.dispatch(draft => ({
            ...draft,
            modules: draft.modules.map((module, index) => (
                index === 0 ? { ...module, name: 'First writer' } : module
            )),
        }))
        second.dispatch(draft => ({
            ...draft,
            modules: draft.modules.map((module, index) => (
                index === 0 ? { ...module, name: 'Second writer' } : module
            )),
        }))

        const committed = await first.commit()
        expect(committed).toMatchObject({ status: 'ready', baseRevision: value.revision + 1 })

        const stale = await second.commit()
        expect(stale).toMatchObject({
            status: 'conflict',
            baseRevision: value.revision,
            conflict: {
                baseRevision: value.revision,
                externalRevision: value.revision + 1,
            },
        })
        expect(stale.conflict?.local.modules[0].name).toBe('Second writer')
        expect(stale.conflict?.external.modules[0].name).toBe('First writer')
    })
})
