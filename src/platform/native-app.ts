import { getVersion, onBackButtonPress } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'

export interface NativeBackButtonListener {
    unregister(): Promise<void>
}

/** Returns the packaged app version without exposing Tauri app APIs to UI code. */
export async function getNativeAppVersion(): Promise<string> {
    return getVersion()
}

/**
 * Exits through the Rust command after persistence callers finish flushing.
 * Startup recovery and titlebar controls share this seam so Presentation never
 * owns Tauri command names or invocation details.
 */
export async function exitNativeApplication(): Promise<void> {
    await invoke('exit_app')
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
