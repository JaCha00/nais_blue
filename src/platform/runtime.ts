export type NaisRuntimePlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'unknown'

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

export const supportsEmbeddedBrowser = !isMobileRuntime
export const supportsLocalTaggerSidecar = !isMobileRuntime
export const supportsKeyboardShortcuts = !isMobileRuntime

export function getRuntimePlatform(): NaisRuntimePlatform {
    return runtimePlatform
}
