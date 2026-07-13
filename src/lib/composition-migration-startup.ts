import {
    COMPOSITION_AUTHORITY_FEATURE_FLAG_KEY,
    COMPOSITION_MIGRATION_BACKUP_STORAGE_KEY,
    COMPOSITION_REPOSITORY_STORAGE_KEY,
    CompositionRepository,
    type CompositionAuthority,
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
    setRuntimeCompositionAuthority,
    setRuntimeCompositionDocument,
} from '@/lib/composition-authority'

const STARTUP_MIGRATION_OWNER = 'nais2-startup'

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
                    return result
                }
            }
        } catch (error) {
            console.error('[CompositionMigration] V2 startup re-read failed:', error)
        }
    }
    setRuntimeCompositionAuthority('legacy')
    let authority: CompositionAuthority = result.authority
    try {
        authority = (await repository.read(now)).authority
    } catch (error) {
        console.error('[CompositionMigration] Failed to read persisted authority:', error)
    }
    const foreignMigrationFailure = result.failureCode === 'E_MIGRATION_LOCKED'
        || result.failureCode === 'E_MIGRATION_LOCK_LOST'
        || result.failureCode === 'E_REPOSITORY_CONFLICT'
    if (result.status === 'failed' && !foreignMigrationFailure && authority === 'legacy') {
        persistCompositionAuthorityFeatureFlag('legacy')
    }
    return { ...result, authority }
}

export async function applyCompositionAuthorityFeatureFlag(
    authority: CompositionAuthority,
    now = new Date().toISOString(),
    storage: CompositionRepositoryStorage = productionStorage(),
): Promise<void> {
    setRuntimeCompositionAuthority('legacy')
    const repository = new CompositionRepository(storage)
    if (authority === 'legacy') {
        await repository.setAuthority('legacy', now)
        persistCompositionAuthorityFeatureFlag('legacy')
        return
    }

    const result = await runStartupCompositionMigration({ now, authority: 'v2', storage })
    if (result.status === 'failed') {
        if (result.failureCode !== 'E_MIGRATION_LOCKED'
            && result.failureCode !== 'E_MIGRATION_LOCK_LOST'
            && result.failureCode !== 'E_REPOSITORY_CONFLICT') {
            persistCompositionAuthorityFeatureFlag('legacy')
        }
        throw new Error(result.error ?? 'Composition v2 authority activation failed')
    }
    if (getRuntimeCompositionAuthority() !== 'v2') {
        persistCompositionAuthorityFeatureFlag('legacy')
        throw new Error('Composition v2 authority activation did not pass repository verification')
    }
    persistCompositionAuthorityFeatureFlag('v2')
}
