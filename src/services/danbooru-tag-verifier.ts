import {
    ensureTaggerServer,
    LOCAL_TAGGER_BASE_URL,
} from '@/services/local-tagger-server'
import { loadTags } from '@/lib/tag-data'

export type DanbooruTagStatus = 'OK' | 'LOW' | 'GHOST' | 'ERROR' | 'SKIPPED' | 'RENAMED'

export interface DanbooruSuggestion {
    name: string
    postCount: number
}

export interface DanbooruTagResult {
    raw: string
    normalized: string
    postCount: number | null
    exactMatch?: boolean | null
    status: DanbooruTagStatus
    suggestions: DanbooruSuggestion[]
    error: string | null
    recommended?: string | null
}

export interface DanbooruVerifyPromptResult {
    results: DanbooruTagResult[]
    source?: string
    asOf?: string
}

export interface DanbooruTagFrequency {
    raw: string
    postCount: number | null
    exactMatch: boolean
}

export interface DanbooruFrequencyLookupResult {
    frequencies: DanbooruTagFrequency[]
    source: string
    asOf: string | null
    fallbackCount: number
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

const BUNDLED_SNAPSHOT_SOURCE = 'NAI Blue bundled Danbooru snapshot'

/**
 * Resolves leaf prompt tags through the existing live verifier and fills only
 * failed lookups from the autocomplete snapshot. The UI therefore has one
 * lookup boundary while offline sessions still get a clearly labelled result.
 */
export async function lookupDanbooruTagFrequencies(
    rawTags: readonly string[],
): Promise<DanbooruFrequencyLookupResult> {
    if (rawTags.length === 0) {
        return {
            frequencies: [],
            source: BUNDLED_SNAPSHOT_SOURCE,
            asOf: null,
            fallbackCount: 0,
        }
    }

    let live: DanbooruVerifyPromptResult | null = null
    let liveError: unknown = null
    try {
        live = await verifyPromptTagsWithDanbooru(rawTags.join('\n'))
    } catch (error) {
        liveError = error
    }

    const needsSnapshot = live === null
        || live.results.length !== rawTags.length
        || live.results.some(result => result.status === 'ERROR' || result.status === 'RENAMED')
    const liveResultsAlign = live?.results.length === rawTags.length
    let snapshot: Map<string, number> | null = null
    if (needsSnapshot) {
        try {
            snapshot = await loadBundledFrequencySnapshot()
        } catch (snapshotError) {
            if (live === null) {
                throw new Error(
                    `Danbooru lookup and bundled fallback failed: ${errorMessage(liveError)}; ${errorMessage(snapshotError)}`,
                )
            }
        }
    }

    let fallbackCount = 0
    const frequencies = rawTags.map((raw, index): DanbooruTagFrequency => {
        const result = liveResultsAlign && live ? live.results[index] : undefined
        if (result && !['ERROR', 'RENAMED', 'SKIPPED'].includes(result.status)) {
            return {
                raw,
                postCount: result.postCount,
                exactMatch: result.exactMatch ?? result.status !== 'GHOST',
            }
        }

        if (snapshot) fallbackCount += 1
        const snapshotCount = snapshot?.get(normalizeLookupKey(raw))
        return {
            raw,
            postCount: snapshotCount ?? null,
            exactMatch: snapshotCount !== undefined,
        }
    })

    const liveSource = live?.source ?? 'Danbooru Tags API'
    return {
        frequencies,
        source: !snapshot
            ? liveSource
            : fallbackCount === rawTags.length
                ? BUNDLED_SNAPSHOT_SOURCE
                : `${liveSource} + ${BUNDLED_SNAPSHOT_SOURCE}`,
        asOf: live?.asOf ?? null,
        fallbackCount,
    }
}

let bundledFrequencySnapshotPromise: Promise<Map<string, number>> | null = null

function loadBundledFrequencySnapshot(): Promise<Map<string, number>> {
    if (!bundledFrequencySnapshotPromise) {
        bundledFrequencySnapshotPromise = loadTags().then(tags => {
            const index = new Map<string, number>()
            for (const tag of tags) {
                for (const candidate of [tag.label, tag.value, ...(tag.searchAliases ?? [])]) {
                    const key = normalizeLookupKey(candidate)
                    if (!key) continue
                    index.set(key, Math.max(index.get(key) ?? 0, tag.count))
                }
            }
            return index
        })
    }
    return bundledFrequencySnapshotPromise
}

function normalizeLookupKey(raw: string): string {
    let tag = raw.trim()
    let previous = ''
    while (tag !== previous) {
        previous = tag
        const weighted = tag.match(/^[+-]?\d+(?:\.\d+)?::([\s\S]*?)::$/)
        if (weighted) tag = weighted[1].trim()
    }

    tag = tag.replace(/[{}\[\]]/g, '').trim().toLowerCase()
    if (tag.startsWith('artist:')) tag = tag.slice('artist:'.length).trim()
    return tag.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
