import { describe, expect, it } from 'vitest'

import { IndexedDbGenerationFolderRepository } from '@/adapters/folder/indexeddb-generation-folder-repository'
import {
    DEFAULT_GENERATION_FOLDER_ID,
    resolveGenerationFolder,
    type GenerationFolder,
} from '@/domain/generation-folders'
import { normalizePersistedSettingsState } from '@/stores/settings-store'

const NOW = '2026-09-04T00:00:00.000Z'

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

const legacyState = {
    savePath: 'E:\\NAI\\Images',
    useAbsolutePath: true,
    activeGenerationFolderId: 'grandchild',
    generationFolders: [
        folder({
            id: DEFAULT_GENERATION_FOLDER_ID,
            name: '기본 출력',
            rootDirectory: 'stale-root',
            r2: { autoUpload: false, bucket: 'root-bucket', prefix: 'ancestor/base' },
        }),
        folder({
            id: 'child',
            name: 'Child',
            parentId: DEFAULT_GENERATION_FOLDER_ID,
            r2: { autoUpload: false, bucket: 'child-bucket', prefix: null },
        }),
        folder({
            id: 'grandchild',
            name: 'Grandchild',
            parentId: 'child',
            commonPrompt: 'selected scalar prompt',
            r2: { autoUpload: true, bucket: null, prefix: null },
        }),
    ],
}

describe('IndexedDbGenerationFolderRepository', () => {
    it('reads the V1 envelope without changing its preimage and matches settings hydration', async () => {
        const preimage = JSON.stringify({ state: legacyState, version: 1 })
        const reads: string[] = []
        const persistence = {
            getItem: async (key: string) => {
                reads.push(key)
                return preimage
            },
        }

        const projection = await new IndexedDbGenerationFolderRepository(persistence).readLegacyProjection()
        const hydrated = normalizePersistedSettingsState(legacyState)

        expect(reads).toEqual(['nai-blue-settings'])
        expect(JSON.stringify({ state: legacyState, version: 1 })).toBe(preimage)
        expect(legacyState.generationFolders[0].rootDirectory).toBe('stale-root')
        expect(projection).toEqual({
            savePath: hydrated.savePath,
            useAbsolutePath: hydrated.useAbsolutePath,
            generationFolders: hydrated.generationFolders,
            activeGenerationFolderId: hydrated.activeGenerationFolderId,
        })
        expect(projection?.generationFolders[0]).toMatchObject({
            rootDirectory: 'E:\\NAI\\Images',
            useAbsolutePath: true,
        })
    })

    it('preserves the existing local and R2 resolver result for the selected grandchild', async () => {
        const repository = new IndexedDbGenerationFolderRepository({
            getItem: async () => JSON.stringify({ state: legacyState, version: 1 }),
        })
        const projection = await repository.readLegacyProjection()

        expect(resolveGenerationFolder(
            projection?.generationFolders ?? [],
            projection?.activeGenerationFolderId,
            { directory: 'fallback', useAbsolutePath: false, r2Bucket: 'profile-bucket', r2Prefix: 'profile' },
        )).toEqual({
            id: 'grandchild',
            path: '기본 출력 / Child / Grandchild',
            directory: 'E:\\NAI\\Images\\Child\\Grandchild',
            useAbsolutePath: true,
            commonPrompt: 'selected scalar prompt',
            r2: {
                autoUpload: true,
                bucket: 'child-bucket',
                prefix: 'ancestor/base/Child/Grandchild',
                prefixSource: 'ancestor',
            },
        })
    })

    it('returns null when the legacy settings key is missing', async () => {
        const repository = new IndexedDbGenerationFolderRepository({ getItem: async () => null })
        await expect(repository.readLegacyProjection()).resolves.toBeNull()
    })

    it.each([
        '{',
        'null',
        JSON.stringify({ state: legacyState }),
        JSON.stringify({ state: legacyState, version: 2 }),
        JSON.stringify({ state: [], version: 1 }),
    ])('rejects a malformed or unsupported envelope without repairing it: %s', async serialized => {
        const repository = new IndexedDbGenerationFolderRepository({ getItem: async () => serialized })
        await expect(repository.readLegacyProjection()).rejects.toBeInstanceOf(TypeError)
    })
})
