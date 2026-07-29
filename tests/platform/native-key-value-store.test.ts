import { describe, expect, it, vi } from 'vitest'

const storePlugin = vi.hoisted(() => ({
    load: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
    Store: { load: storePlugin.load },
}))

import { loadNativeKeyValueStore } from '@/platform/native-key-value-store'

describe('native key-value store adapter', () => {
    it('loads the requested store behind the structural persistence port', async () => {
        const store = {
            get: vi.fn(),
            set: vi.fn(),
            save: vi.fn(),
        }
        storePlugin.load.mockResolvedValue(store)

        await expect(loadNativeKeyValueStore('webview-settings.json')).resolves.toBe(store)
        expect(storePlugin.load).toHaveBeenCalledWith('webview-settings.json')
    })
})
