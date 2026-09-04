import type {
    SceneAuthorityMarker,
    SceneAuthorityMarkerPersistence,
    SceneLegacyPreimagePersistence,
} from '@/lib/scene-migration-startup'
import type { SceneV1CompatibilityProjection } from '@/application/scene/scene-repository'
import { projectSceneV1Preimage } from '@/adapters/scene/indexeddb-scene-repository'
import {
    SCENE_AUTHORITY_MARKER_STORE_KEY,
    getIndexedDBItemStrict,
    setIndexedDBItemStrict,
} from '@/lib/indexed-db'

const LEGACY_SCENE_STORE_KEY = 'nai-blue-scenes'

function isMarker(value: unknown): value is SceneAuthorityMarker {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const marker = value as Record<string, unknown>
    return Object.keys(marker).every(key => ['reader', 'v1Preimage', 'verifiedAt'].includes(key))
        && (marker.reader === 'v1' || marker.reader === 'v2')
        && typeof marker.v1Preimage === 'string'
        && (marker.verifiedAt === undefined
            || (typeof marker.verifiedAt === 'string' && Number.isFinite(Date.parse(marker.verifiedAt))))
}

/** Persists only authority selection; the captured V1 bytes remain immutable. */
export class IndexedDbSceneMigrationPersistence
implements SceneAuthorityMarkerPersistence, SceneLegacyPreimagePersistence {
    async readSerialized(): Promise<string | null> {
        return getIndexedDBItemStrict(LEGACY_SCENE_STORE_KEY)
    }

    async read(): Promise<SceneAuthorityMarker | null> {
        const serialized = await getIndexedDBItemStrict(SCENE_AUTHORITY_MARKER_STORE_KEY)
        if (serialized === null) return null
        let parsed: unknown
        try {
            parsed = JSON.parse(serialized) as unknown
        } catch {
            throw new TypeError('Scene authority marker is invalid')
        }
        if (!isMarker(parsed)) throw new TypeError('Scene authority marker is invalid')
        return structuredClone(parsed)
    }

    async readPreservedProjection(): Promise<SceneV1CompatibilityProjection | null> {
        const marker = await this.read()
        return marker === null || marker.v1Preimage === ''
            ? null
            : projectSceneV1Preimage(marker.v1Preimage)
    }

    async write(marker: SceneAuthorityMarker): Promise<void> {
        if (!isMarker(marker)) throw new TypeError('Scene authority marker is invalid')
        await setIndexedDBItemStrict(SCENE_AUTHORITY_MARKER_STORE_KEY, JSON.stringify(marker))
    }
}
