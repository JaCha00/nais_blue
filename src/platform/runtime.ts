import type { RuntimePlatform } from './capabilities'

export type NaisRuntimePlatform = Exclude<RuntimePlatform, 'desktop' | 'web'>

declare const __NAIS2_TAURI_PLATFORM__: string | undefined

const buildPlatform = typeof __NAIS2_TAURI_PLATFORM__ === 'string'
    ? __NAIS2_TAURI_PLATFORM__.toLowerCase()
    : ''

const userAgent = typeof navigator === 'undefined'
    ? ''
    : navigator.userAgent.toLowerCase()

function normalizePlatform(value: string): NaisRuntimePlatform {
    if (value === 'android') return 'android'
    if (value === 'ios') return 'ios'
    if (value === 'windows') return 'windows'
    if (value === 'macos') return 'macos'
    if (value === 'linux') return 'linux'
    if (userAgent.includes('android')) return 'android'
    if (/iphone|ipad|ipod/.test(userAgent)) return 'ios'
    return 'unknown'
}

export const runtimePlatform = normalizePlatform(buildPlatform)
export const isAndroidRuntime = runtimePlatform === 'android'
export const isMobileRuntime = runtimePlatform === 'android' || runtimePlatform === 'ios'

// Compatibility exports for call sites that only need a boolean. New UI should
// consume the full capability object so unsupported reasons are visible.
export { runtimeCapabilities } from './capabilities'
import { runtimeCapabilities } from './capabilities'

export const supportsEmbeddedBrowser = runtimeCapabilities.embeddedBrowser.supported
export const supportsLocalTaggerSidecar = runtimeCapabilities.localTaggerSidecar.supported
export const supportsKeyboardShortcuts = !isMobileRuntime

export function getRuntimePlatform(): NaisRuntimePlatform {
    return runtimePlatform
}
