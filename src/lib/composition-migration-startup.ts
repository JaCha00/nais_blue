import {
    COMPOSITION_AUTHORITY_FEATURE_FLAG_KEY,
    COMPOSITION_MIGRATION_BACKUP_STORAGE_KEY,
    COMPOSITION_REPOSITORY_STORAGE_KEY,
    CompositionRepository,
    CompositionRepositoryError,
    compositionDocumentHash,
    type CompositionAuthority,
    type CompositionRepositoryRecord,
    type CompositionRepositoryStorage,
} from '@/domain/composition/repository'
import {
    COMPOSITION_MIGRATION_REGISTRY_VERSION,
    LEGACY_COMPOSITION_STORE_ALIASES,
    LEGACY_STORES_MIGRATION_ID,
    runCompositionMigration,
} from '@/domain/composition/migrations'
import {
    exportRawIndexedDBEntries,
    exportWildcardContentSnapshot,
    compareAndSetIndexedDBItem,
    getIndexedDBItemStrict,
    setIndexedDBItemStrict,
} from '@/lib/indexed-db'
import {
    COMPOSITION_MIGRATION_POST_COMMIT_SOURCE_CHANGED,
    runCompositionMigrationTransaction,
    type CompositionMigrationSourceSnapshot,
    type CompositionMigrationTransactionResult,
} from '@/lib/composition-migration-runtime'
import { materializeCompositionMigrationSidecars } from '@/lib/composition-migration-materialization'
import { compareLegacyAuthorityToMigratedDocument } from '@/lib/composition-migration-shadow'
import { loadRawAssetProfileFile } from '@/services/asset-profile-file'
import {
    getRuntimeCompositionAuthority,
    getRuntimeCompositionDocument,
    setRuntimeCompositionAuthority,
    setRuntimeCompositionDocument,
} from '@/lib/composition-authority'

const STARTUP_MIGRATION_OWNER = 'nais2-startup'

export type CompositionAuthorityFallbackReason =
    | 'migration-failed'
    | 'repository-verification-failed'
    | 'startup-failed-before-result'
    | 'runtime-authority-mismatch'

export type CompositionMigrationDiagnosticStatus =
    | 'not-migrated'
    | 'migration-active'
    | 'interrupted-migration'
    | 'committed-unverified'
    | 'startup-verified'
    | 'canonical-v2'
    | 'repository-invalid'

export interface CompositionStartupObservation {
    observedAt: string
    requestedAuthority: CompositionAuthority
    persistedAuthority: CompositionAuthority | 'unavailable'
    runtimeAuthority: CompositionAuthority
    resultStatus: CompositionMigrationTransactionResult['status'] | 'failed-before-result' | 'authority-applied'
    fallbackReason: CompositionAuthorityFallbackReason | null
}

export interface CompositionAuthorityInspection {
    inspectedAt: string
    configuredAuthority: CompositionAuthority | null
    persistedAuthority: CompositionAuthority | 'unavailable'
    runtimeAuthority: CompositionAuthority
    repositoryRevision: number | null
    repositoryHash: string | null
    migrationStatus: CompositionMigrationDiagnosticStatus
    startupVerificationTimestamp: string | null
    fallbackReason: CompositionAuthorityFallbackReason | null
    repositoryErrorCode: string | null
    lastStartup: CompositionStartupObservation | null
}

let lastStartupObservation: CompositionStartupObservation | null = null

function recordStartupObservation(observation: CompositionStartupObservation): void {
    lastStartupObservation = { ...observation }
}

export function getLastCompositionStartupObservation(): CompositionStartupObservation | null {
    return lastStartupObservation === null ? null : { ...lastStartupObservation }
}

function productionStorage(): CompositionRepositoryStorage {
    return {
        getItem: getIndexedDBItemStrict,
        setItem: setIndexedDBItemStrict,
        compareAndSet: compareAndSetIndexedDBItem,
    }
}

function configuredAuthority(): CompositionAuthority | null {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null
    const value = localStorage.getItem(COMPOSITION_AUTHORITY_FEATURE_FLAG_KEY)
    return value === 'v2' || value === 'legacy' ? value : null
}

function persistCompositionAuthorityFeatureFlag(authority: CompositionAuthority): void {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem(COMPOSITION_AUTHORITY_FEATURE_FLAG_KEY, authority)
    }
}

export function mergeLegacyLocalStorageAliases(
    serializedStores: Readonly<Record<string, string>>,
    readLocalValue: (key: string) => string | null,
): Record<string, string> {
    const merged = { ...serializedStores }
    const legacyAliases = [...new Set(Object.values(LEGACY_COMPOSITION_STORE_ALIASES).flat())]
    for (const key of legacyAliases.sort((left, right) => left.localeCompare(right))) {
        if (merged[key] !== undefined) continue
        const raw = readLocalValue(key)
        if (raw !== null) merged[key] = raw
    }
    return merged
}

export async function collectCompositionMigrationSource(): Promise<CompositionMigrationSourceSnapshot> {
    let serializedStores = await exportRawIndexedDBEntries()
    delete serializedStores[COMPOSITION_REPOSITORY_STORAGE_KEY]
    delete serializedStores[COMPOSITION_MIGRATION_BACKUP_STORAGE_KEY]

    // Some pre-IndexedDB releases used non-canonical localStorage aliases.
    // Capture them under the migration lock without deleting or rewriting the
    // source; the legacy migrator already understands these exact keys.
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
        serializedStores = mergeLegacyLocalStorageAliases(
            serializedStores,
            key => localStorage.getItem(key),
        )
    }

    const wildcardContent = await exportWildcardContentSnapshot({ strict: true })
    let assetProfileJson: unknown
    // A read error is not equivalent to a missing profile. Let it abort the
    // migration so an existing disk authority can never be silently omitted.
    const diskProfile = await loadRawAssetProfileFile()
    if (diskProfile.exists) assetProfileJson = diskProfile.rawJson

    return {
        serializedStores,
        wildcardContent,
        ...(assetProfileJson === undefined ? {} : { assetProfileJson }),
    }
}

export interface StartupCompositionMigrationOptions {
    now?: string
    authority?: CompositionAuthority
    source?: CompositionMigrationSourceSnapshot
    storage?: CompositionRepositoryStorage
    materializeSidecars?: typeof materializeCompositionMigrationSidecars
    clock?: () => string
}

/** Runs before store hydration becomes authoritative; failures stay on legacy. */
export async function runStartupCompositionMigration(
    options: StartupCompositionMigrationOptions = {},
): Promise<CompositionMigrationTransactionResult> {
    setRuntimeCompositionAuthority('legacy')
    const now = options.now ?? new Date().toISOString()
    const storage = options.storage ?? productionStorage()
    const repository = new CompositionRepository(storage)
    const sourceInput = options.source === undefined
        ? collectCompositionMigrationSource
        : async () => options.source!
    const materializeSidecars = options.materializeSidecars
        ?? (options.source === undefined ? materializeCompositionMigrationSidecars : undefined)
    let activateAuthority: CompositionAuthority = options.authority ?? 'legacy'
    let requestedAuthority: CompositionAuthority = activateAuthority
    let repositoryVerificationFailed = false
    const executeMigration = () => runCompositionMigrationTransaction({
        repository,
        storage,
        source: sourceInput,
        now,
        owner: STARTUP_MIGRATION_OWNER,
        activateAuthority,
        registryVersion: COMPOSITION_MIGRATION_REGISTRY_VERSION,
        clock: options.clock ?? (() => new Date().toISOString()),
        migrate: input => runCompositionMigration(LEGACY_STORES_MIGRATION_ID, input),
        shadowResolve: compareLegacyAuthorityToMigratedDocument,
        ...(materializeSidecars === undefined
            ? {}
            : {
                postCommitBeforeFinalize: async ({ source, document, sidecars }) => {
                    await materializeSidecars({ source, document, sidecars })
                },
            }),
    })
    let result: CompositionMigrationTransactionResult
    try {
        await repository.cleanupInterruptedMigration(now)
        activateAuthority = options.authority
            ?? configuredAuthority()
            ?? (await repository.read(now)).authority
        requestedAuthority = activateAuthority
        result = await executeMigration()
        if (result.failureCode === COMPOSITION_MIGRATION_POST_COMMIT_SOURCE_CHANGED) {
            result = await executeMigration()
            if (result.failureCode === COMPOSITION_MIGRATION_POST_COMMIT_SOURCE_CHANGED) {
                result = {
                    ...result,
                    error: 'Composition compatibility projection did not reach a stable source hash',
                }
            }
        }
    } catch (error) {
        // Repository cleanup is owned by the transaction. This wrapper never
        // writes repository authority after a concurrent startup can take over.
        setRuntimeCompositionAuthority('legacy')
        recordStartupObservation({
            observedAt: now,
            requestedAuthority,
            persistedAuthority: 'unavailable',
            runtimeAuthority: 'legacy',
            resultStatus: 'failed-before-result',
            fallbackReason: 'startup-failed-before-result',
        })
        throw error
    }
    if (result.status !== 'failed' && result.authority === 'v2') {
        try {
            const verified = await repository.read(now)
            if (verified.authority === 'v2'
                && verified.committedDocument !== undefined
                && verified.committedHash === result.marker?.targetHash
                && verified.migrationMarker?.startupVerifiedAt !== undefined) {
                const authoritativeDocument = await repository.readAuthoritativeDocument(now)
                if (authoritativeDocument !== null) {
                    setRuntimeCompositionDocument(authoritativeDocument)
                    setRuntimeCompositionAuthority('v2')
                    recordStartupObservation({
                        observedAt: now,
                        requestedAuthority,
                        persistedAuthority: 'v2',
                        runtimeAuthority: 'v2',
                        resultStatus: result.status,
                        fallbackReason: null,
                    })
                    return result
                }
            }
        } catch {
            repositoryVerificationFailed = true
        }
    }
    setRuntimeCompositionAuthority('legacy')
    let authority: CompositionAuthority = result.authority
    let persistedAuthority: CompositionAuthority | 'unavailable' = authority
    try {
        authority = (await repository.read(now)).authority
        persistedAuthority = authority
    } catch {
        persistedAuthority = 'unavailable'
    }
    const foreignMigrationFailure = result.failureCode === 'E_MIGRATION_LOCKED'
        || result.failureCode === 'E_MIGRATION_LOCK_LOST'
        || result.failureCode === 'E_REPOSITORY_CONFLICT'
    if (result.status === 'failed' && !foreignMigrationFailure && authority === 'legacy') {
        persistCompositionAuthorityFeatureFlag('legacy')
    }
    const fallbackReason: CompositionAuthorityFallbackReason | null = repositoryVerificationFailed
        ? 'repository-verification-failed'
        : result.status === 'failed'
            ? 'migration-failed'
            : requestedAuthority === 'v2' && getRuntimeCompositionAuthority() !== 'v2'
                ? 'runtime-authority-mismatch'
                : null
    recordStartupObservation({
        observedAt: now,
        requestedAuthority,
        persistedAuthority,
        runtimeAuthority: getRuntimeCompositionAuthority(),
        resultStatus: result.status,
        fallbackReason,
    })
    return { ...result, authority }
}

function migrationDiagnosticStatus(
    record: CompositionRepositoryRecord,
    now: string,
): CompositionMigrationDiagnosticStatus {
    if (record.migrationLock !== undefined || record.staged !== undefined) {
        const expiresAt = record.migrationLock === undefined
            ? Number.NaN
            : Date.parse(record.migrationLock.expiresAt)
        const inspectedAt = Date.parse(now)
        return record.migrationLock !== undefined
            && Number.isFinite(expiresAt)
            && Number.isFinite(inspectedAt)
            && expiresAt > inspectedAt
            ? 'migration-active'
            : 'interrupted-migration'
    }
    if (record.committedDocument === undefined) return 'not-migrated'
    if (record.migrationMarker?.startupVerifiedAt !== undefined) return 'startup-verified'
    if (record.authority === 'v2') return 'canonical-v2'
    return 'committed-unverified'
}

export async function inspectCompositionAuthority(options: {
    now?: string
    storage?: CompositionRepositoryStorage
} = {}): Promise<CompositionAuthorityInspection> {
    const now = options.now ?? new Date().toISOString()
    const storage = options.storage ?? productionStorage()
    const repository = new CompositionRepository(storage)
    const runtimeAuthority = getRuntimeCompositionAuthority()
    let configured: CompositionAuthority | null = null
    try {
        configured = configuredAuthority()
    } catch {
        // Repository state remains independently inspectable when the local
        // preference store is unavailable.
    }

    try {
        const record = await repository.read(now)
        const inferredFallback = record.authority === 'v2' && runtimeAuthority !== 'v2'
            ? 'runtime-authority-mismatch'
            : null
        const observedFallback = lastStartupObservation?.fallbackReason ?? null
        return {
            inspectedAt: now,
            configuredAuthority: configured,
            persistedAuthority: record.authority,
            runtimeAuthority,
            repositoryRevision: record.revision,
            repositoryHash: record.committedHash ?? null,
            migrationStatus: migrationDiagnosticStatus(record, now),
            startupVerificationTimestamp: record.migrationMarker?.startupVerifiedAt ?? null,
            fallbackReason: observedFallback ?? inferredFallback,
            repositoryErrorCode: null,
            lastStartup: getLastCompositionStartupObservation(),
        }
    } catch (error) {
        return {
            inspectedAt: now,
            configuredAuthority: configured,
            persistedAuthority: 'unavailable',
            runtimeAuthority,
            repositoryRevision: null,
            repositoryHash: null,
            migrationStatus: 'repository-invalid',
            startupVerificationTimestamp: null,
            fallbackReason: lastStartupObservation?.fallbackReason ?? 'startup-failed-before-result',
            repositoryErrorCode: error instanceof CompositionRepositoryError
                ? error.code
                : 'E_REPOSITORY_READ_FAILED',
            lastStartup: getLastCompositionStartupObservation(),
        }
    }
}

export type CompositionAuthorityActivationOverrides = Pick<
    StartupCompositionMigrationOptions,
    'source' | 'materializeSidecars' | 'clock'
>

export async function applyCompositionAuthorityFeatureFlag(
    authority: CompositionAuthority,
    now = new Date().toISOString(),
    storage: CompositionRepositoryStorage = productionStorage(),
    startupOverrides: CompositionAuthorityActivationOverrides = {},
): Promise<void> {
    setRuntimeCompositionAuthority('legacy')
    const repository = new CompositionRepository(storage)
    if (authority === 'legacy') {
        const persisted = await repository.setAuthority('legacy', now)
        persistCompositionAuthorityFeatureFlag('legacy')
        recordStartupObservation({
            observedAt: now,
            requestedAuthority: 'legacy',
            persistedAuthority: persisted.authority,
            runtimeAuthority: 'legacy',
            resultStatus: 'authority-applied',
            fallbackReason: null,
        })
        return
    }

    const result = await runStartupCompositionMigration({
        ...startupOverrides,
        now,
        authority: 'v2',
        storage,
    })
    if (result.status === 'failed') {
        if (result.failureCode !== 'E_MIGRATION_LOCKED'
            && result.failureCode !== 'E_MIGRATION_LOCK_LOST'
            && result.failureCode !== 'E_REPOSITORY_CONFLICT') {
            persistCompositionAuthorityFeatureFlag('legacy')
        }
        throw new Error(result.error ?? 'Composition v2 authority activation failed')
    }
    let verified: CompositionRepositoryRecord
    try {
        verified = await repository.read(now)
    } catch {
        setRuntimeCompositionAuthority('legacy')
        persistCompositionAuthorityFeatureFlag('legacy')
        recordStartupObservation({
            observedAt: now,
            requestedAuthority: 'v2',
            persistedAuthority: 'unavailable',
            runtimeAuthority: 'legacy',
            resultStatus: result.status,
            fallbackReason: 'repository-verification-failed',
        })
        throw new Error('Composition v2 authority activation repository verification failed')
    }
    const runtimeDocument = getRuntimeCompositionDocument()
    if (getRuntimeCompositionAuthority() !== 'v2'
        || verified.authority !== 'v2'
        || verified.committedDocument === undefined
        || verified.committedHash === undefined
        || runtimeDocument === null
        || compositionDocumentHash(runtimeDocument) !== verified.committedHash) {
        setRuntimeCompositionAuthority('legacy')
        persistCompositionAuthorityFeatureFlag('legacy')
        recordStartupObservation({
            observedAt: now,
            requestedAuthority: 'v2',
            persistedAuthority: verified.authority,
            runtimeAuthority: 'legacy',
            resultStatus: result.status,
            fallbackReason: 'repository-verification-failed',
        })
        throw new Error('Composition v2 authority activation did not pass repository verification')
    }
    persistCompositionAuthorityFeatureFlag('v2')
}
