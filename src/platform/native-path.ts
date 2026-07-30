import { join } from '@tauri-apps/api/path'

/**
 * Joins native path segments with the platform-specific separator. Filesystem
 * consumers use this seam so Tauri path semantics remain owned by platform
 * code while callers retain the API's asynchronous result.
 */
export async function joinNativePath(...segments: string[]): Promise<string> {
    return join(...segments)
}
