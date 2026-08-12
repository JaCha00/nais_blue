import { describe, expect, it } from 'vitest'

import {
    createDefaultGenerationFolder,
    generationFolderDescendantIds,
    resolveGenerationFolder,
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
})
