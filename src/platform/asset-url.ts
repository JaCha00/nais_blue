import { convertFileSrc } from '@tauri-apps/api/core'

/**
 * Converts a native file path through Tauri's asset protocol. Presentation
 * modules depend on this adapter instead of the native API, keeping protocol
 * ownership in the platform layer while preserving zero-copy image loading.
 */
export function toNativeAssetUrl(filePath: string): string {
    return convertFileSrc(filePath)
}
