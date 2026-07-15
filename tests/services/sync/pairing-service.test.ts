import { describe, expect, it } from 'vitest'

import type {
    CredentialKind,
    CredentialRef,
    CredentialVault,
} from '@/domain/credentials/types'
import { SyncTransportError } from '@/domain/sync/transport'
import {
    PairingService,
    type NativePairingAdapter,
} from '@/services/sync/pairing-service'

class MemoryVault implements CredentialVault {
    stored: Array<{ kind: CredentialKind; secret: string }> = []
    deleted: CredentialRef[] = []
    refs: CredentialRef[] = []

    async availability() { return { available: true, exists: true } }
    async unlock() { return { created: false, metadata: this.refs } }
    async lock() {}
    isUnlocked() { return true }
    async get(ref: CredentialRef) { return this.refs.some(item => item.id === ref.id) ? 'stored-secret' : null }
    async set(kind: CredentialKind, secret: string, options?: { id?: string }): Promise<CredentialRef> {
        this.stored.push({ kind, secret })
        const ref: CredentialRef = {
            id: options?.id ?? `credential:${this.refs.length + 1}`,
            kind,
            lastFour: secret.slice(-4),
            createdAt: '2026-07-15T00:00:00.000Z',
            updatedAt: '2026-07-15T00:00:00.000Z',
        }
        this.refs.push(ref)
        return ref
    }
    async delete(ref: CredentialRef) { this.deleted.push(ref); this.refs = this.refs.filter(item => item.id !== ref.id) }
    async listMetadata() { return this.refs }
}

function nativeAdapter(): NativePairingAdapter {
    return {
        async createInvitation() {
            return {
                invitation: 'nais-sync-v1:redacted-test-invitation',
                confirmationCode: '482913',
                expiresAt: '2026-07-15T00:02:00.000Z',
            }
        },
        async closePairing() {},
        async acceptInvitation() {
            return {
                peerId: 'peer:desktop',
                displayName: 'Android',
                credentialBundle: 'private-client-key-and-certificate',
                certificateFingerprint: `sha256:${'a'.repeat(64)}`,
            }
        },
        async revokeIssuedPeer() {},
    }
}

describe('PairingService', () => {
    it('vaults the short-lived host pairing capability until it is consumed or expires', async () => {
        const vault = new MemoryVault()
        const service = new PairingService(vault, nativeAdapter())

        const invitation = await service.createInvitation(120)
        expect(vault.stored).toEqual([{
            kind: 'sync-pairing-secret',
            secret: 'nais-sync-v1:redacted-test-invitation',
        }])
        await service.discardInvitation(invitation.credentialRef)
        expect(vault.deleted).toEqual([invitation.credentialRef])
    })

    it('closes an opened native invitation when vault persistence fails', async () => {
        const vault = new MemoryVault()
        vault.set = async () => { throw new Error('vault write failed') }
        const adapter = nativeAdapter()
        let closed = false
        adapter.closePairing = async () => { closed = true }

        await expect(new PairingService(vault, adapter).createInvitation())
            .rejects.toThrow('vault write failed')
        expect(closed).toBe(true)
    })

    it('stores the paired mTLS identity in Credential Vault and returns metadata only', async () => {
        const vault = new MemoryVault()
        const service = new PairingService(vault, nativeAdapter())

        const peer = await service.acceptInvitation({
            invitation: 'nais-sync-v1:redacted-test-invitation',
            confirmationCode: '482913',
            displayName: 'Android',
        })

        expect(vault.stored).toEqual([{
            kind: 'sync-peer-identity',
            secret: 'private-client-key-and-certificate',
        }])
        expect(peer).toMatchObject({ peerId: 'peer:desktop', credentialRef: vault.refs[0] })
        expect(peer).not.toHaveProperty('credentialBundle')
        await expect(new PairingService(vault, nativeAdapter()).listClientIdentities())
            .resolves.toEqual([{ clientRef: peer.clientRef, credentialRef: peer.credentialRef }])
    })

    it('does not create a credential after an expired invitation', async () => {
        const vault = new MemoryVault()
        const adapter = nativeAdapter()
        adapter.acceptInvitation = async () => {
            throw new SyncTransportError('E_SYNC_PAIRING_EXPIRED', 'Pairing invitation expired.', false)
        }

        await expect(new PairingService(vault, adapter).acceptInvitation({
            invitation: 'nais-sync-v1:expired',
            confirmationCode: '482913',
            displayName: 'Android',
        })).rejects.toMatchObject({ code: 'E_SYNC_PAIRING_EXPIRED' })
        expect(vault.stored).toEqual([])
    })

    it('revokes an issued certificate when vault persistence fails', async () => {
        const vault = new MemoryVault()
        vault.set = async () => { throw new Error('vault write failed') }
        const revoked: string[] = []
        const adapter = nativeAdapter()
        adapter.revokeIssuedPeer = async ({ credentialBundle }) => { revoked.push(credentialBundle) }

        await expect(new PairingService(vault, adapter).acceptInvitation({
            invitation: 'nais-sync-v1:redacted-test-invitation',
            confirmationCode: '482913',
            displayName: 'Android',
        })).rejects.toThrow('vault write failed')
        expect(revoked).toEqual(['private-client-key-and-certificate'])
    })

    it('revokes the native certificate before deleting its vault identity', async () => {
        const events: string[] = []
        const vault = new MemoryVault()
        const ref = await vault.set('sync-peer-identity', 'private-client-key-and-certificate')
        vault.delete = async credential => { events.push(`vault:${credential.id}`) }
        const adapter = nativeAdapter()
        adapter.revokeIssuedPeer = async ({ clientRef, credentialBundle }) => {
            events.push(`native:${clientRef}:${credentialBundle}`)
        }

        const clientRef = '123e4567-e89b-12d3-a456-426614174000'
        await new PairingService(vault, adapter).revoke({ clientRef, credentialRef: ref })

        expect(events).toEqual([`native:${clientRef}:stored-secret`, `vault:${ref.id}`])
    })

    it('treats an already-revoked remote identity as idempotent cleanup', async () => {
        const vault = new MemoryVault()
        const ref = await vault.set('sync-peer-identity', 'private-client-key-and-certificate')
        const adapter = nativeAdapter()
        adapter.revokeIssuedPeer = async () => {
            throw new SyncTransportError('E_SYNC_REVOKED', 'Already revoked.', false)
        }

        await expect(new PairingService(vault, adapter).revoke({
            clientRef: '123e4567-e89b-12d3-a456-426614174000',
            credentialRef: ref,
        })).resolves.toBeUndefined()
        expect(vault.deleted).toEqual([ref])
    })
})
