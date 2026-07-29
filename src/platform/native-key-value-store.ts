import { Store } from '@tauri-apps/plugin-store'

export interface NativeKeyValueStore {
    get<T>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    save(): Promise<void>
}

/**
 * Loads a Tauri-backed key-value file and exposes only the operations consumed
 * by UI persistence. The structural port keeps the native Store class and its
 * resource lifecycle from leaking into Presentation types.
 */
export async function loadNativeKeyValueStore(path: string): Promise<NativeKeyValueStore> {
    return Store.load(path)
}
