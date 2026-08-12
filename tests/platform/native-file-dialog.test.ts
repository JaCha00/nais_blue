import { beforeEach, describe, expect, it, vi } from 'vitest'

const dialog = vi.hoisted(() => ({
    open: vi.fn(),
    save: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => dialog)

import { openNativeFileDialog, saveNativeFileDialog } from '@/platform/native-file-dialog'

describe('native file dialog adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('preserves multiple file selections from the native picker', async () => {
        dialog.open.mockResolvedValue(['one.txt', 'two.txt'])

        await expect(openNativeFileDialog({ multiple: true })).resolves.toEqual(['one.txt', 'two.txt'])
        expect(dialog.open).toHaveBeenCalledWith({ multiple: true })
    })

    it('forwards save options and the selected path', async () => {
        dialog.save.mockResolvedValue('C:\\NAI Blue\\image.png')
        const options = { defaultPath: 'image.png' }

        await expect(saveNativeFileDialog(options)).resolves.toBe('C:\\NAI Blue\\image.png')
        expect(dialog.save).toHaveBeenCalledWith(options)
    })
})
