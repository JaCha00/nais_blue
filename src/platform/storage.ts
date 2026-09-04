import {
    appCacheDir,
    appDataDir,
    cacheDir,
    documentDir,
    downloadDir,
    join,
    pictureDir,
    videoDir,
} from '@tauri-apps/api/path'
import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { isMobileRuntime } from './runtime'
import type { PortablePathRef, PortablePathRoot } from '@/domain/composition/types'

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

/** Materializes only the storage roots OutputWriter is allowed to publish into. */
export function resolveStorageBaseDirectoryRoot(baseDir: BaseDirectory): Promise<string> {
    switch (baseDir) {
        case BaseDirectory.AppData: return appDataDir()
        case BaseDirectory.AppCache: return appCacheDir()
        case BaseDirectory.Cache: return cacheDir()
        case BaseDirectory.Document: return documentDir()
        case BaseDirectory.Download: return downloadDir()
        case BaseDirectory.Picture: return pictureDir()
        case BaseDirectory.Video: return videoDir()
        default: return Promise.reject(new Error('Output base directory cannot be materialized'))
    }
}

/** Base directory mapping owned by the platform layer, shared by output/read adapters. */
export function getPortableStorageBaseDirectory(
    root: Extract<PortablePathRef, { kind: 'standard' }>['root'],
): BaseDirectory {
    switch (root) {
        case 'app-data': return BaseDirectory.AppData
        case 'documents': return BaseDirectory.Document
        case 'pictures': return BaseDirectory.Picture
        case 'downloads': return BaseDirectory.Download
        case 'media': return BaseDirectory.Video
        case 'cache': return BaseDirectory.Cache
    }
}

/**
 * OutputWriter projects completed media into portable ArtifactRecord facts, so it
 * must use the inverse of the read adapter's root-to-directory mapping here.
 * Keeping both directions in this platform boundary prevents desktop Picture
 * and Android app-data scopes from drifting when output recovery is replayed.
 */
export function getPortableStorageRoot(baseDir: BaseDirectory | undefined): PortablePathRoot | undefined {
    if (baseDir === undefined) return undefined
    switch (baseDir) {
        case BaseDirectory.AppData: return 'app-data'
        case BaseDirectory.Document: return 'documents'
        case BaseDirectory.Picture: return 'pictures'
        case BaseDirectory.Download: return 'downloads'
        case BaseDirectory.Video: return 'media'
        case BaseDirectory.Cache: return 'cache'
        default: return undefined
    }
}
