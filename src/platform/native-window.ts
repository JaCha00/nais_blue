import { getCurrentWindow } from '@tauri-apps/api/window'

import {
    runtimeCapabilities,
    type RuntimeCapabilities,
} from '@/platform/capabilities'

/** Window operations consumed by the desktop titlebar without Tauri types. */
export interface NativeWindowController {
    isMaximized(): Promise<boolean>
    onResized(handler: () => void): Promise<() => void>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    startDragging(): Promise<void>
}

/**
 * Resolves the current native window only when the configured runtime exposes
 * Tauri plugins. The titlebar can therefore stay inert in browser QA while all
 * native window ownership remains in this adapter.
 */
export function getNativeWindowController(
    capabilities: RuntimeCapabilities = runtimeCapabilities,
): NativeWindowController | null {
    if (!capabilities.nativePluginRuntime.supported) return null
    return getCurrentWindow()
}
