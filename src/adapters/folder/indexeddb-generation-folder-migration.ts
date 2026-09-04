import {
    FOLDER_AUTHORITY_MARKER_STORE_KEY,
    FOLDER_V1_PREIMAGE_STORE_KEY,
    compareAndSetIndexedDBItem,
    getIndexedDBItemStrict,
    setIndexedDBItemStrict,
} from '@/lib/indexed-db'

const LEGACY_SETTINGS_STORE_KEY = 'nai-blue-settings'

export interface GenerationFolderAuthorityMarker {
    readonly reader: 'v1' | 'v2'
    readonly verifiedAt?: string
}

function isMarker(value: unknown): value is GenerationFolderAuthorityMarker {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const marker = value as Record<string, unknown>
    return Object.keys(marker).every(key => key === 'reader' || key === 'verifiedAt')
        && (marker.reader === 'v1' || marker.reader === 'v2')
        && (marker.verifiedAt === undefined
            || (typeof marker.verifiedAt === 'string' && Number.isFinite(Date.parse(marker.verifiedAt))))
}

/** Captures the exact settings envelope once before Zustand can write a projection. */
export async function preserveGenerationFolderV1Preimage(): Promise<string | null> {
    const preserved = await getIndexedDBItemStrict(FOLDER_V1_PREIMAGE_STORE_KEY)
    if (preserved !== null) return preserved
    const current = await getIndexedDBItemStrict(LEGACY_SETTINGS_STORE_KEY)
    if (current === null) return null
    if (await compareAndSetIndexedDBItem(FOLDER_V1_PREIMAGE_STORE_KEY, null, current)) return current
    return getIndexedDBItemStrict(FOLDER_V1_PREIMAGE_STORE_KEY)
}

export async function readGenerationFolderAuthorityMarker(): Promise<GenerationFolderAuthorityMarker | null> {
    const serialized = await getIndexedDBItemStrict(FOLDER_AUTHORITY_MARKER_STORE_KEY)
    if (serialized === null) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(serialized) as unknown
    } catch {
        throw new TypeError('Generation folder authority marker is invalid')
    }
    if (!isMarker(parsed)) throw new TypeError('Generation folder authority marker is invalid')
    return structuredClone(parsed)
}

export async function writeGenerationFolderAuthorityMarker(
    marker: GenerationFolderAuthorityMarker,
): Promise<void> {
    if (!isMarker(marker)) throw new TypeError('Generation folder authority marker is invalid')
    await setIndexedDBItemStrict(FOLDER_AUTHORITY_MARKER_STORE_KEY, JSON.stringify(marker))
}
