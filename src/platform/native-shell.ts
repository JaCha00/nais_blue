import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'

/**
 * Opens a native file or directory through the OS shell. UI actions call this
 * platform seam so Tauri plugin ownership stays outside presentation modules.
 */
export async function openNativePath(path: string): Promise<void> {
    await openPath(path)
}

/**
 * Reveals a native item in its parent file manager. Context menus share this
 * adapter to keep the plugin contract replaceable without changing UI flows.
 */
export async function revealNativeItem(path: string): Promise<void> {
    await revealItemInDir(path)
}
