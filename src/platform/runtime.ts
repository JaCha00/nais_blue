import { runtimeCapabilities, type RuntimePlatform } from './capabilities'

export type NaisRuntimePlatform = Exclude<RuntimePlatform, 'desktop' | 'web'>

function normalizePlatform(value: RuntimePlatform): NaisRuntimePlatform {
    if (value === 'android') return 'android'
    if (value === 'ios') return 'ios'
    if (value === 'windows') return 'windows'
    if (value === 'macos') return 'macos'
    if (value === 'linux') return 'linux'
    return 'unknown'
}

export const runtimePlatform = normalizePlatform(runtimeCapabilities.platform)
export const isAndroidRuntime = runtimePlatform === 'android'
export const isMobileRuntime = runtimePlatform === 'android' || runtimePlatform === 'ios'
export const isDesktopRuntime = runtimeCapabilities.platform === 'desktop'
    || runtimePlatform === 'windows'
    || runtimePlatform === 'macos'
    || runtimePlatform === 'linux'

// Compatibility exports for call sites that only need a boolean. New UI should
// consume the full capability object so unsupported reasons are visible.
export { runtimeCapabilities }

export const supportsEmbeddedBrowser = runtimeCapabilities.embeddedBrowser.supported
export const supportsLocalTaggerSidecar = runtimeCapabilities.localTaggerSidecar.supported
export const supportsKeyboardShortcuts = !isMobileRuntime

export function getRuntimePlatform(): NaisRuntimePlatform {
    return runtimePlatform
}
