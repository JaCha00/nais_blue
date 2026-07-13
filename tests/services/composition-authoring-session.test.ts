import { beforeEach, describe, expect, it, vi } from 'vitest'

import { typeFixtureDocument } from '@/domain/composition/types.typecheck'
import type { CompositionDocument } from '@/domain/composition/types'
import {
    createCompositionAuthoringSession,
    type CompositionAuthoringCommitResult,
    type CompositionAuthoringRepositorySnapshot,
    type CompositionAuthoringSessionDependencies,
} from '@/services/composition-authoring-session'

interface TestChangeSet {
    beforeName: string
    afterName: string
}

function document(name = 'Base'): CompositionDocument {
    const cloned = JSON.parse(JSON.stringify(typeFixtureDocument)) as CompositionDocument
    cloned.profiles[0].name = name
    return cloned
}

function renamed(name: string) {
    return (draft: CompositionDocument): CompositionDocument => ({
        ...draft,
        profiles: draft.profiles.map((profile, index) => (
            index === 0 ? { ...profile, name } : profile
        )),
    })
}

function snapshot(revision: number, name: string): CompositionAuthoringRepositorySnapshot {
    return { revision, document: document(name) }
}

function changeSet(base: CompositionDocument, draft: CompositionDocument): TestChangeSet {
    return {
        beforeName: base.profiles[0].name,
        afterName: draft.profiles[0].name,
    }
}

function dependencies(
    overrides: Partial<CompositionAuthoringSessionDependencies<TestChangeSet>> = {},
): CompositionAuthoringSessionDependencies<TestChangeSet> {
    return {
        loadDocument: vi.fn(async () => snapshot(4, 'Base')),
        createChangeSet: vi.fn(changeSet),
        commitDocument: vi.fn(async request => ({
            status: 'committed',
            snapshot: {
                revision: request.expectedRevision + 1,
                document: request.draft,
            },
        })),
        ...overrides,
    }
}

describe('CompositionAuthoringSession', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('loads isolated base and draft snapshots and publishes state changes', async () => {
        const loaded = snapshot(7, 'Repository')
        const deps = dependencies({ loadDocument: vi.fn(async () => loaded) })
        const session = createCompositionAuthoringSession(deps)
        const statuses: string[] = []
        const unsubscribe = session.subscribe(state => statuses.push(state.status))

        const state = await session.load()
        loaded.document.profiles[0].name = 'Mutated outside session'

        expect(statuses).toEqual(['unloaded', 'loading', 'ready'])
        expect(state).toMatchObject({
            status: 'ready',
            baseRevision: 7,
            dirty: false,
            canUndo: false,
            canRedo: false,
        })
        expect(session.getState().baseDocument?.profiles[0].name).toBe('Repository')
        expect(session.getState().draftDocument).not.toBe(session.getState().baseDocument)

        unsubscribe()
    })

    it('applies document commands without mutating the base and supports undo/redo', async () => {
        const session = createCompositionAuthoringSession(dependencies())
        await session.load()

        const edited = session.dispatch(renamed('Local edit'))
        expect(edited.draftDocument?.profiles[0].name).toBe('Local edit')
        expect(edited.baseDocument?.profiles[0].name).toBe('Base')
        expect(edited).toMatchObject({ dirty: true, canUndo: true, canRedo: false })

        expect(session.undo()).toBe(true)
        expect(session.getState()).toMatchObject({ dirty: false, canUndo: false, canRedo: true })
        expect(session.getState().draftDocument?.profiles[0].name).toBe('Base')

        expect(session.redo()).toBe(true)
        expect(session.getState()).toMatchObject({ dirty: true, canUndo: true, canRedo: false })
        expect(session.getState().draftDocument?.profiles[0].name).toBe('Local edit')
    })

    it('builds and commits an explicit change-set at the loaded repository revision', async () => {
        const commitDocument = vi.fn(async request => ({
            status: 'committed' as const,
            snapshot: {
                revision: 5,
                document: request.draft,
            },
        }))
        const createChangeSet = vi.fn(changeSet)
        const session = createCompositionAuthoringSession(dependencies({
            createChangeSet,
            commitDocument,
        }))
        await session.load()
        session.dispatch(renamed('Committed'))

        const state = await session.commit()

        expect(createChangeSet).toHaveBeenCalledWith(
            expect.objectContaining({ profiles: expect.any(Array) }),
            expect.objectContaining({ profiles: expect.any(Array) }),
        )
        expect(commitDocument).toHaveBeenCalledWith(expect.objectContaining({
            expectedRevision: 4,
            changeSet: { beforeName: 'Base', afterName: 'Committed' },
        }))
        expect(state).toMatchObject({
            status: 'ready',
            baseRevision: 5,
            dirty: false,
            canUndo: false,
            canRedo: false,
            conflict: null,
        })
        expect(state.baseDocument?.profiles[0].name).toBe('Committed')
    })

    it('keeps the dirty draft editable when change-set validation rejects commit', async () => {
        const createChangeSet = vi.fn(() => {
            throw new Error('draft validation failed')
        })
        const session = createCompositionAuthoringSession(dependencies({ createChangeSet }))
        await session.load()
        session.dispatch(renamed('Invalid draft'))

        await expect(session.commit()).rejects.toThrow('draft validation failed')
        expect(session.getState()).toMatchObject({
            status: 'ready',
            dirty: true,
            canUndo: true,
            lastError: 'draft validation failed',
        })
        expect(() => session.dispatch(renamed('Corrected draft'))).not.toThrow()
    })

    it('turns a stale commit into a base/local/external three-way conflict', async () => {
        const commitDocument = vi.fn(async (): Promise<CompositionAuthoringCommitResult> => ({
            status: 'stale',
            external: snapshot(5, 'External edit'),
        }))
        const session = createCompositionAuthoringSession(dependencies({ commitDocument }))
        await session.load()
        session.dispatch(renamed('Local edit'))

        const state = await session.commit()

        expect(state).toMatchObject({
            status: 'conflict',
            baseRevision: 4,
            dirty: true,
            canUndo: false,
            canRedo: false,
            conflict: {
                baseRevision: 4,
                externalRevision: 5,
            },
        })
        expect(state.conflict?.base.profiles[0].name).toBe('Base')
        expect(state.conflict?.local.profiles[0].name).toBe('Local edit')
        expect(state.conflict?.external.profiles[0].name).toBe('External edit')
    })

    it('reloads a clean external poll but preserves a dirty draft as a conflict', async () => {
        const cleanSession = createCompositionAuthoringSession(dependencies())
        await cleanSession.load()
        const clean = cleanSession.ingestExternal(snapshot(5, 'External clean update'))
        expect(clean).toMatchObject({ status: 'ready', baseRevision: 5, dirty: false })
        expect(clean.draftDocument?.profiles[0].name).toBe('External clean update')

        const dirtySession = createCompositionAuthoringSession(dependencies())
        await dirtySession.load()
        dirtySession.dispatch(renamed('Unsaved local'))
        const dirty = dirtySession.ingestExternal(snapshot(5, 'External conflicting update'))
        expect(dirty.status).toBe('conflict')
        expect(dirty.draftDocument?.profiles[0].name).toBe('Unsaved local')
        expect(dirty.conflict?.local.profiles[0].name).toBe('Unsaved local')
        expect(dirty.conflict?.external.profiles[0].name).toBe('External conflicting update')
    })

    it('resolves a three-way conflict with a merged document and commits against the external revision', async () => {
        const commitDocument = vi.fn(async request => ({
            status: 'committed' as const,
            snapshot: {
                revision: request.expectedRevision + 1,
                document: request.draft,
            },
        }))
        const session = createCompositionAuthoringSession(dependencies({ commitDocument }))
        await session.load()
        session.dispatch(renamed('Local'))
        session.ingestExternal(snapshot(8, 'External'))

        const merged = document('Merged')
        const resolved = session.resolveConflict({ strategy: 'merged', document: merged })
        expect(resolved).toMatchObject({ status: 'ready', baseRevision: 8, dirty: true })
        expect(resolved.baseDocument?.profiles[0].name).toBe('External')
        expect(resolved.draftDocument?.profiles[0].name).toBe('Merged')

        const committed = await session.commit()
        expect(commitDocument).toHaveBeenCalledWith(expect.objectContaining({
            expectedRevision: 8,
            changeSet: { beforeName: 'External', afterName: 'Merged' },
        }))
        expect(committed).toMatchObject({ status: 'ready', baseRevision: 9, dirty: false })
        expect(committed.draftDocument?.profiles[0].name).toBe('Merged')
    })

    it('supports choosing external or local conflict resolution explicitly', async () => {
        const externalSession = createCompositionAuthoringSession(dependencies())
        await externalSession.load()
        externalSession.dispatch(renamed('Local'))
        externalSession.ingestExternal(snapshot(6, 'External'))
        const external = externalSession.resolveConflict({ strategy: 'external' })
        expect(external).toMatchObject({ status: 'ready', baseRevision: 6, dirty: false })
        expect(external.draftDocument?.profiles[0].name).toBe('External')

        const localSession = createCompositionAuthoringSession(dependencies())
        await localSession.load()
        localSession.dispatch(renamed('Local'))
        localSession.ingestExternal(snapshot(6, 'External'))
        const local = localSession.resolveConflict({ strategy: 'local' })
        expect(local).toMatchObject({ status: 'ready', baseRevision: 6, dirty: true })
        expect(local.baseDocument?.profiles[0].name).toBe('External')
        expect(local.draftDocument?.profiles[0].name).toBe('Local')
    })
})
