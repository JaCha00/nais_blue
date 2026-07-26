import { relaunch } from '@tauri-apps/plugin-process'

import { closeApplicationWithFlush } from '@/lib/indexed-db'
import { isMobileRuntime } from '@/platform/runtime'

/**
 * Desktop can spawn its executable again through Tauri. Mobile processes are
 * lifecycle-owned by the OS, so reloading WebView rehydrates restored stores
 * without terminating the activity and leaving the user on the launcher.
 */
async function restartRuntime(): Promise<void> {
    if (isMobileRuntime) {
        window.location.reload()
        return
    }
    await relaunch()
}

/** Flushes browser persistence and unloads the native vault before process recreation. */
export async function relaunchApplication(): Promise<void> {
    await closeApplicationWithFlush({ exit: restartRuntime })
}
