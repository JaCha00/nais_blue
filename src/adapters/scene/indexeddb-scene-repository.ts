import type {
    SceneRepositoryPort,
    SceneV1AuthoringRecord,
    SceneV1CompatibilityProjection,
    SceneV1PresetProjection,
} from '@/application/scene/scene-repository'
import { getIndexedDBItemStrict } from '@/lib/indexed-db'

const SCENE_STORAGE_KEY = 'nai-blue-scenes'
// Zustand persist defaults to version 0 when the store does not specify one.
const SCENE_PERSIST_VERSION = 0

export interface ScenePersistencePort {
    getItem(key: string): Promise<string | null>
}

const indexedDbPersistence: ScenePersistencePort = { getItem: getIndexedDBItemStrict }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertSceneRecord(value: unknown): asserts value is Record<string, unknown> {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || typeof value.name !== 'string'
        || typeof value.scenePrompt !== 'string'
        || !Array.isArray(value.images)
        || typeof value.createdAt !== 'number') {
        throw new TypeError('Scene V1 authoring record is invalid')
    }
}

function defined<K extends string>(source: Record<string, unknown>, key: K): Record<K, unknown> | object {
    return source[key] === undefined ? {} : { [key]: structuredClone(source[key]) }
}

function projectScene(value: unknown): SceneV1AuthoringRecord {
    assertSceneRecord(value)
    return {
        id: value.id,
        name: value.name,
        scenePrompt: value.scenePrompt,
        ...defined(value, 'prompts'),
        ...defined(value, 'characterCaptions'),
        ...defined(value, 'characterPositionEnabled'),
        ...defined(value, 'generation'),
        images: structuredClone(value.images),
        ...defined(value, 'width'),
        ...defined(value, 'height'),
        ...defined(value, 'metadataMode'),
        ...defined(value, 'generationFolderId'),
        ...defined(value, 'filenameTemplate'),
        ...defined(value, 'excludePinned'),
        ...defined(value, 'compositionRef'),
        createdAt: value.createdAt,
    } as SceneV1AuthoringRecord
}

function projectPreset(value: unknown): SceneV1PresetProjection {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || typeof value.name !== 'string'
        || !Array.isArray(value.scenes)
        || typeof value.createdAt !== 'number') {
        throw new TypeError('Scene V1 preset is invalid')
    }
    return {
        id: value.id,
        name: value.name,
        scenes: value.scenes.map(projectScene),
        ...defined(value, 'parentId'),
        ...defined(value, 'defaultTemplate'),
        createdAt: value.createdAt,
    } as SceneV1PresetProjection
}

/** Pure authoring projection shared by IndexedDB reads and migration parity tests. */
export function projectSceneV1Compatibility(value: unknown): SceneV1CompatibilityProjection {
    if (!isRecord(value) || !Array.isArray(value.presets)) {
        throw new TypeError('Scene V1 persisted state is invalid')
    }
    return { presets: value.presets.map(projectPreset) }
}

/** Reads the current Zustand envelope without mutating, migrating, or writing it. */
export class IndexedDbSceneRepository implements SceneRepositoryPort {
    constructor(private readonly persistence: ScenePersistencePort = indexedDbPersistence) {}

    async readLegacyProjection(): Promise<SceneV1CompatibilityProjection | null> {
        const serialized = await this.persistence.getItem(SCENE_STORAGE_KEY)
        if (serialized === null) return null

        let parsed: unknown
        try {
            parsed = JSON.parse(serialized) as unknown
        } catch {
            throw new TypeError('Scene Zustand envelope is invalid')
        }
        if (!isRecord(parsed)) throw new TypeError('Scene Zustand envelope is invalid')
        if (parsed.version !== SCENE_PERSIST_VERSION || !isRecord(parsed.state)) {
            throw new TypeError('Unsupported Scene Zustand envelope')
        }
        return projectSceneV1Compatibility(parsed.state)
    }
}
