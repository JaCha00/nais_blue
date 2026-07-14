import { relaunch } from '@tauri-apps/plugin-process'

import { closeApplicationWithFlush } from '@/lib/indexed-db'

/** Flushes browser persistence and unloads the native vault before process recreation. */
export async function relaunchApplication(): Promise<void> {
    await closeApplicationWithFlush({ exit: relaunch })
}
