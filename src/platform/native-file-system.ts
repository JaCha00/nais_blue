import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

/**
 * Reads UTF-8 text through Tauri's filesystem plugin. Import and backup flows
 * depend on this seam so Presentation receives content without owning native I/O.
 */
export async function readNativeTextFile(path: string): Promise<string> {
    return readTextFile(path)
}

/**
 * Writes UTF-8 text through Tauri's filesystem plugin. Export flows provide the
 * selected path and content, while this adapter contains the native dependency.
 */
export async function writeNativeTextFile(path: string, content: string): Promise<void> {
    return writeTextFile(path, content)
}
