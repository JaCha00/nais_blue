export type RuntimePlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'unknown' | 'desktop' | 'web'

declare const __NAIS_BLUE_TAURI_PLATFORM__: string | undefined

export interface RuntimeCapability {
    readonly supported: boolean
    /** Human-readable explanation shown beside disabled platform features. */
    readonly reason?: string
    /** A safe workflow that is available on this platform. */
    readonly alternative?: string
}

export interface RuntimeCapabilities {
    readonly platform: RuntimePlatform
    readonly absoluteOutputPath: RuntimeCapability
    readonly externalProfileFileWatch: RuntimeCapability
    readonly localTaggerSidecar: RuntimeCapability
    readonly embeddedBrowser: RuntimeCapability
    readonly r2DeployTooling: RuntimeCapability
    readonly r2ProfileRead: RuntimeCapability
    readonly r2ForegroundUpload: RuntimeCapability
    readonly r2BackgroundUpload: RuntimeCapability
    readonly secureLanSyncTransport: RuntimeCapability
    readonly lanBlobTransfer: RuntimeCapability
    readonly embeddedPngMetadataWrite: RuntimeCapability
    readonly supportedImageFormats: readonly ('png' | 'webp')[]
}

const supported = (): RuntimeCapability => ({ supported: true })

const unsupported = (reason: string, alternative: string): RuntimeCapability => ({
    supported: false,
    reason,
    alternative,
})

const APP_SCOPED_OUTPUT = unsupported(
    'Android and iOS cannot write to arbitrary absolute desktop paths.',
    'Choose an app-data destination or grant access with the system file picker.',
)
const NO_EXTERNAL_WATCH = unsupported(
    'External profile file watching is unavailable in the mobile app sandbox.',
    'Import the profile explicitly, then refresh it from the system file picker.',
)
const NO_LOCAL_TAGGER = unsupported(
    'The desktop Python tagger sidecar is not bundled on mobile.',
    'Generate without local verification or verify tags on the desktop app.',
)
const NO_EMBEDDED_BROWSER = unsupported(
    'The desktop embedded browser view is unavailable on mobile.',
    'Open the page in the system browser and return to NAIS blue when finished.',
)
const NO_R2_TOOLING = unsupported(
    'R2 deploy tooling requires the desktop sidecar and local Wrangler environment.',
    'Export locally and deploy from the desktop app or Wrangler CLI.',
)
const NO_NATIVE_R2_FOREGROUND = unsupported(
    'Native foreground R2 upload is not enabled in this mobile build.',
    'Review the saved profile on mobile, then upload from the desktop app.',
)
const NO_NATIVE_R2_HOST = unsupported(
    'Native foreground R2 upload requires a supported desktop Tauri build.',
    'Use Wrangler on a desktop host or open the installed Windows, macOS, or Linux app.',
)
const NO_NATIVE_R2_BACKGROUND = unsupported(
    'Background R2 upload workers are not part of the current capability set.',
    'Keep the desktop app open for foreground upload or wait for the background-worker phase.',
)
const NO_SECURE_LAN_SYNC_CUTOVER = unsupported(
    'Secure LAN sync transport is not enabled as a production source/outbox workflow yet.',
    'Keep local-first sync data on this device until the explicit pairing and recovery gate is complete.',
)
const NO_LAN_BLOB_TRANSFER = unsupported(
    'Resumable LAN image transfer is not enabled in this build.',
    'Synchronize the succeeded R2 object reference and transfer image bytes through the existing R2 workflow.',
)

/**
 * Deterministic platform matrix. Keep platform behavior here rather than placing
 * platform conditionals in the Composition Domain.
 */
export function createRuntimeCapabilities(platform: RuntimePlatform): RuntimeCapabilities {
    const mobile = platform === 'android' || platform === 'ios'
    const nativeR2Desktop = platform === 'windows' || platform === 'macos' || platform === 'linux' || platform === 'desktop'

    return Object.freeze({
        platform,
        absoluteOutputPath: mobile ? APP_SCOPED_OUTPUT : supported(),
        externalProfileFileWatch: mobile ? NO_EXTERNAL_WATCH : supported(),
        localTaggerSidecar: mobile ? NO_LOCAL_TAGGER : supported(),
        embeddedBrowser: mobile ? NO_EMBEDDED_BROWSER : supported(),
        r2DeployTooling: mobile ? NO_R2_TOOLING : supported(),
        r2ProfileRead: supported(),
        r2ForegroundUpload: mobile ? NO_NATIVE_R2_FOREGROUND : nativeR2Desktop ? supported() : NO_NATIVE_R2_HOST,
        r2BackgroundUpload: NO_NATIVE_R2_BACKGROUND,
        // These remain false until source/outbox and native temp-file executors
        // close their respective interruption gates without bypassing this matrix.
        secureLanSyncTransport: NO_SECURE_LAN_SYNC_CUTOVER,
        lanBlobTransfer: NO_LAN_BLOB_TRANSFER,
        // PNG metadata insertion is a byte-level TypeScript adapter and works on
        // both desktop and Android; it does not depend on a native image library.
        embeddedPngMetadataWrite: supported(),
        supportedImageFormats: Object.freeze(['png', 'webp'] as const),
    })
}

// Loaded lazily to avoid a runtime.ts -> capabilities.ts cycle. runtime.ts only
// re-exports compatibility booleans after this value has been constructed.
const detectedPlatform = (() => {
    const configured = typeof __NAIS_BLUE_TAURI_PLATFORM__ === 'string'
        ? __NAIS_BLUE_TAURI_PLATFORM__.toLowerCase()
        : ''
    if (configured === 'android' || configured === 'ios' || configured === 'windows'
        || configured === 'macos' || configured === 'linux') return configured
    if (typeof navigator !== 'undefined') {
        const agent = navigator.userAgent.toLowerCase()
        if (agent.includes('android')) return 'android'
        if (/iphone|ipad|ipod/.test(agent)) return 'ios'
    }
    return 'unknown'
})() satisfies RuntimePlatform

export const runtimeCapabilities: RuntimeCapabilities = createRuntimeCapabilities(detectedPlatform)

export function requireRuntimeCapability(
    capabilityName: keyof Omit<RuntimeCapabilities, 'platform' | 'supportedImageFormats'>,
    capabilities: RuntimeCapabilities = runtimeCapabilities,
): void {
    const capability = capabilities[capabilityName]
    if (capability.supported) return
    throw new UnsupportedRuntimeCapabilityError(capabilityName, capability)
}

export class UnsupportedRuntimeCapabilityError extends Error {
    constructor(
        readonly capabilityName: keyof Omit<RuntimeCapabilities, 'platform' | 'supportedImageFormats'>,
        readonly capability: RuntimeCapability,
    ) {
        super(`${capability.reason ?? `${capabilityName} is unsupported`} ${capability.alternative ?? ''}`.trim())
        this.name = 'UnsupportedRuntimeCapabilityError'
    }
}
