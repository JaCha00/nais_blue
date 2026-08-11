import { invoke } from '@tauri-apps/api/core'

import {
    CredentialVaultError,
    type CredentialKind,
    type CredentialRef,
    type CredentialVault,
    type CredentialVaultAvailability,
    type CredentialVaultSetOptions,
    type CredentialVaultUnlockResult,
} from '@/domain/credentials/types'
import { runtimeCapabilities } from '@/platform/capabilities'

const SLOT_IDS = ['novelai-slot-1', 'novelai-slot-2'] as const
const MAX_TOKEN_BYTES = 16 * 1024

type NovelAiSlotId = typeof SLOT_IDS[number]

interface NativeCredentialStatus {
    credentialRef: string
    available: boolean
}

interface NativeCredentialErrorShape {
    code?: unknown
    message?: unknown
}

export interface NovelAiCredentialVaultBindings {
    isNative(): boolean
    invoke<T>(command: string, args: Record<string, unknown>): Promise<T>
}

const runtimeBindings: NovelAiCredentialVaultBindings = {
    isNative: () => runtimeCapabilities.novelAiCredentialVault.supported,
    invoke,
}

function isSlotId(value: unknown): value is NovelAiSlotId {
    return typeof value === 'string' && (SLOT_IDS as readonly string[]).includes(value)
}

function safeVaultError(error: unknown): CredentialVaultError {
    if (error instanceof CredentialVaultError) return error
    const code = error && typeof error === 'object'
        ? (error as NativeCredentialErrorShape).code
        : null
    if (code === 'E_NOVELAI_VAULT_UNSUPPORTED' || code === 'E_NOVELAI_VAULT_UNAVAILABLE') {
        return new CredentialVaultError('unavailable', 'The operating-system credential vault is unavailable.')
    }
    if (code === 'E_NOVELAI_VAULT_SECRET' || code === 'E_NOVELAI_VAULT_REF') {
        return new CredentialVaultError('invalid-secret', 'The NovelAI credential is invalid.')
    }
    return new CredentialVaultError('operation-failed', 'The operating-system credential operation failed.')
}

/**
 * Desktop secrets live in the OS credential vault. Browser builds retain them
 * only in this process so local UI tests work without persisting plaintext.
 */
export class NativeNovelAiCredentialVault implements CredentialVault {
    private unlocked = false
    private readonly browserSecrets = new Map<NovelAiSlotId, string>()
    private readonly metadata = new Map<NovelAiSlotId, CredentialRef>()

    constructor(
        private readonly bindings: NovelAiCredentialVaultBindings = runtimeBindings,
        private readonly now: () => Date = () => new Date(),
    ) {}

    async availability(): Promise<CredentialVaultAvailability> {
        if (!this.bindings.isNative()) {
            return { available: true, exists: this.browserSecrets.size > 0 }
        }
        try {
            const statuses = await Promise.all(SLOT_IDS.map(credentialRef => (
                this.bindings.invoke<NativeCredentialStatus>('novelai_credential_status', { credentialRef })
            )))
            return { available: true, exists: statuses.some(status => status.available) }
        } catch (error) {
            throw safeVaultError(error)
        }
    }

    async unlock(_passphrase: string): Promise<CredentialVaultUnlockResult> {
        const availability = await this.availability()
        this.unlocked = true
        return {
            created: !availability.exists,
            metadata: await this.listMetadata(),
        }
    }

    async lock(): Promise<void> {
        this.unlocked = false
        this.browserSecrets.clear()
        this.metadata.clear()
    }

    isUnlocked(): boolean {
        return this.unlocked
    }

    async get(ref: CredentialRef): Promise<string | null> {
        const id = this.requireRef(ref)
        this.requireUnlocked()
        if (!this.bindings.isNative()) return this.browserSecrets.get(id) ?? null
        try {
            return await this.bindings.invoke<string | null>('novelai_load_credential', {
                credentialRef: id,
            })
        } catch (error) {
            throw safeVaultError(error)
        }
    }

    async set(
        kind: CredentialKind,
        secret: string,
        options: CredentialVaultSetOptions = {},
    ): Promise<CredentialRef> {
        this.requireUnlocked()
        const id = options.id ?? options.existingRef?.id
        if (kind !== 'novelai-token' || !isSlotId(id)) {
            throw new CredentialVaultError('invalid-secret', 'The NovelAI credential slot is invalid.')
        }
        if (options.existingRef !== undefined && options.existingRef !== null) {
            this.requireRef(options.existingRef)
            if (options.existingRef.id !== id) {
                throw new CredentialVaultError('invalid-secret', 'The NovelAI credential slot is invalid.')
            }
        }
        const normalized = secret.trim()
        const byteLength = new TextEncoder().encode(normalized).byteLength
        if (byteLength < 4 || byteLength > MAX_TOKEN_BYTES) {
            throw new CredentialVaultError('invalid-secret', 'The NovelAI credential is invalid.')
        }

        if (this.bindings.isNative()) {
            try {
                await this.bindings.invoke<NativeCredentialStatus>('novelai_store_credential', {
                    credentialRef: id,
                    token: normalized,
                })
            } catch (error) {
                throw safeVaultError(error)
            }
        } else {
            this.browserSecrets.set(id, normalized)
        }

        const timestamp = this.now().toISOString()
        const ref: CredentialRef = {
            id,
            kind,
            lastFour: normalized.slice(-4),
            createdAt: options.existingRef?.createdAt ?? timestamp,
            updatedAt: timestamp,
            ...(options.verifiedAt === undefined ? {} : { verifiedAt: options.verifiedAt }),
        }
        this.metadata.set(id, ref)
        return ref
    }

    async delete(ref: CredentialRef): Promise<void> {
        const id = this.requireRef(ref)
        this.requireUnlocked()
        if (this.bindings.isNative()) {
            try {
                await this.bindings.invoke<void>('novelai_delete_credential', { credentialRef: id })
            } catch (error) {
                throw safeVaultError(error)
            }
        } else {
            this.browserSecrets.delete(id)
        }
        this.metadata.delete(id)
    }

    async listMetadata(): Promise<CredentialRef[]> {
        this.requireUnlocked()
        return SLOT_IDS.flatMap(id => {
            const ref = this.metadata.get(id)
            return ref === undefined ? [] : [ref]
        })
    }

    private requireUnlocked(): void {
        if (!this.unlocked) throw new CredentialVaultError('locked', 'The credential vault is locked.')
    }

    private requireRef(ref: CredentialRef): NovelAiSlotId {
        if (ref.kind !== 'novelai-token' || !isSlotId(ref.id)) {
            throw new CredentialVaultError('invalid-secret', 'The NovelAI credential reference is invalid.')
        }
        return ref.id
    }
}

const runtimeVault = new NativeNovelAiCredentialVault()

export function getRuntimeCredentialVault(): CredentialVault {
    return runtimeVault
}
