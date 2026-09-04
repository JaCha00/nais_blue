import { describe, expect, it } from 'vitest'

import {
    DEFAULT_GENERATION_FOLDER_ID,
    createDefaultGenerationFolder,
    generationFolderDescendantIds,
    normalizeGenerationFolderV1Projection,
    isGenerationFolderDocument,
    isGenerationFolderPathSegment,
    migrateGenerationFolderV1Projection,
    resolveGenerationFolder,
    resolveGenerationFolderV2,
    selectGenerationFolderV2,
    type GenerationFolder,
} from '@/domain/generation-folders'
import { isR2BucketName, normalizeR2Prefix } from '@/domain/r2/types'

const NOW = '2026-08-12T00:00:00.000Z'

function folder(input: Partial<GenerationFolder> & Pick<GenerationFolder, 'id' | 'name'>): GenerationFolder {
    return {
        schemaVersion: 1,
        parentId: null,
        rootDirectory: null,
        useAbsolutePath: false,
        commonPrompt: '',
        r2: { autoUpload: false, bucket: null, prefix: null },
        createdAt: NOW,
        updatedAt: NOW,
        ...input,
    }
}

describe('generation folder resolution', () => {
    it('derives local and R2 child paths from the root and closest explicit prefix', () => {
        const folders = [
            folder({
                id: 'root', name: 'Project', rootDirectory: 'D:\\images', useAbsolutePath: true,
                r2: { autoUpload: false, bucket: 'root-bucket', prefix: 'prime/bluehair' },
            }),
            folder({ id: 'child', name: '01', parentId: 'root', r2: { autoUpload: true, bucket: null, prefix: null } }),
        ]

        expect(resolveGenerationFolder(folders, 'child', {
            directory: 'NAI_Blue_Output', useAbsolutePath: false, r2Bucket: 'profile-bucket', r2Prefix: 'generated',
        })).toMatchObject({
            path: 'Project / 01',
            directory: 'D:\\images\\01',
            useAbsolutePath: true,
            r2: { autoUpload: true, bucket: 'root-bucket', prefix: 'prime/bluehair/01', prefixSource: 'ancestor' },
        })
    })

    it('prioritizes a child bucket and prefix override without inheriting the parent prompt', () => {
        const folders = [
            folder({ id: 'root', name: 'Project', rootDirectory: 'NAI_Blue_Output', commonPrompt: 'parent prompt', r2: { autoUpload: true, bucket: 'root-bucket', prefix: 'prime' } }),
            folder({ id: 'child', name: 'Blue', parentId: 'root', commonPrompt: 'child prompt', r2: { autoUpload: true, bucket: 'child-bucket', prefix: 'custom/path' } }),
        ]

        expect(resolveGenerationFolder(folders, 'child', { directory: 'fallback', useAbsolutePath: false })).toMatchObject({
            directory: 'NAI_Blue_Output/Blue',
            commonPrompt: 'child prompt',
            r2: { bucket: 'child-bucket', prefix: 'custom/path', prefixSource: 'folder' },
        })
    })

    it('uses the profile prefix plus the logical tree when no folder overrides it', () => {
        const root = createDefaultGenerationFolder('NAI_Blue_Output', false, NOW)
        const child = folder({ id: 'child', name: '01', parentId: root.id })
        expect(resolveGenerationFolder([root, child], child.id, {
            directory: 'fallback', useAbsolutePath: false, r2Bucket: 'bucket', r2Prefix: 'generated',
        })?.r2.prefix).toBe('generated/01')
    })

    it('preserves the legacy profile prefix for the untouched default folder', () => {
        const root = createDefaultGenerationFolder('NAI_Blue_Output', false, NOW)
        expect(resolveGenerationFolder([root], root.id, {
            directory: 'fallback', useAbsolutePath: false, r2Bucket: 'bucket', r2Prefix: 'generated',
        })?.r2.prefix).toBe('generated')
    })

    it('rejects unsafe prefixes and bucket names and lists descendants', () => {
        expect(() => normalizeR2Prefix('safe/../escape')).toThrow()
        expect(normalizeR2Prefix('/prime\\bluehair//01/')).toBe('prime/bluehair/01')
        expect(isR2BucketName('valid-bucket')).toBe(true)
        expect(isR2BucketName('Invalid_Bucket')).toBe(false)
        expect(generationFolderDescendantIds([
            folder({ id: 'root', name: 'root' }),
            folder({ id: 'child', name: 'child', parentId: 'root' }),
            folder({ id: 'grandchild', name: 'grandchild', parentId: 'child' }),
        ], 'root').sort()).toEqual(['child', 'grandchild'])
    })

    it('adds and synchronizes the default root while falling back from a stale active ID', () => {
        const child = folder({ id: 'child', name: 'Child' })
        const projection = normalizeGenerationFolderV1Projection({
            savePath: 'E:\\NAI\\Images',
            useAbsolutePath: true,
            generationFolders: [child],
            activeGenerationFolderId: 'missing',
        })

        expect(projection.generationFolders).toHaveLength(2)
        expect(projection.generationFolders[0]).toMatchObject({
            id: 'generation-folder-default',
            rootDirectory: 'E:\\NAI\\Images',
            useAbsolutePath: true,
        })
        expect(projection.generationFolders[1]).toEqual(child)
        expect(projection.activeGenerationFolderId).toBe('generation-folder-default')
    })
})

describe('generation folder V2 authority', () => {
    const projection = normalizeGenerationFolderV1Projection({
        savePath: 'E:\\NAI\\Images',
        useAbsolutePath: true,
        generationFolders: [
            folder({ id: DEFAULT_GENERATION_FOLDER_ID, name: '기본 출력', r2: { autoUpload: false, bucket: 'root-bucket', prefix: 'ancestor/base' } }),
            folder({ id: 'child', name: 'Child', parentId: DEFAULT_GENERATION_FOLDER_ID, r2: { autoUpload: false, bucket: 'child-bucket', prefix: null } }),
            folder({ id: 'grandchild', name: 'Grandchild', parentId: 'child', commonPrompt: 'prompt', r2: { autoUpload: true, bucket: null, prefix: null } }),
        ],
        activeGenerationFolderId: 'grandchild',
    })

    it('migrates without mutating V1 and preserves local/R2 resolution', () => {
        const preimage = structuredClone(projection)
        const document = migrateGenerationFolderV1Projection('workspace:1', projection)
        const before = resolveGenerationFolder(projection.generationFolders, 'grandchild', {
            directory: 'fallback', useAbsolutePath: false, r2Bucket: 'profile', r2Prefix: 'profile-prefix',
        })
        const after = resolveGenerationFolderV2(document, 'grandchild', {
            directory: 'fallback', useAbsolutePath: false, r2ProfileId: 'profile:1', r2Bucket: 'profile', r2Prefix: 'profile-prefix',
        })

        expect(projection).toEqual(preimage)
        expect(document).toMatchObject({ schemaVersion: 2, workspaceId: 'workspace:1', revision: 1 })
        expect(after).toMatchObject({
            directory: before?.directory,
            useAbsolutePath: before?.useAbsolutePath,
            commonPrompt: before?.commonPrompt,
            autoUpload: before?.r2.autoUpload,
            r2: { bucket: before?.r2.bucket, prefix: before?.r2.prefix },
        })
    })

    it('fails closed for unsafe segments, duplicate siblings, cycles, and invalid root authority', () => {
        for (const value of ['CON', 'nul.txt', 'trailing.', 'trailing ', '../escape']) {
            expect(isGenerationFolderPathSegment(value)).toBe(false)
        }
        const document = migrateGenerationFolderV1Projection('workspace:1', projection)
        const child = document.folders.find(candidate => candidate.id === 'child')!
        expect(isGenerationFolderDocument({ ...document, folders: [...document.folders, { ...child, id: 'duplicate' }] })).toBe(false)
        expect(isGenerationFolderDocument({ ...document, folders: document.folders.map(candidate => candidate.id === DEFAULT_GENERATION_FOLDER_ID ? { ...candidate, parentId: 'grandchild', rootDirectory: null, useAbsolutePath: false } : candidate) })).toBe(false)
    })

    it('supports R2 clear semantics and reports source provenance', () => {
        const document = migrateGenerationFolderV1Projection('workspace:1', projection)
        const cleared = {
            ...document,
            folders: document.folders.map(candidate => candidate.id === 'child' ? {
                ...candidate,
                r2ProfilePolicy: { mode: 'clear' as const },
                r2BucketPolicy: { mode: 'clear' as const },
                r2PrefixPolicy: { mode: 'clear' as const },
            } : candidate),
        }
        expect(resolveGenerationFolderV2(cleared, 'grandchild', { directory: 'fallback', useAbsolutePath: false, r2ProfileId: 'profile', r2Bucket: 'bucket', r2Prefix: 'prefix' })).toMatchObject({
            r2: { enabled: false, profileId: null, bucket: null, prefix: 'Grandchild' },
            sources: { r2Profile: 'child', r2Bucket: 'child', r2Prefix: 'child' },
            provenance: { r2Profile: 'cleared', r2Bucket: 'cleared', r2Prefix: 'cleared' },
        })
    })

    it('returns ambiguous label selectors with stable candidate IDs and paths', () => {
        const document = migrateGenerationFolderV1Projection('workspace:1', projection)
        const duplicate = { ...document.folders.find(candidate => candidate.id === 'grandchild')!, id: 'other', displayName: 'Grandchild', pathSegment: 'Other', parentId: DEFAULT_GENERATION_FOLDER_ID }
        expect(selectGenerationFolderV2({ ...document, folders: [...document.folders, duplicate] }, 'Grandchild')).toEqual({
            status: 'AMBIGUOUS',
            candidates: [
                { id: 'grandchild', path: '기본 출력/Child/Grandchild' },
                { id: 'other', path: '기본 출력/Other' },
            ],
        })
    })
})
