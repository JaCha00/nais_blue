import { beforeEach, describe, expect, it, vi } from 'vitest'

const appApi = vi.hoisted(() => ({
    getVersion: vi.fn(),
    onBackButtonPress: vi.fn(),
}))

vi.mock('@tauri-apps/api/app', () => appApi)

import { getNativeAppVersion, registerNativeBackButton } from '@/platform/native-app'

describe('native app adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns the packaged application version', async () => {
        appApi.getVersion.mockResolvedValue('2.11.2')

        await expect(getNativeAppVersion()).resolves.toBe('2.11.2')
    })

    it('registers the native Back handler and returns its listener', async () => {
        const handler = vi.fn()
        const listener = { unregister: vi.fn() }
        appApi.onBackButtonPress.mockResolvedValue(listener)

        await expect(registerNativeBackButton(handler)).resolves.toBe(listener)
        expect(appApi.onBackButtonPress).toHaveBeenCalledWith(handler)
    })
})
