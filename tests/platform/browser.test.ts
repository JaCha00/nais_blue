import { beforeEach, describe, expect, it, vi } from 'vitest'

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }))

vi.mock('@tauri-apps/plugin-opener', () => opener)
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@/platform/capabilities', () => ({
    runtimeCapabilities: {
        embeddedBrowser: { supported: false },
        nativePluginRuntime: { supported: true },
    },
}))

import { openExternalUrl } from '@/platform/browser'

describe('external URL adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('opens external links through the Tauri opener in an installed app', async () => {
        await openExternalUrl('https://dash.cloudflare.com/')

        expect(opener.openUrl).toHaveBeenCalledOnce()
        expect(opener.openUrl).toHaveBeenCalledWith('https://dash.cloudflare.com/')
    })
})
