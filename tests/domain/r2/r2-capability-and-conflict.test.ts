import { describe, expect, it } from 'vitest'

import { deterministicR2Suffix } from '@/domain/r2/types'
import { createRuntimeCapabilities } from '@/platform/capabilities'

describe('R2 platform and conflict contracts', () => {
    it('keeps profiles readable on mobile while foreground and background upload stay explicit', () => {
        const android = createRuntimeCapabilities('android')
        expect(android.r2ProfileRead.supported).toBe(true)
        expect(android.r2ForegroundUpload).toMatchObject({ supported: false })
        expect(android.r2ForegroundUpload.reason).toContain('mobile')
        expect(android.r2BackgroundUpload.supported).toBe(false)

        const desktop = createRuntimeCapabilities('windows')
        expect(desktop.r2ProfileRead.supported).toBe(true)
        expect(desktop.r2ForegroundUpload.supported).toBe(true)
        expect(desktop.r2BackgroundUpload.supported).toBe(false)

        expect(createRuntimeCapabilities('web').r2ForegroundUpload).toMatchObject({ supported: false })
        expect(createRuntimeCapabilities('unknown').r2ForegroundUpload).toMatchObject({ supported: false })
    })

    it('derives a stable suffix without changing the extension', () => {
        const hash = `sha256:${'abcdef0123456789'.repeat(4)}`
        expect(deterministicR2Suffix('nested/image.png', hash)).toBe('nested/image-abcdef012345.png')
        expect(deterministicR2Suffix('nested/image.png', hash)).toBe('nested/image-abcdef012345.png')
    })
})
