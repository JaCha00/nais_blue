import { describe, expect, it } from 'vitest'

import {
    CredentialVaultError,
    type CredentialKind,
    type CredentialRef,
    type CredentialVault,
} from '@/domain/credentials/types'
import {
    AUTH_MIGRATION_MARKER_KEY,
    AUTH_STORE_KEY,
    completeLegacyAuthMigration,
    inspectAuthPersistence,
    parseAuthStateV3,
    resumeInterruptedAuthMigration,
    type AuthMigrationStorage,
} from '@/services/credentials/auth-vault-migration'

const SLOT_1_SECRET = 'fixture-only-novelai-slot-one-1111'
const SLOT_2_SECRET = 'fixture-only-novelai-slot-two-2222'

function legacyAuthV2(): string {
    return JSON.stringify({
        version: 2,
        state: {
            token: SLOT_1_SECRET,
            token2: SLOT_2_SECRET,
            isVerified: true,
            isVerified2: true,
            tier: 'opus',
            tier2: 'tablet',
            slot1Enabled: true,
            slot2Enabled: false,
            anlas: { fixed: 1, purchased: 2, total: 3 },
            anlas2: { fixed: 4, purchased: 5, total: 9 },
        },
    })
}

function expectNoRuntimeSecretFields(raw: string): void {
    const parsed = JSON.parse(raw) as { version: number; state: Record<string, unknown> }
    expect(parsed.version).toBe(3)
    expect(parsed.state).not.toHaveProperty('token')
    expect(parsed.state).not.toHaveProperty('token2')
    expect(parsed.state).not.toHaveProperty('anlas')
    expect(parsed.state).not.toHaveProperty('anlas2')
    expect(parsed.state).not.toHaveProperty('sessionPlaintext')
    expect(raw).not.toContain(SLOT_1_SECRET)
    expect(raw).not.toContain(SLOT_2_SECRET)
}

class MemoryAuthStorage implements AuthMigrationStorage {
    readonly indexed = new Map<string, string>()
    readonly local = new Map<string, string>()
    failMarkerWriteOnce = false

    async getStrict(key: string): Promise<string | null> {
        return this.indexed.get(key) ?? null
    }

    async setStrict(key: string, value: string): Promise<void> {
        if (key === AUTH_MIGRATION_MARKER_KEY && this.failMarkerWriteOnce) {
            this.failMarkerWriteOnce = false
            throw new Error('fixture marker interruption')
        }
        this.indexed.set(key, value)
    }

    getLegacyLocalAuth(): string | null {
        return this.local.get(AUTH_STORE_KEY) ?? null
    }

    setLegacyLocalAuth(value: string): void {
        this.local.set(AUTH_STORE_KEY, value)
    }
}

class MemoryCredentialVault implements CredentialVault {
    private unlocked = false
    private readonly values = new Map<string, string>()
    private readonly metadata = new Map<string, CredentialRef>()
    failWriteForId: string | null = null
    getCount = 0

    async availability(): Promise<{ available: boolean; exists: boolean }> {
        return { available: true, exists: this.values.size > 0 }
    }

    async unlock(passphrase: string): Promise<{ created: boolean; metadata: CredentialRef[] }> {
        if (passphrase === 'wrong') {
            throw new CredentialVaultError('wrong-passphrase', 'Credential vault could not be unlocked.')
        }
        this.unlocked = true
        return { created: this.values.size === 0, metadata: await this.listMetadata() }
    }

    async lock(): Promise<void> {
        this.unlocked = false
    }

    isUnlocked(): boolean {
        return this.unlocked
    }

    async get(ref: CredentialRef): Promise<string | null> {
        if (!this.unlocked) throw new CredentialVaultError('locked', 'Credential vault is locked.')
        this.getCount += 1
        return this.values.get(ref.id) ?? null
    }

    async set(
        kind: CredentialKind,
        secret: string,
        options: { id?: string; existingRef?: CredentialRef | null; verifiedAt?: string } = {},
    ): Promise<CredentialRef> {
        if (!this.unlocked) throw new CredentialVaultError('locked', 'Credential vault is locked.')
        const id = options.id ?? options.existingRef?.id ?? `credential-${this.values.size + 1}`
        if (this.failWriteForId === id) throw new Error('fixture vault interruption')
        const timestamp = '2026-07-13T00:00:00.000Z'
        const ref: CredentialRef = {
            id,
            kind,
            lastFour: secret.slice(-4),
            createdAt: options.existingRef?.createdAt ?? timestamp,
            updatedAt: timestamp,
            ...(options.verifiedAt === undefined ? {} : { verifiedAt: options.verifiedAt }),
        }
        this.values.set(id, secret)
        this.metadata.set(id, ref)
        return ref
    }

    async delete(ref: CredentialRef): Promise<void> {
        if (!this.unlocked) throw new CredentialVaultError('locked', 'Credential vault is locked.')
        this.values.delete(ref.id)
        this.metadata.delete(ref.id)
    }

    async listMetadata(): Promise<CredentialRef[]> {
        if (!this.unlocked) throw new CredentialVaultError('locked', 'Credential vault is locked.')
        return [...this.metadata.values()]
    }
}

describe('AuthState v3 credential migration', () => {
    it('moves two legacy slots through vault write/readback before sanitizing both storage sources and recording completion', async () => {
        const storage = new MemoryAuthStorage()
        storage.indexed.set(AUTH_STORE_KEY, legacyAuthV2())
        storage.local.set(AUTH_STORE_KEY, legacyAuthV2())
        const vault = new MemoryCredentialVault()
        await vault.unlock('correct horse battery staple')

        const inspection = await inspectAuthPersistence(storage)
        expect(inspection.status).toBe('legacy-pending')
        expect(inspection.legacySecrets).toEqual({ slot1: SLOT_1_SECRET, slot2: SLOT_2_SECRET })

        const migrated = await completeLegacyAuthMigration({ storage, vault, inspection })
        expect(migrated.persisted.slot1CredentialRef).toMatchObject({
            id: 'novelai-slot-1',
            kind: 'novelai-token',
            lastFour: '1111',
        })
        expect(migrated.persisted.slot2CredentialRef).toMatchObject({
            id: 'novelai-slot-2',
            kind: 'novelai-token',
            lastFour: '2222',
        })
        expect(vault.getCount).toBeGreaterThanOrEqual(2)

        const indexedReadback = storage.indexed.get(AUTH_STORE_KEY)
        const localReadback = storage.local.get(AUTH_STORE_KEY)
        expect(indexedReadback).toBeDefined()
        expect(localReadback).toBeDefined()
        expectNoRuntimeSecretFields(indexedReadback!)
        expectNoRuntimeSecretFields(localReadback!)
        expect(storage.indexed.get(AUTH_MIGRATION_MARKER_KEY)).toContain('"authVersion":3')
    })

    it('leaves the legacy payload and marker untouched when the vault becomes unavailable mid-migration, then safely retries', async () => {
        const storage = new MemoryAuthStorage()
        const original = legacyAuthV2()
        storage.indexed.set(AUTH_STORE_KEY, original)
        const vault = new MemoryCredentialVault()
        await vault.unlock('passphrase')
        vault.failWriteForId = 'novelai-slot-2'

        const firstInspection = await inspectAuthPersistence(storage)
        await expect(completeLegacyAuthMigration({ storage, vault, inspection: firstInspection }))
            .rejects.toThrow('fixture vault interruption')
        expect(storage.indexed.get(AUTH_STORE_KEY)).toBe(original)
        expect(storage.indexed.has(AUTH_MIGRATION_MARKER_KEY)).toBe(false)

        vault.failWriteForId = null
        const retryInspection = await inspectAuthPersistence(storage)
        await completeLegacyAuthMigration({ storage, vault, inspection: retryInspection })
        expectNoRuntimeSecretFields(storage.indexed.get(AUTH_STORE_KEY)!)
        expect(storage.indexed.has(AUTH_MIGRATION_MARKER_KEY)).toBe(true)
    })

    it('resumes after sanitized v3 was committed but the completion marker write was interrupted', async () => {
        const storage = new MemoryAuthStorage()
        storage.indexed.set(AUTH_STORE_KEY, legacyAuthV2())
        storage.failMarkerWriteOnce = true
        const vault = new MemoryCredentialVault()
        await vault.unlock('passphrase')

        await expect(completeLegacyAuthMigration({
            storage,
            vault,
            inspection: await inspectAuthPersistence(storage),
        })).rejects.toThrow('fixture marker interruption')
        expectNoRuntimeSecretFields(storage.indexed.get(AUTH_STORE_KEY)!)
        expect(storage.indexed.has(AUTH_MIGRATION_MARKER_KEY)).toBe(false)

        const interrupted = await inspectAuthPersistence(storage)
        expect(interrupted.status).toBe('v3-verification-pending')
        await resumeInterruptedAuthMigration({ storage, vault, inspection: interrupted })
        expect(storage.indexed.has(AUTH_MIGRATION_MARKER_KEY)).toBe(true)
    })

    it('does not sanitize persisted auth when the vault is unavailable', async () => {
        const storage = new MemoryAuthStorage()
        const original = legacyAuthV2()
        storage.indexed.set(AUTH_STORE_KEY, original)
        const unavailable: CredentialVault = {
            availability: async () => ({ available: false, exists: false }),
            unlock: async () => { throw new CredentialVaultError('unavailable', 'Credential vault is unavailable.') },
            lock: async () => undefined,
            isUnlocked: () => false,
            get: async () => { throw new CredentialVaultError('unavailable', 'Credential vault is unavailable.') },
            set: async () => { throw new CredentialVaultError('unavailable', 'Credential vault is unavailable.') },
            delete: async () => { throw new CredentialVaultError('unavailable', 'Credential vault is unavailable.') },
            listMetadata: async () => { throw new CredentialVaultError('unavailable', 'Credential vault is unavailable.') },
        }

        await expect(unavailable.unlock('passphrase')).rejects.toMatchObject({ code: 'unavailable' })
        expect(storage.indexed.get(AUTH_STORE_KEY)).toBe(original)
        expect(storage.indexed.has(AUTH_MIGRATION_MARKER_KEY)).toBe(false)
    })

    it('removes a secret and verifies that it is no longer readable', async () => {
        const vault = new MemoryCredentialVault()
        await vault.unlock('passphrase')
        const ref = await vault.set('novelai-token', SLOT_1_SECRET, { id: 'novelai-slot-1' })
        expect(await vault.get(ref)).toBe(SLOT_1_SECRET)
        await vault.delete(ref)
        expect(await vault.get(ref)).toBeNull()
        expect(await vault.listMetadata()).toEqual([])
    })

    it('classifies a wrong passphrase without exposing it in the error', async () => {
        const vault = new MemoryCredentialVault()
        await expect(vault.unlock('wrong')).rejects.toMatchObject({ code: 'wrong-passphrase' })
        await expect(vault.unlock('wrong')).rejects.not.toThrow(/wrong/)
    })

    it('does not accept R2 or arbitrary vault references as NovelAI auth slots', () => {
        const timestamp = '2026-07-13T00:00:00.000Z'
        const parsed = parseAuthStateV3(JSON.stringify({
            version: 3,
            state: {
                slot1CredentialRef: {
                    id: 'novelai-slot-1',
                    kind: 'r2-secret-key',
                    lastFour: '1111',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                slot2CredentialRef: {
                    id: 'arbitrary-ref',
                    kind: 'novelai-token',
                    lastFour: '2222',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                slot1Enabled: true,
                slot2Enabled: true,
                tier: null,
                tier2: null,
            },
        }))

        expect(parsed.slot1CredentialRef).toBeNull()
        expect(parsed.slot2CredentialRef).toBeNull()
    })
})
