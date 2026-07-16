import type {
    CredentialRef,
    CredentialVault,
} from '@/domain/credentials/types'
import { SyncTransportError } from '@/domain/sync/transport'

export const PAIRING_MIN_TTL_SECONDS = 30
export const PAIRING_MAX_TTL_SECONDS = 120

export interface PairingInvitation {
    readonly invitation: string
    readonly confirmationCode: string
    readonly expiresAt: string
}

export interface StoredPairingInvitation extends PairingInvitation {
    /** Vault reference for the short-lived capability; the UI/runtime must discard it on close/expiry. */
    readonly credentialRef: CredentialRef
}

interface NativeAcceptedPairing {
    readonly peerId: string
    readonly displayName: string
    /** PKCS#8 key, signed client certificate, and pinned CA; never persisted outside the vault. */
    readonly credentialBundle: string
    readonly certificateFingerprint: string
}

export interface NativePairingAdapter {
    createInvitation(input: {
        readonly expiresInSeconds: number
    }): Promise<PairingInvitation>
    closePairing(): Promise<void>
    acceptInvitation(input: {
        readonly invitation: string
        readonly confirmationCode: string
        readonly displayName: string
        readonly clientRef: string
        readonly signal?: AbortSignal
    }): Promise<NativeAcceptedPairing>
    /** Authenticated self-revoke uses the issued/vaulted bundle; host-local administration is separate. */
    revokeIssuedPeer(input: {
        readonly clientRef: string
        readonly credentialBundle: string
    }): Promise<void>
}

export interface PairedSyncPeer {
    readonly peerId: string
    readonly clientRef: string
    readonly displayName: string
    readonly certificateFingerprint: string
    readonly credentialRef: CredentialRef
}

export interface StoredSyncClientIdentity {
    readonly clientRef: string
    readonly credentialRef: CredentialRef
}

function assertPairingInput(value: string, field: string, maxLength: number): void {
    if (value.trim().length === 0 || value.length > maxLength || /[\0\r\n]/.test(value)) {
        throw new TypeError(`${field} is invalid.`)
    }
}

function validateInvitation(value: PairingInvitation): PairingInvitation {
    assertPairingInput(value.invitation, 'invitation', 16_384)
    if (!/^\d{6}$/.test(value.confirmationCode)) throw new TypeError('Native confirmationCode is invalid.')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.expiresAt)
        || !Number.isFinite(Date.parse(value.expiresAt))) {
        throw new TypeError('Native pairing expiry is invalid.')
    }
    return value
}

function validateAcceptedPairing(value: NativeAcceptedPairing, requestedName: string): NativeAcceptedPairing {
    assertPairingInput(value.peerId, 'peerId', 512)
    assertPairingInput(value.displayName, 'displayName', 96)
    if (value.displayName !== requestedName) throw new TypeError('Native paired device identity is inconsistent.')
    if (!/^sha256:[a-f0-9]{64}$/i.test(value.certificateFingerprint)) {
        throw new TypeError('Native certificate fingerprint is invalid.')
    }
    if (typeof value.credentialBundle !== 'string'
        || value.credentialBundle.length < 4
        || value.credentialBundle.length > 262_144) {
        throw new TypeError('Native pairing credential bundle is invalid.')
    }
    return value
}

/**
 * Joins native certificate pairing to Stronghold. The adapter owns audited TLS
 * and CSR work; this service guarantees the returned private bundle is stored
 * before any non-secret peer metadata escapes to UI/runtime callers.
 */
export class PairingService {
    constructor(
        private readonly vault: CredentialVault,
        private readonly native: NativePairingAdapter,
    ) {}

    async createInvitation(expiresInSeconds = PAIRING_MAX_TTL_SECONDS): Promise<StoredPairingInvitation> {
        if (!Number.isSafeInteger(expiresInSeconds)
            || expiresInSeconds < PAIRING_MIN_TTL_SECONDS
            || expiresInSeconds > PAIRING_MAX_TTL_SECONDS) {
            throw new TypeError('Pairing expiry must be between 30 and 120 seconds.')
        }
        if (!this.vault.isUnlocked()) throw new Error('Credential Vault must be unlocked before pairing.')
        const invitation = validateInvitation(await this.native.createInvitation({ expiresInSeconds }))
        try {
            const credentialRef = await this.vault.set('sync-pairing-secret', invitation.invitation)
            return { ...invitation, credentialRef }
        } catch (error) {
            await this.native.closePairing().catch(() => undefined)
            throw error
        }
    }

    async discardInvitation(credentialRef: CredentialRef): Promise<void> {
        try {
            await this.native.closePairing()
        } finally {
            await this.vault.delete(credentialRef)
        }
    }

    async acceptInvitation(input: {
        readonly invitation: string
        readonly confirmationCode: string
        readonly displayName: string
        readonly signal?: AbortSignal
    }): Promise<PairedSyncPeer> {
        if (!this.vault.isUnlocked()) throw new Error('Credential Vault must be unlocked before pairing.')
        assertPairingInput(input.invitation, 'invitation', 16_384)
        if (!/^\d{6}$/.test(input.confirmationCode)) throw new TypeError('confirmationCode is invalid.')
        assertPairingInput(input.displayName, 'displayName', 96)
        const clientRef = crypto.randomUUID()
        const accepted = validateAcceptedPairing(
            await this.native.acceptInvitation({ ...input, clientRef }),
            input.displayName,
        )
        let credentialRef: CredentialRef
        try {
            credentialRef = await this.vault.set('sync-peer-identity', accepted.credentialBundle, {
                id: `sync-peer:${clientRef}`,
            })
        } catch (error) {
            // The host has issued a valid certificate; fail closed if its private half was not vaulted.
            await this.native.revokeIssuedPeer({
                clientRef,
                credentialBundle: accepted.credentialBundle,
            }).catch(() => undefined)
            throw error
        }
        return {
            peerId: accepted.peerId,
            clientRef,
            displayName: accepted.displayName,
            certificateFingerprint: accepted.certificateFingerprint,
            credentialRef,
        }
    }

    async revoke(input: {
        readonly clientRef: string
        readonly credentialRef: CredentialRef
    }): Promise<void> {
        if (!/^[a-f0-9-]{36}$/i.test(input.clientRef)) throw new TypeError('clientRef is invalid.')
        const credentialBundle = await this.vault.get(input.credentialRef)
        if (credentialBundle === null) throw new Error('The paired device identity is missing from Credential Vault.')
        // Revoke host admission first; deleting the only client key cannot substitute for host revoke.
        try {
            await this.native.revokeIssuedPeer({
                clientRef: input.clientRef,
                credentialBundle,
            })
        } catch (error) {
            // A lost success response must not leave an already-revoked identity undeletable on retry.
            if (!(error instanceof SyncTransportError)
                || (error.code !== 'E_SYNC_UNPAIRED' && error.code !== 'E_SYNC_REVOKED')) throw error
        }
        await this.vault.delete(input.credentialRef)
    }

    async listClientIdentities(): Promise<StoredSyncClientIdentity[]> {
        if (!this.vault.isUnlocked()) throw new Error('Credential Vault must be unlocked before listing paired devices.')
        return (await this.vault.listMetadata())
            .filter(ref => ref.kind === 'sync-peer-identity' && ref.id.startsWith('sync-peer:'))
            .map(credentialRef => ({
                clientRef: credentialRef.id.slice('sync-peer:'.length),
                credentialRef,
            }))
            .filter(item => /^[a-f0-9-]{36}$/i.test(item.clientRef))
            .sort((left, right) => left.clientRef.localeCompare(right.clientRef))
    }
}
