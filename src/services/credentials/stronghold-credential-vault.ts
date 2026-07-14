import { isTauri } from '@tauri-apps/api/core'
import { appDataDir, BaseDirectory, join } from '@tauri-apps/api/path'
import { exists } from '@tauri-apps/plugin-fs'
import { Stronghold, type Store } from '@tauri-apps/plugin-stronghold'

import {
    CredentialVaultError,
    isCredentialKind,
    type CredentialKind,
    type CredentialRef,
    type CredentialVault,
    type CredentialVaultSetOptions,
    type CredentialVaultUnlockResult,
} from '@/domain/credentials/types'

const SNAPSHOT_FILE = 'nais2-credentials-v1.hold'
const CLIENT_NAME = 'nais2-credential-vault'
const METADATA_KEY = 'credential-metadata-v1'
const CREDENTIAL_KEY_PREFIX = 'credential:'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function credentialKey(id: string): string {
    return `${CREDENTIAL_KEY_PREFIX}${id}`
}

function safeError(code: ConstructorParameters<typeof CredentialVaultError>[0]): CredentialVaultError {
    const messages = {
        unavailable: 'Credential vault is unavailable in this runtime.',
        locked: 'Credential vault is locked.',
        'wrong-passphrase': 'Credential vault could not be unlocked.',
        'invalid-secret': 'Credential input is invalid.',
        'not-found': 'Credential was not found.',
        'readback-failed': 'Credential vault verification failed.',
        'operation-failed': 'Credential vault operation failed.',
    } as const
    return new CredentialVaultError(code, messages[code])
}

function normalizeTimestamp(value: unknown): string | null {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function parseCredentialRef(value: unknown): CredentialRef | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const createdAt = normalizeTimestamp(record.createdAt)
    const updatedAt = normalizeTimestamp(record.updatedAt)
    const verifiedAt = normalizeTimestamp(record.verifiedAt)
    if (typeof record.id !== 'string'
        || !/^[a-z0-9:_-]{1,96}$/i.test(record.id)
        || !isCredentialKind(record.kind)
        || typeof record.lastFour !== 'string'
        || record.lastFour.length !== 4
        || createdAt === null
        || updatedAt === null) {
        return null
    }
    return {
        id: record.id,
        kind: record.kind,
        lastFour: record.lastFour,
        createdAt,
        updatedAt,
        ...(verifiedAt === null ? {} : { verifiedAt }),
    }
}

function parseMetadata(value: Uint8Array | null): CredentialRef[] {
    if (value === null) return []
    let parsed: unknown
    try {
        parsed = JSON.parse(decoder.decode(value)) as unknown
    } catch {
        throw safeError('operation-failed')
    }
    if (!Array.isArray(parsed)) throw safeError('operation-failed')
    const refs = parsed.map(parseCredentialRef)
    if (refs.some(ref => ref === null)) throw safeError('operation-failed')
    const normalized = refs as CredentialRef[]
    if (new Set(normalized.map(ref => ref.id)).size !== normalized.length) {
        throw safeError('operation-failed')
    }
    return normalized
}

function cloneRefs(refs: readonly CredentialRef[]): CredentialRef[] {
    return refs.map(ref => ({ ...ref }))
}

export class StrongholdCredentialVault implements CredentialVault {
    private stronghold: Stronghold | null = null
    private store: Store | null = null
    private metadata: CredentialRef[] = []

    private async snapshotPath(): Promise<string> {
        return join(await appDataDir(), SNAPSHOT_FILE)
    }

    async availability(): Promise<{ available: boolean; exists: boolean }> {
        if (!isTauri()) return { available: false, exists: false }
        try {
            return {
                available: true,
                exists: await exists(SNAPSHOT_FILE, { baseDir: BaseDirectory.AppData }),
            }
        } catch {
            return { available: false, exists: false }
        }
    }

    async unlock(passphrase: string): Promise<CredentialVaultUnlockResult> {
        if (passphrase.length === 0) throw safeError('invalid-secret')
        const availability = await this.availability()
        if (!availability.available) throw safeError('unavailable')

        let stronghold: Stronghold
        try {
            stronghold = await Stronghold.load(await this.snapshotPath(), passphrase)
        } catch {
            throw safeError(availability.exists ? 'wrong-passphrase' : 'operation-failed')
        }

        try {
            let client
            try {
                client = await stronghold.loadClient(CLIENT_NAME)
            } catch {
                client = await stronghold.createClient(CLIENT_NAME)
            }
            const store = client.getStore()
            const metadata = parseMetadata(await store.get(METADATA_KEY))
            this.stronghold = stronghold
            this.store = store
            this.metadata = metadata
            if (!availability.exists) await stronghold.save()
            return { created: !availability.exists, metadata: cloneRefs(metadata) }
        } catch (error) {
            await stronghold.unload().catch(() => undefined)
            if (error instanceof CredentialVaultError) throw error
            throw safeError('operation-failed')
        }
    }

    async lock(): Promise<void> {
        const stronghold = this.stronghold
        this.stronghold = null
        this.store = null
        this.metadata = []
        if (stronghold !== null) {
            try {
                await stronghold.unload()
            } catch {
                throw safeError('operation-failed')
            }
        }
    }

    isUnlocked(): boolean {
        return this.stronghold !== null && this.store !== null
    }

    private unlocked(): { stronghold: Stronghold; store: Store } {
        if (this.stronghold === null || this.store === null) throw safeError('locked')
        return { stronghold: this.stronghold, store: this.store }
    }

    async get(ref: CredentialRef): Promise<string | null> {
        const { store } = this.unlocked()
        try {
            const value = await store.get(credentialKey(ref.id))
            return value === null ? null : decoder.decode(value)
        } catch {
            throw safeError('operation-failed')
        }
    }

    async set(
        kind: CredentialKind,
        secret: string,
        options: CredentialVaultSetOptions = {},
    ): Promise<CredentialRef> {
        const { stronghold, store } = this.unlocked()
        const normalizedSecret = secret.trim()
        const id = options.id ?? options.existingRef?.id ?? crypto.randomUUID()
        if (!isCredentialKind(kind)
            || normalizedSecret.length < 4
            || !/^[a-z0-9:_-]{1,96}$/i.test(id)
            || (options.existingRef !== null
                && options.existingRef !== undefined
                && options.existingRef.kind !== kind)) {
            throw safeError('invalid-secret')
        }

        const now = new Date().toISOString()
        const ref: CredentialRef = {
            id,
            kind,
            lastFour: normalizedSecret.slice(-4),
            createdAt: options.existingRef?.createdAt ?? now,
            updatedAt: now,
            ...(options.verifiedAt === undefined ? {} : { verifiedAt: options.verifiedAt }),
        }
        const nextMetadata = [
            ...this.metadata.filter(item => item.id !== id),
            ref,
        ].sort((left, right) => left.id.localeCompare(right.id))

        try {
            await store.insert(credentialKey(id), Array.from(encoder.encode(normalizedSecret)))
            await store.insert(METADATA_KEY, Array.from(encoder.encode(JSON.stringify(nextMetadata))))
            await stronghold.save()
            const readback = await store.get(credentialKey(id))
            if (readback === null || decoder.decode(readback) !== normalizedSecret) {
                throw safeError('readback-failed')
            }
            this.metadata = nextMetadata
            return { ...ref }
        } catch (error) {
            if (error instanceof CredentialVaultError) throw error
            throw safeError('operation-failed')
        }
    }

    async delete(ref: CredentialRef): Promise<void> {
        const { stronghold, store } = this.unlocked()
        const nextMetadata = this.metadata.filter(item => item.id !== ref.id)
        try {
            await store.insert(credentialKey(ref.id), [])
            await store.remove(credentialKey(ref.id))
            await store.insert(METADATA_KEY, Array.from(encoder.encode(JSON.stringify(nextMetadata))))
            await stronghold.save()
            if (await store.get(credentialKey(ref.id)) !== null) throw safeError('readback-failed')
            this.metadata = nextMetadata
        } catch (error) {
            if (error instanceof CredentialVaultError) throw error
            throw safeError('operation-failed')
        }
    }

    async listMetadata(): Promise<CredentialRef[]> {
        this.unlocked()
        return cloneRefs(this.metadata)
    }
}

let runtimeVault: CredentialVault | null = null

export function getRuntimeCredentialVault(): CredentialVault {
    runtimeVault ??= new StrongholdCredentialVault()
    return runtimeVault
}
