import { describe, expect, it } from 'vitest'

import type {
    CredentialKind,
    CredentialRef,
    CredentialVault,
} from '@/domain/credentials/types'
import {
    LanAgentService,
    type NativeLanAgentAdapter,
} from '@/services/sync/lan-agent-service'

class AgentVault implements CredentialVault {
    unlocked = true
    refs: CredentialRef[] = []
    secrets = new Map<string, string>()

    async availability() { return { available: true, exists: true } }
    async unlock() { this.unlocked = true; return { created: false, metadata: this.refs } }
    async lock() { this.unlocked = false }
    isUnlocked() { return this.unlocked }
    async get(ref: CredentialRef) { return this.secrets.get(ref.id) ?? null }
    async set(kind: CredentialKind, secret: string): Promise<CredentialRef> {
        const ref: CredentialRef = {
            id: `ref:${this.refs.length}`,
            kind,
            lastFour: secret.slice(-4),
            createdAt: '2026-07-15T00:00:00.000Z',
            updatedAt: '2026-07-15T00:00:00.000Z',
        }
        this.refs.push(ref)
        this.secrets.set(ref.id, secret)
        return ref
    }
    async delete(ref: CredentialRef) { this.refs = this.refs.filter(item => item.id !== ref.id) }
    async listMetadata() { return this.refs }
}

function adapter(events: string[]): NativeLanAgentAdapter {
    return {
        async start(input) {
            events.push(input.deviceIdentity === null ? 'start:new' : `start:${input.deviceIdentity}`)
            return {
                listening: true,
                bindIp: input.bindIp,
                port: input.port,
                syncScopeId: 'sync-scope:ca-fingerprint',
                deviceId: 'device:host',
                generatedDeviceIdentity: input.deviceIdentity === null ? 'host-private-identity' : null,
            }
        },
        async stop() { events.push('stop') },
        async listPairedDevices() { return [] },
        async revokeDevice() {},
    }
}

describe('LanAgentService', () => {
    it('requires an unlocked vault and never invokes native listen while locked', async () => {
        const events: string[] = []
        const vault = new AgentVault()
        vault.unlocked = false

        await expect(new LanAgentService(vault, adapter(events)).start({
            bindIp: '127.0.0.1', port: 47821, allowCidrs: ['127.0.0.0/8'],
        })).rejects.toThrow('unlocked')
        expect(events).toEqual([])
    })

    it('vaults a bootstrap host identity and reuses it on the next explicit start', async () => {
        const events: string[] = []
        const vault = new AgentVault()
        const service = new LanAgentService(vault, adapter(events))

        const first = await service.start({
            bindIp: '127.0.0.1', port: 47821, allowCidrs: ['127.0.0.0/8'],
        })
        await service.stop()
        const second = await service.start({
            bindIp: '127.0.0.1', port: 47821, allowCidrs: ['127.0.0.0/8'],
        })

        expect(events).toEqual(['start:new', 'stop', 'start:host-private-identity'])
        expect(vault.refs).toHaveLength(1)
        expect(vault.refs[0]?.kind).toBe('sync-device-identity')
        expect(first).not.toHaveProperty('generatedDeviceIdentity')
        expect(second).not.toHaveProperty('generatedDeviceIdentity')
    })

    it('stops the listener when a generated host identity cannot be vaulted', async () => {
        const events: string[] = []
        const vault = new AgentVault()
        vault.set = async () => { throw new Error('vault write failed') }

        await expect(new LanAgentService(vault, adapter(events)).start({
            bindIp: '127.0.0.1', port: 47821, allowCidrs: ['127.0.0.0/8'],
        })).rejects.toThrow('vault write failed')
        expect(events).toEqual(['start:new', 'stop'])
    })
})
