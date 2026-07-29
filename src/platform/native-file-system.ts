import { readFile, readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'

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

/**
 * Writes binary output through Tauri's filesystem plugin. Image tools and scene
 * export produce bytes in Presentation, while this adapter owns native storage.
 */
export async function writeNativeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    return writeFile(path, content)
}

/**
 * Reads binary content through Tauri's filesystem plugin. Image metadata,
 * clipboard, and export flows consume the bytes without importing native I/O.
 */
export async function readNativeBinaryFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
    return readFile(path)
}
