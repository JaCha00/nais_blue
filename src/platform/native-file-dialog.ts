import {
    open,
    save,
    type OpenDialogOptions,
    type OpenDialogReturn,
    type SaveDialogOptions,
} from '@tauri-apps/plugin-dialog'

/**
 * Opens the OS file or directory picker through Tauri. The generic return type
 * preserves single versus multiple selection while Presentation depends only
 * on this platform seam.
 */
export async function openNativeFileDialog<T extends OpenDialogOptions>(
    options?: T,
): Promise<OpenDialogReturn<T>> {
    return open(options)
}

/**
 * Opens the OS save picker and returns the chosen native path. Export flows
 * share this adapter so dialog plugin changes remain isolated to platform code.
 */
export async function saveNativeFileDialog(options?: SaveDialogOptions): Promise<string | null> {
    return save(options)
}
