import {
    compositionMigrationSourceCounts,
    compositionMigrationSourceHash,
    type CompositionMigrationSourceSnapshot,
} from '@/lib/composition-migration-runtime'
import type { CredentialRef } from '@/domain/credentials/types'

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
const AUTH_STATE_VERSION = 3

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function projectCredentialRef(value: unknown, expectedId: string): CredentialRef | null {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || !/^[a-z0-9:_-]{1,96}$/i.test(value.id)
        || value.id !== expectedId
        || value.kind !== 'novelai-token'
        || typeof value.lastFour !== 'string'
        || value.lastFour.length !== 4
        || typeof value.createdAt !== 'string'
        || !Number.isFinite(Date.parse(value.createdAt))
        || typeof value.updatedAt !== 'string'
        || !Number.isFinite(Date.parse(value.updatedAt))) {
        return null
    }
    const verifiedAt = typeof value.verifiedAt === 'string' && Number.isFinite(Date.parse(value.verifiedAt))
        ? value.verifiedAt
        : null
    return {
        id: value.id,
        kind: value.kind,
        lastFour: value.lastFour,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        ...(verifiedAt === null ? {} : { verifiedAt }),
    }
}

function projectAuthState(value: unknown): Record<string, unknown> {
    const state = isRecord(value) ? value : {}
    const projected: Record<string, unknown> = {
        slot1CredentialRef: projectCredentialRef(state.slot1CredentialRef, 'novelai-slot-1'),
        slot2CredentialRef: projectCredentialRef(state.slot2CredentialRef, 'novelai-slot-2'),
        slot1Enabled: typeof state.slot1Enabled === 'boolean' ? state.slot1Enabled : true,
        slot2Enabled: typeof state.slot2Enabled === 'boolean' ? state.slot2Enabled : true,
        tier: null,
        tier2: null,
    }

    if (state.tier === null || (typeof state.tier === 'string' && DISPLAY_TIERS.has(state.tier))) {
        projected.tier = state.tier
    }
    if (state.tier2 === null || (typeof state.tier2 === 'string' && DISPLAY_TIERS.has(state.tier2))) {
        projected.tier2 = state.tier2
    }
    return projected
}

function projectAuthPayload(value: unknown): unknown {
    const state = isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'state')
        ? value.state
        : value
    return {
        state: projectAuthState(state),
        version: AUTH_STATE_VERSION,
    }
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
