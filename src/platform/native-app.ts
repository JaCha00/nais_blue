import { getVersion, onBackButtonPress } from '@tauri-apps/api/app'

export interface NativeBackButtonListener {
    unregister(): Promise<void>
}

/** Returns the packaged app version without exposing Tauri app APIs to UI code. */
export async function getNativeAppVersion(): Promise<string> {
    return getVersion()
}

/**
 * Registers an Android Back callback and returns its disposable listener. The
 * layout owns when to subscribe, while this adapter owns the native app event.
 */
export async function registerNativeBackButton(
    handler: () => void,
): Promise<NativeBackButtonListener> {
    return onBackButtonPress(handler)
}
