import { beforeEach, describe, expect, it, vi } from 'vitest'

const opener = vi.hoisted(() => ({
    openPath: vi.fn(),
    revealItemInDir: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => opener)

import { openNativePath, revealNativeItem } from '@/platform/native-shell'

describe('native shell adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('forwards file and directory opening to the native plugin', async () => {
        await openNativePath('C:\\NAIS\\Output')

        expect(opener.openPath).toHaveBeenCalledWith('C:\\NAIS\\Output')
    })

    it('forwards item reveal without changing its path', async () => {
        await revealNativeItem('C:\\NAIS\\Output\\image.png')

        expect(opener.revealItemInDir).toHaveBeenCalledWith('C:\\NAIS\\Output\\image.png')
    })
})
