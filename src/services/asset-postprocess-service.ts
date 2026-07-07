import {
    ensureTaggerServer,
    LOCAL_TAGGER_BASE_URL,
} from '@/services/local-tagger-server'

export type AssetPostprocessSidecar = Record<string, unknown>

export interface AssetPostprocessRequest {
    image_base64: string
    mime: string
    output_path: string
    metadata_path: string
    sidecar: AssetPostprocessSidecar
    strip: boolean
    clean_blur_radius: number
}

export interface AssetPostprocessResult {
    success: boolean
    output_path: string
    metadata_path: string
    mime: string
    width: number
    height: number
    stripped: boolean
    blurred: boolean
    alpha_composited: boolean
}

const ASSET_POSTPROCESS_URL = `${LOCAL_TAGGER_BASE_URL}/asset/postprocess`

/**
 * Calls the deployment cleanup route registered by `src-tauri/python/tagger_server.py`.
 * The Python route writes the stripped image and matching `.nais2.json` sidecar
 * atomically, while this service owns only sidecar startup and HTTP marshalling.
 */
export async function postprocessAsset(
    request: AssetPostprocessRequest,
): Promise<AssetPostprocessResult> {
    await ensureTaggerServer()

    const response = await fetch(ASSET_POSTPROCESS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    })

    if (!response.ok) {
        const detail = await readPostprocessError(response)
        throw new Error(`Asset postprocess failed with HTTP ${response.status}: ${detail}`)
    }

    return await response.json() as AssetPostprocessResult
}

async function readPostprocessError(response: Response): Promise<string> {
    const text = await response.text()
    if (!text) {
        return 'empty response body'
    }

    try {
        const payload = JSON.parse(text) as { detail?: unknown }
        return formatErrorDetail(payload.detail) || text
    } catch {
        return text
    }
}

function formatErrorDetail(detail: unknown): string {
    if (typeof detail === 'string') {
        return detail
    }

    if (Array.isArray(detail)) {
        return detail.map(formatErrorDetail).filter(Boolean).join('; ')
    }

    if (hasValidationMessage(detail) && typeof detail.msg === 'string') {
        return detail.msg
    }

    if (detail && typeof detail === 'object') {
        return JSON.stringify(detail)
    }

    return ''
}

function hasValidationMessage(value: unknown): value is { msg: unknown } {
    return typeof value === 'object' && value !== null && 'msg' in value
}
