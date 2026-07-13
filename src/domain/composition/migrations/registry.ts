import {
    migrateLegacyStoresToV2,
    type LegacyStoresMigrationInput,
    type LegacyStoresMigrationResult,
} from './legacy-stores-to-v2'
import {
    migrateV1AssetProfileToV2,
    V1_ASSET_PROFILE_MIGRATION_ID,
    type V1AssetProfileMigrationInput,
    type V1AssetProfileMigrationResult,
} from './v1-asset-profile-to-v2'

export const LEGACY_STORES_MIGRATION_ID = 'legacy-stores-to-composition-v2' as const
export const COMPOSITION_MIGRATION_REGISTRY_VERSION = 1 as const

export interface CompositionMigrationMetadata {
    id: string
    sourceKind: 'asset-profile' | 'legacy-stores'
    sourceSchemaVersion: number | 'legacy'
    targetSchemaVersion: number
    deterministic: true
    rollbackSourceRetained: true
}

const assetProfileMigration = Object.freeze({
    id: V1_ASSET_PROFILE_MIGRATION_ID,
    sourceKind: 'asset-profile',
    sourceSchemaVersion: 1,
    targetSchemaVersion: 2,
    deterministic: true,
    rollbackSourceRetained: true,
    migrate: migrateV1AssetProfileToV2,
} as const)

const legacyStoresMigration = Object.freeze({
    id: LEGACY_STORES_MIGRATION_ID,
    sourceKind: 'legacy-stores',
    sourceSchemaVersion: 'legacy',
    targetSchemaVersion: 2,
    deterministic: true,
    rollbackSourceRetained: true,
    migrate: migrateLegacyStoresToV2,
} as const)

/** Static registry: adding a migration is an explicit source-controlled change. */
export const compositionMigrationRegistry = Object.freeze({
    [V1_ASSET_PROFILE_MIGRATION_ID]: assetProfileMigration,
    [LEGACY_STORES_MIGRATION_ID]: legacyStoresMigration,
})

export type CompositionMigrationId = keyof typeof compositionMigrationRegistry
export type CompositionMigrationRegistration =
    | typeof assetProfileMigration
    | typeof legacyStoresMigration

export function getCompositionMigration(
    id: string,
): CompositionMigrationRegistration | undefined {
    return Object.prototype.hasOwnProperty.call(compositionMigrationRegistry, id)
        ? compositionMigrationRegistry[id as CompositionMigrationId]
        : undefined
}

export function listCompositionMigrations(): CompositionMigrationMetadata[] {
    return Object.values(compositionMigrationRegistry).map(entry => ({
        id: entry.id,
        sourceKind: entry.sourceKind,
        sourceSchemaVersion: entry.sourceSchemaVersion,
        targetSchemaVersion: entry.targetSchemaVersion,
        deterministic: entry.deterministic,
        rollbackSourceRetained: entry.rollbackSourceRetained,
    }))
}

export function runCompositionMigration(
    id: typeof V1_ASSET_PROFILE_MIGRATION_ID,
    input: V1AssetProfileMigrationInput,
): V1AssetProfileMigrationResult
export function runCompositionMigration(
    id: typeof LEGACY_STORES_MIGRATION_ID,
    input: LegacyStoresMigrationInput,
): LegacyStoresMigrationResult
export function runCompositionMigration(
    id: CompositionMigrationId,
    input: V1AssetProfileMigrationInput | LegacyStoresMigrationInput,
): V1AssetProfileMigrationResult | LegacyStoresMigrationResult {
    switch (id) {
        case V1_ASSET_PROFILE_MIGRATION_ID:
            return migrateV1AssetProfileToV2(input as V1AssetProfileMigrationInput)
        case LEGACY_STORES_MIGRATION_ID:
            return migrateLegacyStoresToV2(input as LegacyStoresMigrationInput)
    }
}
