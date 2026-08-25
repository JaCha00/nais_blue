import { describe, expect, it } from 'vitest'

import {
    DEFAULT_GENERATION_FOLDER_ID,
    createDefaultGenerationFolder,
    type GenerationFolder,
} from '@/domain/generation-folders'
import { normalizePersistedSettingsState } from '@/stores/settings-store'

const childFolder: GenerationFolder = {
    schemaVersion: 1,
    id: 'generation-folder-child',
    name: 'R2 output',
    parentId: DEFAULT_GENERATION_FOLDER_ID,
    rootDirectory: null,
    useAbsolutePath: false,
    commonPrompt: 'blue hair',
    r2: { autoUpload: true, bucket: 'scene-assets', prefix: 'scenes' },
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
}

describe('settings persistence migration', () => {
    it('rebuilds the default generation folder from a legacy custom drive', () => {
        const migrated = normalizePersistedSettingsState({
            savePath: 'E:\\NAI\\Images',
            useAbsolutePath: true,
        })

        expect(migrated.savePath).toBe('E:\\NAI\\Images')
        expect(migrated.useAbsolutePath).toBe(true)
        expect(migrated.sceneSubfoldersEnabled).toBe(true)
        expect(migrated.generationFolders).toHaveLength(1)
        expect(migrated.generationFolders?.[0]).toMatchObject({
            id: DEFAULT_GENERATION_FOLDER_ID,
            rootDirectory: 'E:\\NAI\\Images',
            useAbsolutePath: true,
        })
        expect(migrated.activeGenerationFolderId).toBe(DEFAULT_GENERATION_FOLDER_ID)
    })

    it('keeps valid folders and explicit flat Scene output while repairing a stale default root', () => {
        const migrated = normalizePersistedSettingsState({
            savePath: 'E:\\NAI\\Images',
            useAbsolutePath: true,
            sceneSubfoldersEnabled: false,
            generationFolders: [createDefaultGenerationFolder(), childFolder],
            activeGenerationFolderId: childFolder.id,
        })

        expect(migrated.sceneSubfoldersEnabled).toBe(false)
        expect(migrated.activeGenerationFolderId).toBe(childFolder.id)
        expect(migrated.generationFolders).toHaveLength(2)
        expect(migrated.generationFolders?.[0]).toMatchObject({
            rootDirectory: 'E:\\NAI\\Images',
            useAbsolutePath: true,
        })
        expect(migrated.generationFolders?.[1]).toEqual(childFolder)
    })
})
