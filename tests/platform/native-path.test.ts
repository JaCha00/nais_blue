import { beforeEach, describe, expect, it, vi } from 'vitest'

const pathApi = vi.hoisted(() => ({
    join: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => pathApi)

import { joinNativePath } from '@/platform/native-path'

describe('native path adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('forwards every segment and returns the platform path', async () => {
        pathApi.join.mockResolvedValue('C:\\NAIS\\Output\\image.png')

        await expect(joinNativePath('C:\\NAIS', 'Output', 'image.png'))
            .resolves.toBe('C:\\NAIS\\Output\\image.png')
        expect(pathApi.join).toHaveBeenCalledWith('C:\\NAIS', 'Output', 'image.png')
    })
})
