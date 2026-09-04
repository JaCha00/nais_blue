import {
    getIndexedDBItemStrict,
    SCENE_OUTPUT_PORTABLE_TOKEN_STORE_KEY,
    setIndexedDBItemStrict,
} from '@/lib/indexed-db'
import { runtimeCapabilities } from '@/platform/capabilities'
import {
    runtimePortablePathTokenRegistry,
    type PlatformTokenRecord,
} from '@/platform/portable-resources'

interface SceneOutputPortableTokenDocument {
    readonly schemaVersion: 1
    readonly tokens: readonly PlatformTokenRecord[]
}

let mutationQueue: Promise<void> = Promise.resolve()

function parseDocument(raw: string | null): SceneOutputPortableTokenDocument {
    if (raw === null) return { schemaVersion: 1, tokens: [] }
    const value = JSON.parse(raw) as Partial<SceneOutputPortableTokenDocument>
    if (value.schemaVersion !== 1 || !Array.isArray(value.tokens)) {
        throw new Error('Scene output portable token store is invalid')
    }
    const tokens = value.tokens.map(token => {
        if (typeof token?.logicalId !== 'string'
            || typeof token.platform !== 'string'
            || token.kind !== 'directory'
            || typeof token.opaqueToken !== 'string'
            || typeof token.displayPath !== 'string') {
            throw new Error('Scene output portable token record is invalid')
        }
        return { ...token }
    })
    return { schemaVersion: 1, tokens }
}

async function stableBookmarkId(directory: string): Promise<string> {
    const bytes = new TextEncoder().encode(`${runtimeCapabilities.platform}\0${directory}`)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const suffix = [...digest].map(value => value.toString(16).padStart(2, '0')).join('')
    return `scene-output:immutable:${suffix}`
}

/**
 * Binds one immutable logical ID to a creation-time output root. Identical
 * roots dedupe, while the raw token remains local and never enters Artifact/Scene authority.
 */
export async function bindDurableSceneOutputDirectory(
    directory: string,
): Promise<string> {
    const root = directory.trim()
    if (!root) throw new Error('Scene output bookmark requires a directory')
    const logicalId = await stableBookmarkId(root)
    const record: PlatformTokenRecord = {
        logicalId,
        platform: runtimeCapabilities.platform,
        kind: 'directory',
        opaqueToken: root,
        displayPath: root,
    }
    const result = mutationQueue.then(async () => {
        const current = parseDocument(await getIndexedDBItemStrict(SCENE_OUTPUT_PORTABLE_TOKEN_STORE_KEY))
        const existing = current.tokens.find(token => token.logicalId === logicalId)
        if (existing !== undefined) {
            if (existing.platform !== record.platform
                || existing.kind !== record.kind
                || existing.opaqueToken !== record.opaqueToken) {
                throw new Error('Scene output bookmark is already bound to a different directory')
            }
            runtimePortablePathTokenRegistry.register(existing)
            return
        }
        const next: SceneOutputPortableTokenDocument = {
            schemaVersion: 1,
            tokens: [...current.tokens, record],
        }
        await setIndexedDBItemStrict(SCENE_OUTPUT_PORTABLE_TOKEN_STORE_KEY, JSON.stringify(next))
        runtimePortablePathTokenRegistry.register(record)
    })
    mutationQueue = result.catch(() => undefined)
    await result
    return logicalId
}

/** Restores creation-time bookmarks before ArtifactRecord paths are materialized. */
export async function hydrateDurableSceneOutputDirectories(): Promise<number> {
    await mutationQueue
    const document = parseDocument(await getIndexedDBItemStrict(SCENE_OUTPUT_PORTABLE_TOKEN_STORE_KEY))
    document.tokens.forEach(token => runtimePortablePathTokenRegistry.register(token))
    return document.tokens.length
}
