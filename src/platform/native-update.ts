import { check } from '@tauri-apps/plugin-updater'

export type NativeUpdateDownloadEvent =
    | { event: 'Started'; data: { contentLength?: number } }
    | { event: 'Progress'; data: { chunkLength: number } }
    | { event: 'Finished' }

export interface NativeUpdate {
    version: string
    download(onEvent?: (event: NativeUpdateDownloadEvent) => void): Promise<void>
    install(): Promise<void>
    downloadAndInstall(onEvent?: (event: NativeUpdateDownloadEvent) => void): Promise<void>
}

/**
 * Checks the configured native updater endpoint and returns the minimal update
 * handle used by UI and state orchestration. Tauri's Resource subclass remains
 * contained here while download, install, and progress behavior stay intact.
 */
export async function checkForNativeUpdate(): Promise<NativeUpdate | null> {
    // The public version line restarted at 1.0.0 without resetting app data or
    // functionality. Existing 2.x installs therefore need one intentional
    // semver downgrade to enter the NAI Blue release line.
    return check({ allowDowngrades: true })
}
