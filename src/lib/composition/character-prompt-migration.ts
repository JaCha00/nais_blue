import { deterministicMigrationId } from '@/lib/composition/legacy-migration-id'

export interface MigratedCharacterPrompt {
    id: string
    name?: string
    presetId?: string
    groupId?: string
    prompt: string
    negative: string
    enabled: boolean
    position: { x: number; y: number }
    [key: string]: unknown
}

export interface CharacterIdMigrationEntry {
    index: number
    id: string
    legacyId?: string
    reason: 'missing' | 'duplicate'
}

export interface CharacterIdMigrationResult {
    characters: MigratedCharacterPrompt[]
    migrations: CharacterIdMigrationEntry[]
}

export interface MigratedCharacterPromptPersistedState {
    characters: MigratedCharacterPrompt[]
    presets: unknown[]
    groups: unknown[]
    positionEnabled: boolean
    [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedCoordinate(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : 0.5
}

function withoutId(record: Record<string, unknown>): Record<string, unknown> {
    const { id: _id, ...rest } = record
    return rest
}

export function migrateCharacterPromptIds(characters: readonly unknown[]): CharacterIdMigrationResult {
    const records = characters.map(character => isRecord(character) ? character : {})
    const reservedIds = new Set(records.flatMap(record => (
        typeof record.id === 'string' && record.id.trim().length > 0 ? [record.id] : []
    )))
    const usedIds = new Set<string>()
    const duplicateCounts = new Map<string, number>()
    const migrations: CharacterIdMigrationEntry[] = []

    const migrated = records.map((record, index): MigratedCharacterPrompt => {
        const legacyId = typeof record.id === 'string' && record.id.trim().length > 0
            ? record.id
            : undefined
        const occurrence = legacyId === undefined ? 0 : (duplicateCounts.get(legacyId) ?? 0)
        if (legacyId !== undefined) duplicateCounts.set(legacyId, occurrence + 1)

        let id = legacyId
        let reason: CharacterIdMigrationEntry['reason'] | undefined
        if (id === undefined) reason = 'missing'
        else if (usedIds.has(id)) reason = 'duplicate'

        if (reason !== undefined) {
            let salt = 0
            do {
                id = deterministicMigrationId('character', withoutId(record), `${index}:${occurrence}:${salt}`)
                salt += 1
            } while (usedIds.has(id as string) || reservedIds.has(id as string))
            migrations.push({
                index,
                id: id as string,
                ...(legacyId === undefined ? {} : { legacyId }),
                reason,
            })
        }

        usedIds.add(id as string)
        const position = isRecord(record.position) ? record.position : {}
        return {
            ...record,
            id: id as string,
            prompt: typeof record.prompt === 'string' ? record.prompt : '',
            negative: typeof record.negative === 'string' ? record.negative : '',
            enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
            position: {
                x: normalizedCoordinate(position.x),
                y: normalizedCoordinate(position.y),
            },
        }
    })

    return { characters: migrated, migrations }
}

export function migrateCharacterPromptPersistedState(
    value: unknown,
): MigratedCharacterPromptPersistedState {
    const state = isRecord(value) ? value : {}
    return {
        ...state,
        characters: migrateCharacterPromptIds(Array.isArray(state.characters) ? state.characters : []).characters,
        presets: Array.isArray(state.presets) ? state.presets : [],
        groups: Array.isArray(state.groups) ? state.groups : [],
        positionEnabled: typeof state.positionEnabled === 'boolean' ? state.positionEnabled : false,
    }
}
