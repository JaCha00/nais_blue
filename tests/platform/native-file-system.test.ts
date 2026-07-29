import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileSystem = vi.hoisted(() => ({
    readTextFile: vi.fn(),
    writeFile: vi.fn(),
    writeTextFile: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => fileSystem)

import {
    readNativeTextFile,
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
        expect(fileSystem.writeFile).toHaveBeenCalledWith('C:\\NAIS\\image.png', bytes)
    })
})
