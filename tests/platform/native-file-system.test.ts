import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileSystem = vi.hoisted(() => ({
    exists: vi.fn(),
    mkdir: vi.fn(),
    readDir: vi.fn(),
    readFile: vi.fn(),
    readTextFile: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
    writeTextFile: vi.fn(),
}))
const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-fs', () => fileSystem)
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
    createNativeDirectory,
    commitNativeSiblingIfAbsent,
    nativePathExists,
    readNativeBinaryFile,
    readNativeDirectory,
    readNativeTextFile,
    renameNativePath,
    writeNativeBinaryFile,
    writeNativeTextFile,
} from '@/platform/native-file-system'

describe('native file-system adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('reads text from the requested native path', async () => {
        fileSystem.readTextFile.mockResolvedValue('{"version":3}')

        await expect(readNativeTextFile('C:\\NAI Blue\\backup.json')).resolves.toBe('{"version":3}')
        expect(fileSystem.readTextFile).toHaveBeenCalledWith('C:\\NAI Blue\\backup.json')
    })

    it('writes text to the requested native path', async () => {
        fileSystem.writeTextFile.mockResolvedValue(undefined)

        await expect(writeNativeTextFile('C:\\NAI Blue\\fragment.txt', 'portrait')).resolves.toBeUndefined()
        expect(fileSystem.writeTextFile).toHaveBeenCalledWith('C:\\NAI Blue\\fragment.txt', 'portrait')
    })

    it('writes binary data to the requested native path', async () => {
        const bytes = new Uint8Array([137, 80, 78, 71])
        fileSystem.writeFile.mockResolvedValue(undefined)

        await expect(writeNativeBinaryFile('C:\\NAI Blue\\image.png', bytes)).resolves.toBeUndefined()
        expect(fileSystem.writeFile).toHaveBeenCalledWith('C:\\NAI Blue\\image.png', bytes, undefined)
    })

    it('reads binary data from the requested native path', async () => {
        const bytes = new Uint8Array([137, 80, 78, 71])
        fileSystem.readFile.mockResolvedValue(bytes)

        await expect(readNativeBinaryFile('C:\\NAI Blue\\image.png')).resolves.toBe(bytes)
        expect(fileSystem.readFile).toHaveBeenCalledWith('C:\\NAI Blue\\image.png')
    })

    it('checks paths and creates recursive directories with forwarded options', async () => {
        const options = { recursive: true }
        fileSystem.exists.mockResolvedValue(false)
        fileSystem.mkdir.mockResolvedValue(undefined)

        await expect(nativePathExists('C:\\NAI Blue\\output')).resolves.toBe(false)
        await expect(createNativeDirectory('C:\\NAI Blue\\output', options)).resolves.toBeUndefined()
        expect(fileSystem.exists).toHaveBeenCalledWith('C:\\NAI Blue\\output', undefined)
        expect(fileSystem.mkdir).toHaveBeenCalledWith('C:\\NAI Blue\\output', options)
    })

    it('lists directory entries within the requested path scope', async () => {
        const entries = [{ name: 'image.png', isDirectory: false, isFile: true, isSymlink: false }]
        fileSystem.readDir.mockResolvedValue(entries)

        await expect(readNativeDirectory('C:\\NAI Blue\\output')).resolves.toBe(entries)
        expect(fileSystem.readDir).toHaveBeenCalledWith('C:\\NAI Blue\\output', undefined)
    })

    it('renames the requested native path', async () => {
        fileSystem.rename.mockResolvedValue(undefined)

        await expect(renameNativePath('C:\\NAI Blue\\old', 'C:\\NAI Blue\\new')).resolves.toBeUndefined()
        expect(fileSystem.rename).toHaveBeenCalledWith('C:\\NAI Blue\\old', 'C:\\NAI Blue\\new')
    })

    it('delegates atomic sibling publication to the scoped native command', async () => {
        invoke.mockResolvedValue('destination-exists')

        await expect(commitNativeSiblingIfAbsent('C:\\Output\\.nai-blue-txn-a-image.tmp', 'C:\\Output\\image.png'))
            .resolves.toBe('destination-exists')
        expect(invoke).toHaveBeenCalledWith('commit_native_sibling_if_absent', {
            temporaryPath: 'C:\\Output\\.nai-blue-txn-a-image.tmp',
            finalPath: 'C:\\Output\\image.png',
        })
    })
})
