import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScenePreset } from '@/stores/scene-store'
import type { TrashItem } from '@/stores/trash-store'

const fs = vi.hoisted(() => ({
    copyFile: vi.fn(async () => undefined),
    exists: vi.fn(async () => true),
    mkdir: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/plugin-fs', () => fs)
vi.mock('@tauri-apps/api/path', () => ({
    dirname: async (path: string) => path.split('/').slice(0, -1).join('/') || '.',
    join: async (...parts: string[]) => parts.join('/'),
}))
vi.mock('@/platform/storage', () => ({
    getMediaStorageRoot: async () => 'C:/Media',
}))
vi.mock('@/lib/indexed-db', () => ({
    indexedDBStorage: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
    },
}))

import {
    archiveSceneFolder,
    archiveScenesIndividually,
    permanentlyRemoveTrashItem,
    pruneExpiredTrashItems,
    restoreTrashItem,
} from '@/services/trash/asset-trash-service'
import { useLibraryStore } from '@/stores/library-store'
import { useSceneStore } from '@/stores/scene-store'

const presets: ScenePreset[] = [
    {
        id: 'root',
        name: 'Root',
        parentId: null,
        createdAt: 1,
        scenes: [{
            id: 'scene-root',
            name: 'Root scene',
            scenePrompt: '',
            queueCount: 0,
            images: [{ id: 'image-root', url: 'C:/Output/root.png', timestamp: 1, isFavorite: false }],
            createdAt: 1,
        }],
    },
    {
        id: 'child',
        name: 'Child',
        parentId: 'root',
        createdAt: 2,
        scenes: [{
            id: 'scene-child',
            name: 'Child scene',
            scenePrompt: '',
            queueCount: 0,
            images: [{ id: 'image-child', url: 'C:/Output/child.png', timestamp: 2, isFavorite: true }],
            createdAt: 2,
        }],
    },
]

describe('asset trash service', () => {
    beforeEach(() => {
        fs.copyFile.mockReset()
        fs.exists.mockReset()
        fs.mkdir.mockReset()
        fs.remove.mockReset()
        fs.rename.mockReset()
        fs.copyFile.mockResolvedValue(undefined)
        fs.exists.mockResolvedValue(true)
        fs.mkdir.mockResolvedValue(undefined)
        fs.remove.mockResolvedValue(undefined)
        fs.rename.mockResolvedValue(undefined)
        useSceneStore.setState({
            presets: [{
                id: 'scene-default',
                name: '기본',
                parentId: null,
                createdAt: 0,
                scenes: [],
            }],
            activePresetId: 'scene-default',
        })
        useLibraryStore.setState({ items: [], currentStackId: null })
    })

    it('archives an entire Scene folder branch before the caller removes it from SceneStore', async () => {
        const archived = await archiveSceneFolder('root', presets)

        expect(archived?.kind).toBe('folder')
        expect(archived?.folder.presets.map(preset => preset.id)).toEqual(['root', 'child'])
        expect(archived?.folder.presets[0].scenes[0].images[0].originalUrl).toBe('C:/Output/root.png')
        expect(archived?.folder.presets[0].scenes[0].images[0].url).toContain('/NAIS_Trash/trash-')
        expect(fs.rename).toHaveBeenCalledTimes(2)
        expect(fs.remove).not.toHaveBeenCalled()
    })

    it('removes only expired item files during the 30-day cleanup sweep', async () => {
        const expired: TrashItem = {
            id: 'expired',
            kind: 'image',
            title: 'old',
            deletedAt: 0,
            expiresAt: 0,
            source: 'scene',
            image: {
                id: 'old-image',
                url: 'C:/Media/NAIS_Trash/expired/old.png',
                originalUrl: 'C:/Output/old.png',
                timestamp: 0,
                isFavorite: false,
            },
        }
        const fresh: TrashItem = { ...expired, id: 'fresh', expiresAt: Date.now() + 60_000 }

        await expect(permanentlyRemoveTrashItem(expired)).resolves.toEqual({ success: true, failedPaths: [] })
        expect(fs.remove).toHaveBeenCalledWith('C:/Media/NAIS_Trash/expired/old.png')

        fs.remove.mockClear()
        await expect(pruneExpiredTrashItems([expired, fresh])).resolves.toEqual(['expired'])
        expect(fs.remove).toHaveBeenCalledWith('C:/Media/NAIS_Trash/expired/old.png')
    })

    it('keeps a failed permanent-delete journal item eligible for later retry', async () => {
        const locked: TrashItem = {
            id: 'locked',
            kind: 'image',
            title: 'locked',
            deletedAt: 0,
            expiresAt: 0,
            source: 'library',
            image: {
                id: 'locked-image',
                url: 'C:/Media/NAIS_Trash/locked/locked.webp',
                originalUrl: 'C:/Library/locked.webp',
                timestamp: 0,
                isFavorite: false,
            },
        }
        fs.remove.mockRejectedValueOnce(new Error('file is locked'))

        await expect(permanentlyRemoveTrashItem(locked)).resolves.toEqual({
            success: false,
            failedPaths: ['C:/Media/NAIS_Trash/locked/locked.webp'],
        })
        fs.remove.mockRejectedValueOnce(new Error('still locked'))
        await expect(pruneExpiredTrashItems([locked])).resolves.toEqual([])
    })

    it('commits each selected Scene only after its own archive succeeds', async () => {
        const secondScene = {
            ...presets[0].scenes[0],
            id: 'scene-second',
            images: [{ id: 'image-second', url: 'C:/Output/second.png', timestamp: 2, isFavorite: false }],
        }
        fs.mkdir.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('trash directory unavailable'))
        const archived: TrashItem[] = []
        const removed: string[] = []

        const result = await archiveScenesIndividually(
            [presets[0].scenes[0], secondScene],
            presets[0],
            item => archived.push(item),
            id => removed.push(id),
        )

        expect(result).toEqual({ archivedSceneIds: ['scene-root'], failedSceneIds: ['scene-second'] })
        expect(archived).toHaveLength(1)
        expect(removed).toEqual(['scene-root'])
    })

    it('restores a Scene file and snapshot, then leaves no work for the journal', async () => {
        const archivedPath = 'C:/Media/NAIS_Trash/scene-item/scene.png'
        const originalPath = 'C:/Output/scene.png'
        const files = new Set([archivedPath])
        fs.exists.mockImplementation(async (path: string) => files.has(path))
        fs.rename.mockImplementation(async (source: string, destination: string) => {
            if (!files.has(source)) throw new Error('source missing')
            files.delete(source)
            files.add(destination)
        })
        const item: TrashItem = {
            id: 'scene-item',
            kind: 'scene',
            title: 'Recovered Scene',
            deletedAt: 0,
            expiresAt: Date.now() + 1,
            scene: {
                preset: { id: 'preset-recovered', name: 'Recovered', parentId: null, createdAt: 1 },
                scene: {
                    id: 'scene-recovered',
                    name: 'Recovered Scene',
                    scenePrompt: 'test',
                    queueCount: 0,
                    createdAt: 1,
                    images: [{
                        id: 'image-recovered',
                        url: archivedPath,
                        originalUrl: originalPath,
                        timestamp: 1,
                        isFavorite: true,
                    }],
                },
            },
        }

        await expect(restoreTrashItem(item)).resolves.toEqual({ success: true, conflictPaths: [], failedPaths: [] })
        expect(files).toEqual(new Set([originalPath]))
        expect(useSceneStore.getState().presets.find(preset => preset.id === 'preset-recovered')?.scenes[0].images[0]).toMatchObject({
            id: 'image-recovered',
            url: originalPath,
        })
    })

    it('does not overwrite a conflicting restore destination or change the Scene store', async () => {
        const archivedPath = 'C:/Media/NAIS_Trash/conflict/conflict.png'
        const originalPath = 'C:/Output/conflict.png'
        fs.exists.mockImplementation(async (path: string) => path === archivedPath || path === originalPath)
        const item: TrashItem = {
            id: 'conflict',
            kind: 'image',
            title: 'Conflict image',
            deletedAt: 0,
            expiresAt: Date.now() + 1,
            source: 'scene',
            image: {
                id: 'conflict-image',
                url: archivedPath,
                originalUrl: originalPath,
                timestamp: 1,
                isFavorite: false,
                restoreTarget: {
                    scene: {
                        presetId: 'scene-default',
                        presetName: '기본',
                        sceneId: 'conflict-scene',
                        sceneName: 'Conflict scene',
                    },
                },
            },
        }

        await expect(restoreTrashItem(item)).resolves.toEqual({
            success: false,
            conflictPaths: [originalPath],
            failedPaths: [],
        })
        expect(fs.rename).not.toHaveBeenCalled()
        expect(useSceneStore.getState().presets[0].scenes).toHaveLength(0)
    })

    it('rolls back an earlier file move when a later restore file fails', async () => {
        const archivedFirst = 'C:/Media/NAIS_Trash/partial/first.png'
        const archivedSecond = 'C:/Media/NAIS_Trash/partial/second.png'
        const originalFirst = 'C:/Output/first.png'
        const originalSecond = 'C:/Output/second.png'
        const files = new Set([archivedFirst, archivedSecond])
        fs.exists.mockImplementation(async (path: string) => files.has(path))
        fs.rename.mockImplementation(async (source: string, destination: string) => {
            if (source === archivedSecond) throw new Error('second file is locked')
            if (!files.has(source)) throw new Error('source missing')
            files.delete(source)
            files.add(destination)
        })
        fs.copyFile.mockImplementation(async (source: string, destination: string) => {
            if (source === archivedSecond) throw new Error('copy blocked')
            if (!files.has(source)) throw new Error('source missing')
            files.add(destination)
        })
        const item: TrashItem = {
            id: 'partial',
            kind: 'scene',
            title: 'Partial Scene',
            deletedAt: 0,
            expiresAt: Date.now() + 1,
            scene: {
                preset: { id: 'partial-preset', name: 'Partial', parentId: null, createdAt: 1 },
                scene: {
                    id: 'partial-scene', name: 'Partial Scene', scenePrompt: '', queueCount: 0, createdAt: 1,
                    images: [
                        { id: 'partial-first', url: archivedFirst, originalUrl: originalFirst, timestamp: 1, isFavorite: false },
                        { id: 'partial-second', url: archivedSecond, originalUrl: originalSecond, timestamp: 1, isFavorite: false },
                    ],
                },
            },
        }

        const result = await restoreTrashItem(item)
        expect(result.success).toBe(false)
        expect(files).toEqual(new Set([archivedFirst, archivedSecond]))
        expect(useSceneStore.getState().presets.find(preset => preset.id === 'partial-preset')).toBeUndefined()
    })

    it('restores a Scene folder hierarchy and a Library item into its original stack', async () => {
        const folder: TrashItem = {
            id: 'folder', kind: 'folder', title: 'Root', deletedAt: 0, expiresAt: Date.now() + 1,
            folder: {
                rootPresetId: 'folder-root',
                presets: [
                    {
                        id: 'folder-root', name: 'Root', parentId: null, createdAt: 1,
                        scenes: [{ id: 'folder-scene-root', name: 'Root Scene', scenePrompt: '', queueCount: 0, createdAt: 1, images: [] }],
                    },
                    {
                        id: 'folder-child', name: 'Child', parentId: 'folder-root', createdAt: 2,
                        scenes: [{ id: 'folder-scene-child', name: 'Child Scene', scenePrompt: '', queueCount: 0, createdAt: 2, images: [] }],
                    },
                ],
            },
        }
        useLibraryStore.setState({
            items: [{
                id: 'stack-existing', name: 'Existing stack', path: 'C:/Library/existing.png', width: 1, height: 1, createdAt: 1,
                isStack: true, stackItems: [],
            }],
        })
        const archivedPath = 'C:/Media/NAIS_Trash/library/library.png'
        const originalPath = 'C:/Library/library.png'
        const files = new Set([archivedPath])
        fs.exists.mockImplementation(async (path: string) => files.has(path))
        fs.rename.mockImplementation(async (source: string, destination: string) => {
            if (!files.has(source)) throw new Error('source missing')
            files.delete(source)
            files.add(destination)
        })
        const library: TrashItem = {
            id: 'library', kind: 'library', title: 'Library image', deletedAt: 0, expiresAt: Date.now() + 1,
            library: {
                sourceStackId: 'stack-existing',
                originalPaths: { 'library-image': originalPath },
                items: [{ id: 'library-image', name: 'Library image', path: archivedPath, width: 10, height: 20, createdAt: 1 }],
            },
        }

        await expect(restoreTrashItem(folder)).resolves.toMatchObject({ success: true })
        await expect(restoreTrashItem(library)).resolves.toMatchObject({ success: true })
        const restoredPresets = useSceneStore.getState().presets
        expect(restoredPresets.find(preset => preset.id === 'folder-child')?.parentId).toBe('folder-root')
        expect(useLibraryStore.getState().items[0].stackItems).toMatchObject([{ id: 'library-image', path: originalPath }])
        expect(files).toEqual(new Set([originalPath]))
    })
})
