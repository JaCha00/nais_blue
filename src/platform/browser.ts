import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { runtimeCapabilities } from '@/platform/capabilities'

const supportsEmbeddedBrowser = runtimeCapabilities.embeddedBrowser.supported

export interface BrowserRect {
    x: number
    y: number
    width: number
    height: number
}

export type BrowserOpenTarget = 'embedded' | 'external'

export async function openBrowserView(url: string, rect: BrowserRect): Promise<BrowserOpenTarget> {
    if (!supportsEmbeddedBrowser) {
        await openExternalUrl(url)
        return 'external'
    }

    await invoke('open_embedded_browser', {
        url,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    })
    return 'embedded'
}

export async function closeBrowserView(): Promise<void> {
    if (!supportsEmbeddedBrowser) return
    await invoke('close_embedded_browser')
}

export async function navigateBrowserView(url: string): Promise<BrowserOpenTarget> {
    if (!supportsEmbeddedBrowser) {
        await openExternalUrl(url)
        return 'external'
    }

    await invoke('navigate_embedded_browser', { url })
    return 'embedded'
}

export async function resizeBrowserView(rect: BrowserRect): Promise<void> {
    if (!supportsEmbeddedBrowser) return
    await invoke('resize_embedded_browser', {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    })
}

export async function hideBrowserView(): Promise<void> {
    if (!supportsEmbeddedBrowser) return
    await invoke('hide_embedded_browser')
}

export async function showBrowserView(): Promise<void> {
    if (!supportsEmbeddedBrowser) return
    await invoke('show_embedded_browser')
}

export async function zoomBrowserView(zoomLevel: number): Promise<void> {
    if (!supportsEmbeddedBrowser) return
    await invoke('zoom_embedded_browser', { zoomLevel })
}

export async function isBrowserViewOpen(): Promise<boolean> {
    if (!supportsEmbeddedBrowser) return false
    return await invoke<boolean>('is_browser_open')
}

export async function openExternalUrl(url: string): Promise<void> {
    await openUrl(url)
}
