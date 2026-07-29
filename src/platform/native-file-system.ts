import {
    exists,
    mkdir,
    readFile,
    readDir,
    readTextFile,
    rename,
    writeFile,
    writeTextFile,
    type BaseDirectory,
} from '@tauri-apps/plugin-fs'

export interface NativePathOptions {
    baseDir?: BaseDirectory
}

export interface NativeDirectoryCreateOptions extends NativePathOptions {
    recursive?: boolean
}

/** Directory facts consumed by Presentation scanners without exposing Tauri types. */
export interface NativeDirectoryEntry {
    name: string
    isDirectory: boolean
    isFile: boolean
    isSymlink: boolean
}

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
export async function writeNativeBinaryFile(
    path: string,
    content: Uint8Array,
    options?: NativePathOptions,
): Promise<void> {
    return writeFile(path, content, options)
}

/**
 * Reads binary content through Tauri's filesystem plugin. Image metadata,
 * clipboard, and export flows consume the bytes without importing native I/O.
 */
export async function readNativeBinaryFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
    return readFile(path)
}

/**
 * Checks a native path with an optional scoped base directory. Library and
 * output flows use this before writes while Tauri path semantics stay isolated.
 */
export async function nativePathExists(path: string, options?: NativePathOptions): Promise<boolean> {
    return exists(path, options)
}

/**
 * Creates a native directory with optional scope and recursive behavior. Media
 * flows retain their existing path policy while this adapter owns Tauri mkdir.
 */
export async function createNativeDirectory(
    path: string,
    options?: NativeDirectoryCreateOptions,
): Promise<void> {
    return mkdir(path, options)
}

/**
 * Lists a native directory within an optional base-directory scope. History
 * and scene discovery consume structural entries while Tauri remains isolated.
 */
export async function readNativeDirectory(
    path: string,
    options?: NativePathOptions,
): Promise<NativeDirectoryEntry[]> {
    return readDir(path, options)
}

/**
 * Renames or moves an absolute native path. Scene folder migration decides the
 * source and destination, while this adapter owns the filesystem operation.
 */
export async function renameNativePath(oldPath: string, newPath: string): Promise<void> {
    return rename(oldPath, newPath)
}
