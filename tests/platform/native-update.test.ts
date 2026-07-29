import { describe, expect, it, vi } from 'vitest'

const updater = vi.hoisted(() => ({
    check: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => updater)

import { checkForNativeUpdate } from '@/platform/native-update'

describe('native update adapter', () => {
    it('returns the native update handle without changing its behavior', async () => {
        const update = {
            version: '3.0.0',
            download: vi.fn(),
            install: vi.fn(),
            downloadAndInstall: vi.fn(),
        }
        updater.check.mockResolvedValue(update)

        await expect(checkForNativeUpdate()).resolves.toBe(update)
        expect(updater.check).toHaveBeenCalledOnce()
    })
})
