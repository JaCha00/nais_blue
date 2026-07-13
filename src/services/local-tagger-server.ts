import { invoke } from '@tauri-apps/api/core'
import {
    requireRuntimeCapability,
    runtimeCapabilities,
} from '@/platform/capabilities'

const supportsLocalTaggerSidecar = runtimeCapabilities.localTaggerSidecar.supported

export const LOCAL_TAGGER_BASE_URL = 'http://127.0.0.1:8002'

const HEALTH_URL = `${LOCAL_TAGGER_BASE_URL}/health`
const HEALTH_POLL_INTERVAL_MS = 500
const HEALTH_POLL_ATTEMPTS = 60
const HEALTH_REQUEST_TIMEOUT_MS = HEALTH_POLL_INTERVAL_MS

let startupPromise: Promise<void> | null = null

export function isLocalTaggerServerSupported(): boolean {
    return supportsLocalTaggerSidecar
}

/**
 * Ensures the Python FastAPI sidecar managed by `src-tauri/src/lib.rs` is ready.
 * This mirrors the legacy `smart-tools.ts` local server pattern while keeping
 * sidecar startup reusable for Danbooru verification and future local tools.
 */
export async function ensureTaggerServer(): Promise<void> {
    requireRuntimeCapability('localTaggerSidecar')

    if (await isTaggerServerHealthy()) {
        return
    }

    if (!startupPromise) {
        startupPromise = startAndWaitForTaggerServer().finally(() => {
            startupPromise = null
        })
    }

    await startupPromise
}

async function startAndWaitForTaggerServer(): Promise<void> {
    try {
        await invoke('start_tagger')
    } catch (error) {
        if (!(await isTaggerServerHealthy())) {
            throw new Error(`Failed to start local tagger server: ${getErrorMessage(error)}`)
        }
    }

    for (let attempt = 0; attempt < HEALTH_POLL_ATTEMPTS; attempt += 1) {
        const pollStartedAt = Date.now()
        if (await isTaggerServerHealthy()) {
            return
        }
        if (attempt < HEALTH_POLL_ATTEMPTS - 1) {
            await sleep(Math.max(0, HEALTH_POLL_INTERVAL_MS - (Date.now() - pollStartedAt)))
        }
    }

    throw new Error('Local tagger server did not become ready within 30 seconds')
}

async function isTaggerServerHealthy(): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS)

    try {
        const response = await fetch(HEALTH_URL, {
            method: 'GET',
            signal: controller.signal,
        })
        return response.ok
    } catch {
        return false
    } finally {
        window.clearTimeout(timeoutId)
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
