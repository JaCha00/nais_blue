import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRuntimeCapabilities } from '@/platform/capabilities'

const windowApi = vi.hoisted(() => ({
    getCurrentWindow: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => windowApi)

import { getNativeWindowController } from '@/platform/native-window'

describe('native window adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('returns the current window for a native runtime', () => {
        const controller = {
            isMaximized: vi.fn(),
            onResized: vi.fn(),
            minimize: vi.fn(),
            toggleMaximize: vi.fn(),
            startDragging: vi.fn(),
        }
        windowApi.getCurrentWindow.mockReturnValue(controller)

        expect(getNativeWindowController(createRuntimeCapabilities('windows'))).toBe(controller)
        expect(windowApi.getCurrentWindow).toHaveBeenCalledOnce()
    })

    it('stays inert when browser capabilities have no native plugin runtime', () => {
        expect(getNativeWindowController(createRuntimeCapabilities('web'))).toBeNull()
        expect(windowApi.getCurrentWindow).not.toHaveBeenCalled()
    })
})
