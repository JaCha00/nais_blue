import { describe, expect, it } from 'vitest'
import { planGenerationFolderChanges } from '@/application/folder/plan-folder-changes'
import { migrateGenerationFolderV1Projection, normalizeGenerationFolderV1Projection, type GenerationFolder } from '@/domain/generation-folders'

const NOW = '2026-09-04T00:00:00.000Z'
const folder = (input: Partial<GenerationFolder> & Pick<GenerationFolder, 'id' | 'name'>): GenerationFolder => ({
    schemaVersion: 1, parentId: null, rootDirectory: null, useAbsolutePath: false, commonPrompt: '',
    r2: { autoUpload: false, bucket: null, prefix: null }, createdAt: NOW, updatedAt: NOW, ...input,
})
const document = migrateGenerationFolderV1Projection('workspace', normalizeGenerationFolderV1Projection({
    savePath: 'D:\\images', useAbsolutePath: true, activeGenerationFolderId: 'grandchild',
    generationFolders: [
        folder({ id: 'root', name: 'Root', rootDirectory: 'D:\\images', useAbsolutePath: true }),
        folder({ id: 'child', name: 'Child', parentId: 'root' }),
        folder({ id: 'grandchild', name: 'Grandchild', parentId: 'child' }),
    ],
}))
const defaults = { directory: 'fallback', useAbsolutePath: false, r2Prefix: 'generated' }

describe('planGenerationFolderChanges', () => {
    it('does not report physical impact for a display-name-only change', () => {
        const result = planGenerationFolderChanges(document, [{ folderId: 'child', displayName: '표시 이름' }], defaults)
        expect(result).toMatchObject({ status: 'PLANNED', pathImpacts: [] })
        expect(result).toMatchObject({
            planHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            documentBinding: {
                resourceType: 'generation-folder-document',
                resourceId: 'workspace',
                revision: document.revision,
                contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            },
            collisions: [],
            requiredAuthorizations: [],
        })
        if (result.status === 'PLANNED') expect(result.resultingTree).toHaveLength(document.folders.length)
    })

    it('reports the changed subtree before/after without touching a filesystem', () => {
        const result = planGenerationFolderChanges(document, [{ folderId: 'child', pathSegment: 'Renamed' }], defaults)
        expect(result).toMatchObject({ status: 'PLANNED', pathImpacts: [
            { folderId: 'child', before: { directory: 'D:\\images\\Child' }, after: { directory: 'D:\\images\\Renamed' } },
            { folderId: 'grandchild', before: { directory: 'D:\\images\\Child\\Grandchild' }, after: { directory: 'D:\\images\\Renamed\\Grandchild' } },
        ] })
    })

    it('rejects the whole plan when one patch is invalid', () => {
        expect(planGenerationFolderChanges(document, [
            { folderId: 'child', displayName: 'valid' },
            { folderId: 'grandchild', pathSegment: 'CON' },
        ], defaults)).toEqual({ status: 'INVALID', reason: 'Patch violates folder invariants' })
    })

    it('reports sibling path collisions without producing a writable tree', () => {
        const result = planGenerationFolderChanges(document, [{
            folderId: 'grandchild', parentId: 'root', pathSegment: 'child',
        }], defaults)

        expect(result).toMatchObject({
            status: 'PLANNED',
            collisions: [{ parentId: 'root', folderIds: ['child', 'grandchild'] }],
            resultingTree: [],
        })
    })

    it('requires authorization for every moved node under an absolute root', () => {
        const result = planGenerationFolderChanges(document, [{ folderId: 'child', pathSegment: 'Renamed' }], defaults)

        expect(result).toMatchObject({
            status: 'PLANNED',
            requiredAuthorizations: [
                { folderId: 'child', directory: 'D:\\images\\Renamed' },
                { folderId: 'grandchild', directory: 'D:\\images\\Renamed\\Grandchild' },
            ],
        })
    })
})
