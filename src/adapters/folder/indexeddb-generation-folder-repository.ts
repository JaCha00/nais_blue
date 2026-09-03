import type { GenerationFolderRepositoryPort } from '@/application/folder/generation-folder-repository'
import {
    normalizeGenerationFolderV1Projection,
    type GenerationFolderV1Projection,
} from '@/domain/generation-folders'
import { getIndexedDBItemStrict } from '@/lib/indexed-db'

const SETTINGS_STORAGE_KEY = 'nai-blue-settings'
const SETTINGS_PERSIST_VERSION = 1

export interface GenerationFolderPersistencePort {
    getItem(key: string): Promise<string | null>
}

const indexedDbPersistence: GenerationFolderPersistencePort = { getItem: getIndexedDBItemStrict }

/** Reads the existing Zustand V1 envelope without mutating or migrating it. */
export class IndexedDbGenerationFolderRepository implements GenerationFolderRepositoryPort {
    constructor(private readonly persistence: GenerationFolderPersistencePort = indexedDbPersistence) {}

    async readLegacyProjection(): Promise<GenerationFolderV1Projection | null> {
        const serialized = await this.persistence.getItem(SETTINGS_STORAGE_KEY)
        if (serialized === null) return null

        let parsed: unknown
        try {
            parsed = JSON.parse(serialized) as unknown
        } catch {
            throw new TypeError('Generation folder settings envelope is invalid')
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new TypeError('Generation folder settings envelope is invalid')
        }
        const envelope = parsed as { state?: unknown; version?: unknown }
        if (envelope.version !== SETTINGS_PERSIST_VERSION
            || typeof envelope.state !== 'object'
            || envelope.state === null
            || Array.isArray(envelope.state)) {
            throw new TypeError('Unsupported generation folder settings envelope')
        }
        return normalizeGenerationFolderV1Projection(envelope.state)
    }
}
