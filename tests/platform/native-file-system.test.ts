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

vi.mock('@tauri-apps/plugin-fs', () => fileSystem)

import {
    createNativeDirectory,
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

        await expect(readNativeTextFile('C:\\NAIS\\backup.json')).resolves.toBe('{"version":3}')
        expect(fileSystem.readTextFile).toHaveBeenCalledWith('C:\\NAIS\\backup.json')
    })

    it('writes text to the requested native path', async () => {
        fileSystem.writeTextFile.mockResolvedValue(undefined)

        await expect(writeNativeTextFile('C:\\NAIS\\fragment.txt', 'portrait')).resolves.toBeUndefined()
        expect(fileSystem.writeTextFile).toHaveBeenCalledWith('C:\\NAIS\\fragment.txt', 'portrait')
    })

    it('writes binary data to the requested native path', async () => {
        const bytes = new Uint8Array([137, 80, 78, 71])
        fileSystem.writeFile.mockResolvedValue(undefined)

        await expect(writeNativeBinaryFile('C:\\NAIS\\image.png', bytes)).resolves.toBeUndefined()
        expect(fileSystem.writeFile).toHaveBeenCalledWith('C:\\NAIS\\image.png', bytes, undefined)
    })

    it('reads binary data from the requested native path', async () => {
        const bytes = new Uint8Array([137, 80, 78, 71])
        fileSystem.readFile.mockResolvedValue(bytes)

        await expect(readNativeBinaryFile('C:\\NAIS\\image.png')).resolves.toBe(bytes)
        expect(fileSystem.readFile).toHaveBeenCalledWith('C:\\NAIS\\image.png')
    })

    it('checks paths and creates recursive directories with forwarded options', async () => {
        const options = { recursive: true }
        fileSystem.exists.mockResolvedValue(false)
        fileSystem.mkdir.mockResolvedValue(undefined)

        await expect(nativePathExists('C:\\NAIS\\output')).resolves.toBe(false)
        await expect(createNativeDirectory('C:\\NAIS\\output', options)).resolves.toBeUndefined()
        expect(fileSystem.exists).toHaveBeenCalledWith('C:\\NAIS\\output', undefined)
        expect(fileSystem.mkdir).toHaveBeenCalledWith('C:\\NAIS\\output', options)
    })

    it('lists directory entries within the requested path scope', async () => {
        const entries = [{ name: 'image.png', isDirectory: false, isFile: true, isSymlink: false }]
        fileSystem.readDir.mockResolvedValue(entries)

        await expect(readNativeDirectory('C:\\NAIS\\output')).resolves.toBe(entries)
        expect(fileSystem.readDir).toHaveBeenCalledWith('C:\\NAIS\\output', undefined)
    })

    it('renames the requested native path', async () => {
        fileSystem.rename.mockResolvedValue(undefined)

        await expect(renameNativePath('C:\\NAIS\\old', 'C:\\NAIS\\new')).resolves.toBeUndefined()
        expect(fileSystem.rename).toHaveBeenCalledWith('C:\\NAIS\\old', 'C:\\NAIS\\new')
    })
})
