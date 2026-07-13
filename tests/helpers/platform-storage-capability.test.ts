import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadStorage(isMobileRuntime: boolean) {
    vi.resetModules()
    vi.doMock('@/platform/runtime', () => ({ isMobileRuntime }))
    vi.doMock('@tauri-apps/api/path', () => ({
        appDataDir: async () => 'app-data',
        pictureDir: async () => 'pictures',
        join: async (...parts: string[]) => parts.join('/'),
    }))
    vi.doMock('@tauri-apps/plugin-fs', () => ({
        BaseDirectory: { AppData: 1, Picture: 2 },
    }))
    return import('@/platform/storage')
}

afterEach(() => {
    vi.resetModules()
    vi.doUnmock('@/platform/runtime')
    vi.doUnmock('@tauri-apps/api/path')
    vi.doUnmock('@tauri-apps/plugin-fs')
})

describe('media output capability gate', () => {
    it('allows an explicitly requested absolute path on desktop', async () => {
        const storage = await loadStorage(false)
        expect(storage.shouldUseAbsoluteMediaPath(true)).toBe(true)
        expect(storage.shouldUseAbsoluteMediaPath(false)).toBe(false)
    })

    it('clamps an absolute output request on mobile', async () => {
        const storage = await loadStorage(true)
        expect(storage.shouldUseAbsoluteMediaPath(true)).toBe(false)
        expect(storage.MEDIA_STORAGE_BASE_DIRECTORY).toBe(1)
    })
})
