import {
    ensureTaggerServer,
    LOCAL_TAGGER_BASE_URL,
} from '@/services/local-tagger-server'

export interface AssetPlanPreviewRequest {
    profilePath: string
    recipeId?: string
    seed?: number
    outputDirectory?: string
}

export interface AssetPlanPreviewResponse {
    ok: boolean
    finalPrompt: string
    negativePrompt: string
    fileName: string
    warnings: string[]
}

const ASSET_PLAN_PREVIEW_URL = `${LOCAL_TAGGER_BASE_URL}/asset/plan/preview`

/**
 * Runs the Python preview endpoint for agent self-correction after an external
 * edit to asset-profile.json. This service only marshals the request; the live
 * Studio preview still uses the TS resolver for instant GUI feedback.
 */
export async function previewAssetPlanFromDisk(
    request: AssetPlanPreviewRequest,
): Promise<AssetPlanPreviewResponse> {
    await ensureTaggerServer()

    const response = await fetch(ASSET_PLAN_PREVIEW_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
    })

    if (!response.ok) {
        throw new Error(`Asset plan preview failed with HTTP ${response.status}: ${await readPreviewError(response)}`)
    }

    return await response.json() as AssetPlanPreviewResponse
}

async function readPreviewError(response: Response): Promise<string> {
    const text = await response.text()
    if (!text) return 'empty response body'

    try {
        const payload = JSON.parse(text) as { detail?: unknown }
        return typeof payload.detail === 'string' ? payload.detail : text
    } catch {
        return text
    }
}
