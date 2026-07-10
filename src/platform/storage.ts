import { appDataDir, join, pictureDir } from '@tauri-apps/api/path'
import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { isMobileRuntime } from './runtime'

// All persisted media paths flow through this adapter so capability scopes and
// path resolution cannot disagree between the desktop and mobile runtimes.
export const MEDIA_STORAGE_BASE_DIRECTORY = isMobileRuntime
    ? BaseDirectory.AppData
    : BaseDirectory.Picture

export function getMediaStorageRoot(): Promise<string> {
    return isMobileRuntime ? appDataDir() : pictureDir()
}

export function shouldUseAbsoluteMediaPath(requested: boolean): boolean {
    return requested && !isMobileRuntime
}

export async function resolveMediaStoragePath(...segments: string[]): Promise<string> {
    return join(await getMediaStorageRoot(), ...segments)
}
