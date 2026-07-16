import { describe, expect, it } from 'vitest'

import { SyncTransportError } from '@/domain/sync'
import {
    NativeLanControlAdapter,
    NativeLanQueueAdapter,
    NativeLanSyncTransport,
    type NativeSyncBindings,
} from '@/services/sync/native-lan-transport-adapter'
import { envelope } from '../../domain/sync/fixtures'

const SCOPE = `lan:${'a'.repeat(64)}`
const FINGERPRINT = `sha256:${'b'.repeat(64)}`
const CLIENT_REF = '123e4567-e89b-12d3-a456-426614174000'

const deviceIdentity = {
    caPrivateKeyPkcs8Base64: 'AQID',
    caCertificateDerBase64: 'BAUG',
    syncScopeId: SCOPE,
    deviceId: 'device:desktop',
    deviceName: 'Desktop',
}

const clientBundle = {
    clientPrivateKeyPkcs8Base64: 'AQID',
    clientCertificateDerBase64: 'BAUG',
    caCertificateDerBase64: 'BwgJ',
    syncEndpoint: 'https://192.168.10.20:44123',
    syncScopeId: SCOPE,
    peerFingerprint: FINGERPRINT,
}

class FakeBindings implements NativeSyncBindings {
    readonly calls: Array<{ command: string; args?: Record<string, unknown> }> = []

    constructor(private readonly handler: (
        command: string,
        args?: Record<string, unknown>,
    ) => unknown | Promise<unknown>) {}

    isTauri(): boolean { return true }

    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
        this.calls.push({ command, args })
        return await this.handler(command, args) as T
    }
}

function nativeRequest(args: Record<string, unknown> | undefined): Record<string, unknown> {
    return args?.request as Record<string, unknown>
}

describe('NativeLanControlAdapter', () => {
    it('keeps the user confirmation code out of the serialized and vaulted invitation', async () => {
        const bindings = new FakeBindings((command, args) => {
            if (command === 'sync_transport_open_pairing') {
                return {
                    pairingEndpoint: 'https://192.168.10.20:44124',
                    syncEndpoint: 'https://192.168.10.20:44123',
                    capability: 'short-lived-capability',
                    confirmationCode: '482913',
                    caCertificateBase64: 'AQID',
                    expiresAt: Math.floor(Date.now() / 1_000) + 120,
                    syncScopeId: SCOPE,
                }
            }
            const request = nativeRequest(args)
            expect((request.invitation as { confirmationCode: string }).confirmationCode).toBe('482913')
            return {
                peerFingerprint: FINGERPRINT,
                syncScopeId: SCOPE,
                credentialBundle: clientBundle,
            }
        })
        const adapter = new NativeLanControlAdapter('device:desktop', 'Desktop', bindings)

        const invitation = await adapter.createInvitation({ expiresInSeconds: 120 })
        const serialized = JSON.parse(invitation.invitation) as Record<string, unknown>

        expect(invitation.confirmationCode).toBe('482913')
        expect(serialized).not.toHaveProperty('confirmationCode')
        expect(invitation.invitation).not.toContain('482913')
        expect(serialized).toMatchObject({ capability: 'short-lived-capability', syncScopeId: SCOPE })
        await expect(adapter.acceptInvitation({
            invitation: invitation.invitation,
            confirmationCode: '482913',
            displayName: 'Android',
            clientRef: CLIENT_REF,
        })).resolves.toMatchObject({ peerId: SCOPE, certificateFingerprint: FINGERPRINT })
    })

    it('maps the explicit listener request and returns only an opaque identity string', async () => {
        const bindings = new FakeBindings((command) => {
            expect(command).toBe('sync_transport_start')
            return {
                endpoint: 'https://192.168.10.20:44123',
                syncScopeId: SCOPE,
                deviceId: 'device:desktop',
                deviceName: 'Desktop',
                generatedDeviceIdentity: deviceIdentity,
            }
        })
        const adapter = new NativeLanControlAdapter('device:desktop', 'Desktop', bindings)

        const result = await adapter.start({
            bindIp: '192.168.10.20',
            port: 44123,
            allowCidrs: ['192.168.10.0/24'],
            deviceIdentity: null,
        })

        expect(result).toMatchObject({
            listening: true,
            bindIp: '192.168.10.20',
            port: 44123,
            syncScopeId: SCOPE,
            deviceId: 'device:desktop',
        })
        expect(JSON.parse(String(result.generatedDeviceIdentity))).toMatchObject({ syncScopeId: SCOPE })
        expect(nativeRequest(bindings.calls[0]?.args)).toMatchObject({
            bindIp: '192.168.10.20',
            port: 44123,
            deviceId: 'device:desktop',
        })
    })

    it('rejects malformed listener results without reflecting native secret text', async () => {
        const malformed = new NativeLanControlAdapter('device:desktop', 'Desktop', new FakeBindings(() => ({
            endpoint: 'https://192.168.10.20:44123',
            syncScopeId: SCOPE,
            deviceId: 'device:desktop',
            deviceName: 'Desktop',
            generatedDeviceIdentity: null,
            credential: 'must-not-cross',
        })))
        await expect(malformed.start({
            bindIp: '192.168.10.20',
            port: 44123,
            allowCidrs: ['192.168.10.0/24'],
            deviceIdentity: null,
        })).rejects.toMatchObject({ code: 'E_SYNC_PROTOCOL_INVALID' })

        const denied = new NativeLanControlAdapter('device:desktop', 'Desktop', new FakeBindings(() => {
            throw { code: 'E_SYNC_NOT_PAIRED', message: 'private-key-material' }
        }))
        const rejection = await denied.start({
            bindIp: '192.168.10.20',
            port: 44123,
            allowCidrs: ['192.168.10.0/24'],
            deviceIdentity: null,
        }).catch(error => error as SyncTransportError)
        expect(rejection.code).toBe('E_SYNC_UNPAIRED')
        expect(rejection.message).not.toContain('private-key-material')
    })

    it('uses authenticated self-revoke with the original durable client sequence identity', async () => {
        const bindings = new FakeBindings((_command, args) => {
            const request = nativeRequest(args)
            expect(request.operation).toBe('revoke')
            expect(request.clientRef).toBe(CLIENT_REF)
            return { sequence: 9, response: { revoked: true } }
        })
        const adapter = new NativeLanControlAdapter('device:android', 'Android', bindings)

        await adapter.revokeIssuedPeer({
            clientRef: CLIENT_REF,
            credentialBundle: JSON.stringify(clientBundle),
        })

        expect(bindings.calls[0]?.command).toBe('sync_transport_exchange')
    })

    it('lists only nonsecret host peer metadata before an exact local revoke', async () => {
        const bindings = new FakeBindings((command, args) => {
            if (command === 'sync_transport_status') {
                return {
                    running: true,
                    endpoint: 'https://192.168.10.20:44123',
                    syncScopeId: SCOPE,
                    deviceId: 'device:desktop',
                    deviceName: 'Desktop',
                    pairingOpen: false,
                    activePeerCount: 1,
                    peers: [{
                        fingerprint: FINGERPRINT,
                        clientRef: CLIENT_REF,
                        deviceId: 'device:android',
                        deviceName: 'Android',
                        active: true,
                        revoked: false,
                    }],
                }
            }
            expect(nativeRequest(args)).toEqual({ peerFingerprint: FINGERPRINT })
            return undefined
        })
        const adapter = new NativeLanControlAdapter('device:desktop', 'Desktop', bindings)

        const peers = await adapter.listPairedDevices()
        expect(peers).toEqual([{
            certificateFingerprint: FINGERPRINT,
            clientRef: CLIENT_REF,
            deviceId: 'device:android',
            deviceName: 'Android',
            active: true,
            revoked: false,
        }])
        expect(peers[0]).not.toHaveProperty('endpoint')
        await adapter.revokeDevice(peers[0]?.certificateFingerprint ?? '')
    })

    it('rejects a malformed native peer count instead of exposing partial status', async () => {
        const bindings = new FakeBindings(() => ({
            running: true,
            endpoint: 'https://192.168.10.20:44123',
            syncScopeId: SCOPE,
            deviceId: 'device:desktop',
            deviceName: 'Desktop',
            pairingOpen: false,
            activePeerCount: 0,
            peers: [{
                fingerprint: FINGERPRINT,
                clientRef: CLIENT_REF,
                deviceId: 'device:android',
                deviceName: 'Android',
                active: true,
                revoked: false,
            }],
        }))

        await expect(new NativeLanControlAdapter('device:desktop', 'Desktop', bindings).listPairedDevices())
            .rejects.toMatchObject({ code: 'E_SYNC_PROTOCOL_INVALID' })
    })
})

describe('NativeLanSyncTransport', () => {
    it('validates manifest, pull, ack, and push response wrappers', async () => {
        const remote = envelope({ opId: 'op:remote:1', entityId: 'scene:remote' })
        let sequence = 0
        const operations: string[] = []
        const bindings = new FakeBindings((_command, args) => {
            const request = nativeRequest(args)
            const operation = String(request.operation)
            operations.push(operation)
            sequence += 1
            if (operation === 'manifest') {
                return { sequence, response: { syncScopeId: SCOPE, outboundPending: 1 } }
            }
            if (operation === 'pull') {
                return {
                    sequence,
                    response: {
                        deliveryId: 'cursor:7',
                        payload: [remote],
                        hasMore: false,
                    },
                }
            }
            if (operation === 'ack') {
                return {
                    sequence,
                    response: { acknowledged: true, duplicate: false, deliveryId: request.deliveryId },
                }
            }
            return {
                sequence,
                response: { accepted: true, duplicate: false, requestId: request.requestId },
            }
        })
        const transport = new NativeLanSyncTransport(CLIENT_REF, JSON.stringify(clientBundle), bindings)

        await expect(transport.manifest({ requestId: 'sync:manifest' })).resolves.toMatchObject({
            peerId: SCOPE,
            pendingOperations: 1,
            imageMode: 'r2-reference',
        })
        const pulled = await transport.pull({ requestId: 'sync:pull', after: null, limit: 10 })
        expect(pulled).toEqual({
            envelopes: [remote],
            checkpoint: { sequence: 2, cursor: 'cursor:7' },
            hasMore: false,
        })
        await transport.acknowledgePull({
            requestId: 'sync:ack',
            opIds: [remote.opId],
            checkpoint: pulled.checkpoint,
        })
        await expect(transport.push({ requestId: 'sync:push', envelopes: [remote] })).resolves.toEqual({
            acceptedOpIds: [remote.opId],
            checkpoint: { sequence: 4, cursor: 'push:4' },
        })
        expect(operations).toEqual(['manifest', 'pull', 'ack', 'push'])
    })

    it('rejects a malformed native pull continuation marker', async () => {
        const remote = envelope({ opId: 'op:remote:bad', entityId: 'scene:remote' })
        const bindings = new FakeBindings(() => ({
            sequence: 2,
            response: {
                deliveryId: 'delivery:different',
                payload: [remote],
                hasMore: 'false',
            },
        }))
        const transport = new NativeLanSyncTransport(CLIENT_REF, JSON.stringify(clientBundle), bindings)

        await expect(transport.pull({ requestId: 'sync:pull', after: null, limit: 10 }))
            .rejects.toMatchObject({ code: 'E_SYNC_PROTOCOL_INVALID' })
    })
})

describe('NativeLanQueueAdapter', () => {
    it('binds stable op identities to enqueue and exact durable receipt acknowledgement', async () => {
        const selected = envelope({ opId: 'op:queue:1', entityId: 'scene:queue' })
        const bindings = new FakeBindings((command, args) => {
            const request = nativeRequest(args)
            if (command === 'sync_transport_enqueue_outbound') {
                expect(request).toMatchObject({
                    peerFingerprint: FINGERPRINT,
                    deliveryId: `op:${'c'.repeat(64)}`,
                    opIds: [selected.opId],
                    payload: [selected],
                })
                return undefined
            }
            if (command === 'sync_transport_peek_outbound_receipts') {
                return [{
                    peerFingerprint: FINGERPRINT,
                    deliveryId: `op:${'c'.repeat(64)}`,
                    opIds: [selected.opId],
                    sequence: 4,
                }]
            }
            expect(request).toEqual({
                peerFingerprint: FINGERPRINT,
                deliveryId: `op:${'c'.repeat(64)}`,
                sequence: 4,
            })
            return undefined
        })
        const queue = new NativeLanQueueAdapter(bindings)
        await queue.enqueueOutbound({
            peerFingerprint: FINGERPRINT,
            deliveryId: `op:${'c'.repeat(64)}`,
            opIds: [selected.opId],
            payload: [selected],
        })
        const [receipt] = await queue.peekOutboundReceipts(1)
        expect(receipt).toMatchObject({ sequence: 4, opIds: [selected.opId] })
        if (receipt === undefined) throw new Error('expected receipt')
        await queue.acknowledgeOutboundReceipt(receipt)
    })

    it('rejects malformed or unsafe durable queue items before repository ingress', async () => {
        const bindings = new FakeBindings(() => [{
            requestId: 'push:unsafe',
            peerFingerprint: FINGERPRINT,
            sequence: 1,
            nonce: 'nonce-safe-0000001',
            payload: [{ token: 'must-not-cross' }],
        }])

        await expect(new NativeLanQueueAdapter(bindings).peekInbound(1))
            .rejects.toMatchObject({ code: 'E_SYNC_PROTOCOL_INVALID' })
    })
})
