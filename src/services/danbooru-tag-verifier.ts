import {
    ensureTaggerServer,
    LOCAL_TAGGER_BASE_URL,
} from '@/services/local-tagger-server'

export type DanbooruTagStatus = 'OK' | 'LOW' | 'GHOST' | 'ERROR' | 'SKIPPED'

export interface DanbooruSuggestion {
    name: string
    postCount: number
}

export interface DanbooruTagResult {
    raw: string
    normalized: string
    postCount: number | null
    status: DanbooruTagStatus
    suggestions: DanbooruSuggestion[]
    error: string | null
}

export interface DanbooruVerifyPromptResult {
    results: DanbooruTagResult[]
}

export interface DanbooruVerifyPromptOptions {
    okThreshold?: number
    fuzzyLimit?: number
}

const VERIFY_PROMPT_URL = `${LOCAL_TAGGER_BASE_URL}/danbooru/verify-prompt`

/**
 * Calls the Danbooru verification endpoint added to `src-tauri/python/tagger_server.py`.
 * The sidecar is started through `ensureTaggerServer()` first so UI callers can
 * use this service without duplicating Tauri command or health polling logic.
 */
export async function verifyPromptTagsWithDanbooru(
    prompt: string,
    options: DanbooruVerifyPromptOptions = {},
): Promise<DanbooruVerifyPromptResult> {
    await ensureTaggerServer()

    const response = await fetch(VERIFY_PROMPT_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            prompt,
            ok_threshold: options.okThreshold ?? 100,
            fuzzy_limit: options.fuzzyLimit ?? 5,
        }),
    })

    if (!response.ok) {
        throw new Error(`Danbooru tag verification failed with HTTP ${response.status}`)
    }

    return await response.json() as DanbooruVerifyPromptResult
}
