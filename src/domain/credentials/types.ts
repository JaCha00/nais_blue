export const CREDENTIAL_KINDS = [
    'novelai-token',
    'r2-access-key',
    'r2-secret-key',
] as const

export type CredentialKind = typeof CREDENTIAL_KINDS[number]

/**
 * Persistable, non-secret identity for one encrypted credential. The final
 * four characters are intentionally the only secret-derived display value.
 */
export interface CredentialRef {
    id: string
    kind: CredentialKind
    lastFour: string
    createdAt: string
    updatedAt: string
    verifiedAt?: string
}

export type CredentialVaultErrorCode =
    | 'unavailable'
    | 'locked'
    | 'wrong-passphrase'
    | 'invalid-secret'
    | 'not-found'
    | 'readback-failed'
    | 'operation-failed'

export class CredentialVaultError extends Error {
    constructor(
        readonly code: CredentialVaultErrorCode,
        message: string,
    ) {
        super(message)
        this.name = 'CredentialVaultError'
    }
}

export interface CredentialVaultAvailability {
    available: boolean
    exists: boolean
}

export interface CredentialVaultUnlockResult {
    created: boolean
    metadata: CredentialRef[]
}

export interface CredentialVaultSetOptions {
    id?: string
    existingRef?: CredentialRef | null
    verifiedAt?: string
}

/**
 * Backend-neutral credential boundary. Implementations may expose plaintext
 * only from get() while unlocked; callers must keep it in session memory.
 */
export interface CredentialVault {
    availability(): Promise<CredentialVaultAvailability>
    unlock(passphrase: string): Promise<CredentialVaultUnlockResult>
    lock(): Promise<void>
    isUnlocked(): boolean
    get(ref: CredentialRef): Promise<string | null>
    set(kind: CredentialKind, secret: string, options?: CredentialVaultSetOptions): Promise<CredentialRef>
    delete(ref: CredentialRef): Promise<void>
    listMetadata(): Promise<CredentialRef[]>
}

export function isCredentialKind(value: unknown): value is CredentialKind {
    return typeof value === 'string' && (CREDENTIAL_KINDS as readonly string[]).includes(value)
}
