import { describe, expect, it, vi } from 'vitest'

import {
    applyGenerationFolderChanges,
    type FolderOccupancyResult,
} from '@/application/folder/apply-folder-changes'
import type { GenerationFolderRepositoryPort } from '@/application/folder/generation-folder-repository'
import {
    planGenerationFolderChanges,
    type GenerationFolderChange,
} from '@/application/folder/plan-folder-changes'
import {
    migrateGenerationFolderV1Projection,
    normalizeGenerationFolderV1Projection,
    type GenerationFolder,
    type GenerationFolderDocument,
    type GenerationFolderV2,
} from '@/domain/generation-folders'

const NOW = '2026-09-04T00:00:00.000Z'
const defaults = { directory: 'fallback', useAbsolutePath: false, r2Prefix: 'generated' }
const legacyFolder = (input: Partial<GenerationFolder> & Pick<GenerationFolder, 'id' | 'name'>): GenerationFolder => ({
    schemaVersion: 1, parentId: null, rootDirectory: null, useAbsolutePath: false, commonPrompt: '',
    r2: { autoUpload: false, bucket: null, prefix: null }, createdAt: NOW, updatedAt: NOW, ...input,
})
const initialDocument = migrateGenerationFolderV1Projection('workspace', normalizeGenerationFolderV1Projection({
    savePath: 'D:\\images', useAbsolutePath: true, activeGenerationFolderId: 'grandchild',
    generationFolders: [
        legacyFolder({ id: 'root', name: 'Root', rootDirectory: 'D:\\images', useAbsolutePath: true }),
        legacyFolder({ id: 'child', name: 'Child', parentId: 'root' }),
        legacyFolder({ id: 'grandchild', name: 'Grandchild', parentId: 'child' }),
    ],
}))

function repository(start: GenerationFolderDocument = initialDocument): {
    port: GenerationFolderRepositoryPort
    commit: ReturnType<typeof vi.fn>
    current: () => GenerationFolderDocument
} {
    let current = structuredClone(start)
    const commit = vi.fn(async (next: GenerationFolderDocument, expectedRevision: number) => {
        if (current.revision !== expectedRevision) {
            return { status: 'REVISION_CONFLICT' as const, current: structuredClone(current) }
        }
        current = structuredClone(next)
        return { status: 'COMMITTED' as const, document: structuredClone(current) }
    })
    return {
        port: {
            readLegacyProjection: async () => null,
            getDocument: async workspaceId => workspaceId === current.workspaceId ? structuredClone(current) : null,
            listDocuments: async () => [{
                workspaceId: current.workspaceId, revision: current.revision, folderCount: current.folders.length,
            }],
            commit,
            materializeLegacy: async () => null,
        },
        commit,
        current: () => structuredClone(current),
    }
}

function planned(document: GenerationFolderDocument, changes: readonly GenerationFolderChange[]) {
    const result = planGenerationFolderChanges(document, changes, defaults)
    if (result.status !== 'PLANNED') throw new Error(result.reason)
    return result
}

function emptyGuard() {
    return vi.fn(async (): Promise<FolderOccupancyResult> => ({ status: 'empty' }))
}

describe('applyGenerationFolderChanges', () => {
    it('commits a display-only change once without consulting occupancy', async () => {
        const state = repository()
        const changes = [{ folderId: 'child', displayName: '표시 이름' }] as const
        const plan = planned(initialDocument, changes)
        const occupancyGuard = emptyGuard()

        const result = await applyGenerationFolderChanges({
            repository: state.port, workspaceId: 'workspace', expectedRevision: initialDocument.revision,
            expectedPlanHash: plan.planHash, changes, defaults, occupancyGuard,
        })

        expect(result.status).toBe('COMMITTED')
        expect(state.commit).toHaveBeenCalledOnce()
        expect(occupancyGuard).not.toHaveBeenCalled()
        expect(state.current().folders.find(folder => folder.id === 'child')?.displayName).toBe('표시 이름')
    })

    it('commits an empty subtree path change with one guard and one CAS', async () => {
        const state = repository()
        const changes = [{ folderId: 'child', pathSegment: 'Renamed' }] as const
        const plan = planned(initialDocument, changes)
        const occupancyGuard = emptyGuard()

        const result = await applyGenerationFolderChanges({
            repository: state.port, workspaceId: 'workspace', expectedRevision: initialDocument.revision,
            expectedPlanHash: plan.planHash, changes, defaults, occupancyGuard,
        })

        expect(result.status).toBe('COMMITTED')
        expect(occupancyGuard).toHaveBeenCalledWith(['child', 'grandchild'])
        expect(state.commit).toHaveBeenCalledOnce()
    })

    it('rejects a stale reviewed plan before occupancy or commit', async () => {
        const plan = planned(initialDocument, [{ folderId: 'child', displayName: 'reviewed' }])
        const state = repository({ ...initialDocument, revision: initialDocument.revision + 1 })
        const occupancyGuard = emptyGuard()

        const result = await applyGenerationFolderChanges({
            repository: state.port, workspaceId: 'workspace', expectedRevision: initialDocument.revision,
            expectedPlanHash: plan.planHash,
            changes: [{ folderId: 'child', displayName: 'reviewed' }], defaults, occupancyGuard,
        })

        expect(result).toEqual({ status: 'REVISION_CONFLICT' })
        expect(occupancyGuard).not.toHaveBeenCalled()
        expect(state.commit).not.toHaveBeenCalled()
    })

    it('rejects a planned collision without occupancy or commit', async () => {
        const state = repository()
        const changes = [{ folderId: 'grandchild', parentId: 'root', pathSegment: 'child' }] as const
        const plan = planned(initialDocument, changes)
        const occupancyGuard = emptyGuard()

        const result = await applyGenerationFolderChanges({
            repository: state.port, workspaceId: 'workspace', expectedRevision: initialDocument.revision,
            expectedPlanHash: plan.planHash, changes, defaults, occupancyGuard,
        })

        expect(result.status).toBe('COLLISION')
        expect(occupancyGuard).not.toHaveBeenCalled()
        expect(state.commit).not.toHaveBeenCalled()
    })

    it.each(['occupied', 'unknown'] as const)('fails closed on %s path occupancy', async status => {
        const state = repository()
        const changes = [{ folderId: 'child', pathSegment: 'Renamed' }] as const
        const plan = planned(initialDocument, changes)
        const occupancyGuard = vi.fn(async (): Promise<FolderOccupancyResult> => ({
            status, folderIds: ['child'],
        }))

        const result = await applyGenerationFolderChanges({
            repository: state.port, workspaceId: 'workspace', expectedRevision: initialDocument.revision,
            expectedPlanHash: plan.planHash, changes, defaults, occupancyGuard,
        })

        expect(result).toMatchObject({
            status: 'UNSUPPORTED', reason: 'unsupported-needs-relocation-policy', occupancy: { status },
        })
        expect(state.commit).not.toHaveBeenCalled()
    })

    it('creates and then deletes one leaf through separate single-CAS plans', async () => {
        const state = repository()
        const leaf: GenerationFolderV2 = {
            id: 'leaf', displayName: 'Leaf', pathSegment: 'Leaf', parentId: 'child',
            rootDirectory: null, useAbsolutePath: false, commonPrompt: '', autoUpload: false,
            r2ProfilePolicy: { mode: 'inherit' }, r2BucketPolicy: { mode: 'inherit' },
            r2PrefixPolicy: { mode: 'inherit' },
        }
        const createChanges = [{ op: 'create', folder: leaf }] as const
        const createPlan = planned(state.current(), createChanges)
        await expect(applyGenerationFolderChanges({
            repository: state.port, workspaceId: 'workspace', expectedRevision: state.current().revision,
            expectedPlanHash: createPlan.planHash, changes: createChanges, defaults, occupancyGuard: emptyGuard(),
        })).resolves.toMatchObject({ status: 'COMMITTED' })

        const deleteChanges = [{ op: 'delete', folderId: 'leaf' }] as const
        const deletePlan = planned(state.current(), deleteChanges)
        await expect(applyGenerationFolderChanges({
            repository: state.port, workspaceId: 'workspace', expectedRevision: state.current().revision,
            expectedPlanHash: deletePlan.planHash, changes: deleteChanges, defaults, occupancyGuard: emptyGuard(),
        })).resolves.toMatchObject({ status: 'COMMITTED' })

        expect(state.commit).toHaveBeenCalledTimes(2)
        expect(state.current().folders.some(folder => folder.id === 'leaf')).toBe(false)
    })
})
