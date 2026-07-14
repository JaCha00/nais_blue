import { describe, expect, it } from 'vitest'

import { typeFixtureDocument } from '@/domain/composition/types.typecheck'
import {
    CANONICAL_HASH_ALGORITHM,
    CANONICAL_SERIALIZATION_VERSION,
    canonicalSerialize,
    sha256Utf8,
} from '@/domain/composition/canonical-serialize'
import {
    compositionMigrationSourceCounts,
    compositionMigrationSourceHash,
    type CompositionMigrationSourceSnapshot,
} from '@/lib/composition-migration-runtime'
import {
    createBackupEnvelopeV3,
    createBackupStoreManifestEntry,
    createCurrentBackupEnvelopeV3,
    prepareBackupRestore,
    restoreBackupToStorage,
    type BackupContentHash,
} from '@/lib/auto-backup'
import {
    exportBackupFromStorage,
    type BackupStoragePort,
} from '@/lib/indexed-db'
import {
    createStoreSnapshotBackup,
    prepareStoreSnapshotRestore,
} from '@/lib/store-snapshots'

const SECRET_CANARIES = [
    'pst-TEST-DO-NOT-EXPORT',
    'TEST_R2_ACCESS_KEY',
    'TEST_R2_SECRET_KEY',
    'Authorization: Bearer TEST',
] as const

const AUTH_STORE_KEY = 'nais2-auth'
const MIGRATION_BACKUP_STORE_KEY = 'nais2-composition-migration-backup'

class MemoryStorage implements BackupStoragePort {
    readonly values = new Map<string, string>()

    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
}

function authPayload(): Record<string, unknown> {
    return {
        version: 2,
        state: {
            token: SECRET_CANARIES[0],
            token2: SECRET_CANARIES[1],
            isVerified: true,
            isVerified2: true,
            tier: 'opus',
            tier2: 'tablet',
            slot1Enabled: true,
            slot2Enabled: false,
            anlas: { fixed: 100, purchased: 200, total: 300 },
            anlas2: { fixed: 400, purchased: 500, total: 900 },
            rawProviderError: `${SECRET_CANARIES[2]} ${SECRET_CANARIES[3]}`,
        },
    }
}

function expectSecretFree(value: unknown): void {
    const serialized = JSON.stringify(value)
    for (const canary of SECRET_CANARIES) {
        expect(serialized.split(canary)).toHaveLength(1)
    }
}

function expectSafeAuthProjection(value: unknown): void {
    expect(value).toEqual({
        state: {
            slot1CredentialRef: null,
            slot2CredentialRef: null,
            tier: 'opus',
            tier2: 'tablet',
            slot1Enabled: true,
            slot2Enabled: false,
        },
        version: 3,
    })
    expectSecretFree(value)
}

function contentHash(value: unknown): BackupContentHash {
    return {
        algorithm: CANONICAL_HASH_ALGORITHM,
        canonicalization: CANONICAL_SERIALIZATION_VERSION,
        digest: sha256Utf8(canonicalSerialize(value)),
    }
}

function oldV3EnvelopeWithRawAuth(): ReturnType<typeof createBackupEnvelopeV3> {
    const envelope = createBackupEnvelopeV3({ [AUTH_STORE_KEY]: authPayload() }, {
        compositionDocument: typeFixtureDocument,
        createdAt: '2026-07-12T00:00:00.000Z',
    })
    const rawAuth = authPayload()
    const rawEntry = createBackupStoreManifestEntry(AUTH_STORE_KEY, rawAuth)
    envelope.stores[AUTH_STORE_KEY] = rawAuth
    envelope.storeManifest.entries = [rawEntry]
    envelope.storeManifest.storeCount = 1
    envelope.storeManifest.totalRecordCount = rawEntry.count
    envelope.storeManifest.hash = contentHash([rawEntry])
    const authFile = envelope.fileManifest.included.find(entry => entry.path === `stores/${AUTH_STORE_KEY}.json`)
    if (!authFile) throw new Error('Auth file manifest entry is missing')
    authFile.sizeBytes = new TextEncoder().encode(canonicalSerialize(rawAuth)).byteLength
    authFile.hash = contentHash(rawAuth)
    return envelope
}

describe('secret-safe backup projection', () => {
    it('preserves only validated AuthState v3 references and display metadata', async () => {
        const credentialRef = {
            id: 'novelai-slot-1',
            kind: 'novelai-token',
            lastFour: '1234',
            createdAt: '2026-07-13T00:00:00.000Z',
            updatedAt: '2026-07-13T00:00:00.000Z',
            verifiedAt: '2026-07-13T00:00:00.000Z',
        }
        const storage = new MemoryStorage()
        storage.values.set(AUTH_STORE_KEY, JSON.stringify({
            version: 3,
            state: {
                slot1CredentialRef: credentialRef,
                slot2CredentialRef: null,
                slot1Enabled: true,
                slot2Enabled: false,
                tier: 'opus',
                tier2: null,
                token: SECRET_CANARIES[0],
                anlas: { total: 999 },
            },
        }))

        const backup = await exportBackupFromStorage(storage, {
            storeKeys: [AUTH_STORE_KEY],
            purpose: 'manual-full',
        })
        expect(backup[AUTH_STORE_KEY]).toEqual({
            state: {
                slot1CredentialRef: credentialRef,
                slot2CredentialRef: null,
                slot1Enabled: true,
                slot2Enabled: false,
                tier: 'opus',
                tier2: null,
            },
            version: 3,
        })
        expectSecretFree(backup)
    })

    it('redacts auth data from the full backup storage export', async () => {
        const storage = new MemoryStorage()
        storage.values.set(AUTH_STORE_KEY, JSON.stringify(authPayload()))

        const backup = await exportBackupFromStorage(storage, {
            storeKeys: [AUTH_STORE_KEY],
            exportedAt: '2026-07-13T00:00:00.000Z',
            purpose: 'manual-full',
        })

        expectSafeAuthProjection(backup[AUTH_STORE_KEY])
        expectSecretFree(backup)
    })

    it.each(['manual-full', 'local-auto', 'disk-auto'] as const)(
        'redacts auth data from the %s envelope and hashes the projection',
        async (purpose) => {
            const rawBackup = { [AUTH_STORE_KEY]: authPayload() }
            const envelope = createBackupEnvelopeV3(rawBackup, {
                compositionDocument: typeFixtureDocument,
                createdAt: '2026-07-13T00:00:00.000Z',
                purpose,
            })

            expectSafeAuthProjection(envelope.stores[AUTH_STORE_KEY])
            expect(envelope.storeManifest.entries).toEqual([
                expect.objectContaining({ key: AUTH_STORE_KEY, count: 6 }),
            ])
            expectSecretFree(envelope)
        },
    )

    it('redacts auth data from a current backup envelope built with injected storage', async () => {
        const envelope = await createCurrentBackupEnvelopeV3({
            compositionDocument: typeFixtureDocument,
            createdAt: '2026-07-13T00:00:00.000Z',
            readBackupData: async () => ({ [AUTH_STORE_KEY]: authPayload() }),
            readRawIndexedEntries: async () => ({}),
            readLegacyLocalKeys: () => [],
            readRawAssetProfile: async () => ({ exists: false, rawJson: null }),
            purpose: 'local-auto',
        })

        expectSafeAuthProjection(envelope.stores[AUTH_STORE_KEY])
        expectSecretFree(envelope)
    })

    it('projects nested auth data in portable migration archives without mutating the local archive', () => {
        const source: CompositionMigrationSourceSnapshot = {
            serializedStores: {
                [AUTH_STORE_KEY]: JSON.stringify(authPayload()),
                'nais2-scenes': JSON.stringify({ version: 1, state: { presets: [] } }),
            },
            wildcardContent: {},
        }
        const localArchive = {
            format: 'nais2-composition-raw-migration-backup',
            schemaVersion: 1,
            snapshots: [{
                migrationId: 'migration:secret-redaction',
                createdAt: '2026-07-13T00:00:00.000Z',
                sourceHash: compositionMigrationSourceHash(source),
                sourceCounts: compositionMigrationSourceCounts(source),
                serializedStores: { ...source.serializedStores },
                wildcardContent: {},
            }],
        }
        const envelope = createBackupEnvelopeV3({
            [MIGRATION_BACKUP_STORE_KEY]: localArchive,
        }, {
            compositionDocument: typeFixtureDocument,
            createdAt: '2026-07-13T00:00:00.000Z',
            purpose: 'disk-auto',
        })
        const projectedArchive = envelope.stores[MIGRATION_BACKUP_STORE_KEY] as typeof localArchive
        const projectedSnapshot = projectedArchive.snapshots[0]
        const projectedSource: CompositionMigrationSourceSnapshot = {
            serializedStores: projectedSnapshot.serializedStores,
            wildcardContent: projectedSnapshot.wildcardContent,
        }

        expectSafeAuthProjection(JSON.parse(projectedSnapshot.serializedStores[AUTH_STORE_KEY]))
        expect(projectedSnapshot.sourceHash).toBe(compositionMigrationSourceHash(projectedSource))
        expect(projectedSnapshot.sourceCounts).toEqual(compositionMigrationSourceCounts(projectedSource))
        expectSecretFree(envelope)
        expect(localArchive.snapshots[0].serializedStores[AUTH_STORE_KEY]).toBe(source.serializedStores[AUTH_STORE_KEY])
    })

    it('sanitizes an old backup during dry-run and verified restore', async () => {
        const oldBackup = {
            _exportedAt: '2025-06-01T00:00:00.000Z',
            _version: '2.3',
            [AUTH_STORE_KEY]: authPayload(),
        }
        const prepared = prepareBackupRestore(oldBackup)

        expect(prepared.report.canRestore).toBe(true)
        expect(prepared.report.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'W_AUTH_CREDENTIAL_REENTRY_REQUIRED', key: AUTH_STORE_KEY }),
        ]))
        expectSafeAuthProjection(prepared.restorePayload[AUTH_STORE_KEY])
        expectSecretFree(prepared)

        const storage = new MemoryStorage()
        const restored = await restoreBackupToStorage(storage, oldBackup, { overwrite: true })
        expect(restored.failed).toEqual([])
        expectSafeAuthProjection(JSON.parse(storage.getItem(AUTH_STORE_KEY) ?? 'null'))
        expectSecretFree(restored)
    })

    it('verifies an old v3 manifest before sanitizing its auth restore payload', () => {
        const prepared = prepareBackupRestore(oldV3EnvelopeWithRawAuth())

        expect(prepared.report).toMatchObject({
            canRestore: true,
            manifestVerified: true,
            credentialReentryRequired: true,
        })
        expectSafeAuthProjection(prepared.restorePayload[AUTH_STORE_KEY])
        expectSecretFree(prepared)
    })

    it('sanitizes auth-only snapshot restore artifacts and reports credential re-entry', () => {
        const snapshot = createStoreSnapshotBackup(
            AUTH_STORE_KEY,
            authPayload(),
            '2026-07-13T00:00:00.000Z',
        )
        const prepared = prepareStoreSnapshotRestore(AUTH_STORE_KEY, snapshot)

        expectSafeAuthProjection(snapshot[AUTH_STORE_KEY])
        expectSecretFree(snapshot)
        expect(prepared.report.canRestore).toBe(true)
        expect(prepared.report.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'W_AUTH_CREDENTIAL_REENTRY_REQUIRED', key: AUTH_STORE_KEY }),
        ]))
        expectSafeAuthProjection(prepared.restorePayload[AUTH_STORE_KEY])
        expectSecretFree(prepared)
    })

    it('sanitizes legacy auth-only snapshots before restore', () => {
        const prepared = prepareStoreSnapshotRestore(AUTH_STORE_KEY, {
            _exportedAt: '2025-06-01T00:00:00.000Z',
            _version: 'store-snapshot/1',
            _kind: 'store-snapshot',
            _storeKey: AUTH_STORE_KEY,
            [AUTH_STORE_KEY]: authPayload(),
        })

        expect(prepared.report.canRestore).toBe(true)
        expectSafeAuthProjection(prepared.restorePayload[AUTH_STORE_KEY])
        expectSecretFree(prepared)
    })
})
