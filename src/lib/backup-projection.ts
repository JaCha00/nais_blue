import {
    compositionMigrationSourceCounts,
    compositionMigrationSourceHash,
    type CompositionMigrationSourceSnapshot,
} from '@/lib/composition-migration-runtime'

export const AUTH_BACKUP_STORE_KEY = 'nais2-auth' as const
const COMPOSITION_MIGRATION_BACKUP_STORE_KEY = 'nais2-composition-migration-backup'

export type BackupProjectionPurpose =
    | 'manual-full'
    | 'local-auto'
    | 'disk-auto'
    | 'store-snapshot'
    | 'restore-preflight'

export interface BackupProjectionResult {
    payload: unknown
    purpose: BackupProjectionPurpose
    sanitized: boolean
    credentialReentryRequired: boolean
}

const DISPLAY_TIERS = new Set(['paper', 'tablet', 'scroll', 'opus'])

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function projectAuthState(value: unknown): Record<string, unknown> {
    const state = isRecord(value) ? value : {}
    const projected: Record<string, unknown> = {
        isVerified: false,
        isVerified2: false,
    }

    if (state.tier === null || (typeof state.tier === 'string' && DISPLAY_TIERS.has(state.tier))) {
        projected.tier = state.tier
    }
    if (state.tier2 === null || (typeof state.tier2 === 'string' && DISPLAY_TIERS.has(state.tier2))) {
        projected.tier2 = state.tier2
    }
    if (typeof state.slot1Enabled === 'boolean') projected.slot1Enabled = state.slot1Enabled
    if (typeof state.slot2Enabled === 'boolean') projected.slot2Enabled = state.slot2Enabled

    return projected
}

function projectAuthPayload(value: unknown): unknown {
    if (!isRecord(value)) return projectAuthState(value)

    if (Object.prototype.hasOwnProperty.call(value, 'state')) {
        return {
            ...(typeof value.version === 'number' && Number.isFinite(value.version)
                ? { version: value.version }
                : {}),
            state: projectAuthState(value.state),
        }
    }

    return projectAuthState(value)
}

function projectSerializedAuth(raw: unknown): string {
    if (typeof raw !== 'string') {
        return JSON.stringify(projectAuthPayload(undefined))
    }
    try {
        return JSON.stringify(projectAuthPayload(JSON.parse(raw) as unknown))
    } catch {
        return JSON.stringify(projectAuthPayload(undefined))
    }
}

function projectMigrationArchive(value: unknown): { payload: unknown; sanitized: boolean } {
    if (!isRecord(value) || !Array.isArray(value.snapshots)) {
        return { payload: value, sanitized: false }
    }

    let sanitized = false
    const snapshots = value.snapshots.map((candidate) => {
        if (!isRecord(candidate) || !isRecord(candidate.serializedStores)
            || !Object.prototype.hasOwnProperty.call(candidate.serializedStores, AUTH_BACKUP_STORE_KEY)) {
            return candidate
        }

        sanitized = true
        const serializedStores = {
            ...candidate.serializedStores,
            [AUTH_BACKUP_STORE_KEY]: projectSerializedAuth(candidate.serializedStores[AUTH_BACKUP_STORE_KEY]),
        } as Record<string, string>
        const source: CompositionMigrationSourceSnapshot = {
            serializedStores,
            wildcardContent: isRecord(candidate.wildcardContent)
                ? candidate.wildcardContent as Record<string, string[]>
                : {},
            ...(Object.prototype.hasOwnProperty.call(candidate, 'assetProfileJson')
                ? { assetProfileJson: candidate.assetProfileJson }
                : {}),
        }
        return {
            ...candidate,
            serializedStores,
            sourceHash: compositionMigrationSourceHash(source),
            sourceCounts: compositionMigrationSourceCounts(source),
        }
    })

    return sanitized
        ? { payload: { ...value, snapshots }, sanitized: true }
        : { payload: value, sanitized: false }
}

/**
 * Single store-level boundary shared by every backup writer and restore
 * preflight. Auth data is rebuilt from an allowlist so unknown provider fields
 * cannot carry credentials, balances, errors, or reversible token encodings.
 */
export function projectStoreForBackup(
    storeKey: string,
    persistedPayload: unknown,
    purpose: BackupProjectionPurpose,
): BackupProjectionResult {
    if (storeKey !== AUTH_BACKUP_STORE_KEY) {
        if (storeKey === COMPOSITION_MIGRATION_BACKUP_STORE_KEY) {
            const projected = projectMigrationArchive(persistedPayload)
            return {
                payload: projected.payload,
                purpose,
                sanitized: projected.sanitized,
                credentialReentryRequired: false,
            }
        }
        return {
            payload: persistedPayload,
            purpose,
            sanitized: false,
            credentialReentryRequired: false,
        }
    }

    return {
        payload: projectAuthPayload(persistedPayload),
        purpose,
        sanitized: true,
        credentialReentryRequired: purpose === 'restore-preflight',
    }
}
