import { describe, expect, it } from 'vitest'

import {
    SYNC_TRANSPORT_MAX_JSON_BYTES,
    SYNC_BLOB_MAX_BYTES,
    assertSyncTransportBatch,
    validateBlobTransferDescriptor,
    validateSyncTransportManifest,
    validateSyncTransportPullResult,
    type RelayTransport,
    type RelayTestServerContract,
    type RelayTestRequestContext,
} from '@/domain/sync/transport'
import { requireSyncedR2Object } from '@/services/sync/r2-object-resolver'
import { envelope } from '../../domain/sync/fixtures'

describe('Phase 12 transport contract', () => {
    it('keeps provider-neutral relay as a test-only interface', async () => {
        const relay: Pick<RelayTransport, 'kind' | 'provider'> = {
            kind: 'relay-test',
            provider: 'contract-test',
        }
        expect(relay).toEqual({ kind: 'relay-test', provider: 'contract-test' })

        let highWater = 0
        const authorize = (context: RelayTestRequestContext) => {
            if (!context.authenticated || context.sequence <= highWater) {
                throw new Error('replay or unauthenticated')
            }
            highWater = context.sequence
        }
        const server: Pick<RelayTestServerContract, 'denyUnpaired' | 'manifest'> = {
            async denyUnpaired() { return { status: 401, body: null } },
            async manifest(context) {
                authorize(context)
                return {
                    protocolVersion: 1,
                    peerId: context.peerId,
                    pendingOperations: 0,
                    maxJsonBytes: 2 * 1024 * 1024,
                    maxOperations: 100,
                    imageMode: 'r2-reference',
                }
            },
        }
        const context: RelayTestRequestContext = {
            peerId: 'peer:test', requestId: 'request:1', sequence: 1, nonce: 'nonce:1', authenticated: true,
        }
        await expect(server.denyUnpaired()).resolves.toEqual({ status: 401, body: null })
        await expect(server.manifest(context)).resolves.toMatchObject({ peerId: 'peer:test' })
        await expect(server.manifest(context)).rejects.toThrow('replay')
    })

    it('bounds JSON batches and rejects image/path/token stop-gate values', () => {
        expect(assertSyncTransportBatch([envelope()])).toHaveLength(1)
        expect(() => assertSyncTransportBatch([envelope({
            payload: {
                id: 'scene:1',
                name: 'unsafe',
                scenePrompt: 'quiet harbor',
                orderKey: '0001',
                createdAt: 1,
                thumbnail: 'data:image/png;base64,AAAA',
            },
        })])).toThrow()
        expect(() => assertSyncTransportBatch([envelope({
            payload: {
                id: 'scene:1',
                name: 'unsafe',
                scenePrompt: 'quiet harbor',
                orderKey: '0001',
                createdAt: 1,
                outputPath: 'C:\\Users\\person\\image.png',
            },
        })])).toThrow()
        expect(() => assertSyncTransportBatch([envelope({
            payload: {
                id: 'scene:1',
                name: 'x'.repeat(SYNC_TRANSPORT_MAX_JSON_BYTES),
                scenePrompt: '',
                orderKey: '0001',
                createdAt: 1,
            },
        })])).toThrow()
    })

    it('rejects malformed authenticated manifests and checkpoints before acknowledgement', () => {
        expect(() => validateSyncTransportManifest({
            protocolVersion: 2,
            peerId: 'peer:test',
            pendingOperations: 0,
            maxJsonBytes: SYNC_TRANSPORT_MAX_JSON_BYTES,
            maxOperations: 100,
            imageMode: 'r2-reference',
        }, 'peer:test')).toThrow()
        expect(() => validateSyncTransportPullResult({
            envelopes: [],
            checkpoint: { sequence: -1, cursor: 'cursor:invalid' },
            hasMore: false,
        })).toThrow()
    })

    it('separates resumable blob metadata from JSON and requires checksum/policy', () => {
        expect(validateBlobTransferDescriptor({
            transferId: 'blob:1',
            artifactId: 'artifact:1',
            variantId: 'variant:distribution',
            size: 8_388_608,
            sha256: 'a'.repeat(64),
            policy: 'distribution',
        })).toMatchObject({ policy: 'distribution', size: 8_388_608 })
        expect(() => validateBlobTransferDescriptor({
            transferId: 'blob:1',
            artifactId: 'artifact:1',
            variantId: 'variant:distribution',
            size: 8_388_608,
            sha256: 'not-a-checksum',
            policy: 'distribution',
        })).toThrow()
        expect(() => validateBlobTransferDescriptor({
            transferId: 'blob:too-large', artifactId: 'artifact:1', variantId: 'variant:1',
            size: SYNC_BLOB_MAX_BYTES + 1, sha256: 'a'.repeat(64), policy: 'original',
        })).toThrow()
        expect(() => validateBlobTransferDescriptor({
            transferId: 'blob:path', artifactId: '/etc/passwd', variantId: 'variant:1',
            size: 1, sha256: 'a'.repeat(64), policy: 'original',
        })).toThrow()
    })

    it('reports a missing R2 object without falling back to image bytes or a signed URL', async () => {
        const reference = {
            profileId: 'profile:1',
            artifactId: 'artifact:1',
            variantId: 'variant:distribution',
            remoteKey: 'exports/public.png',
            state: 'succeeded' as const,
            updatedAt: '2026-07-15T00:00:00.000Z',
        }

        await expect(requireSyncedR2Object(reference, {
            async exists() { return false },
        })).rejects.toMatchObject({ code: 'E_SYNC_R2_OBJECT_MISSING' })
        expect(reference).not.toHaveProperty('image')
        expect(reference).not.toHaveProperty('signedUrl')
    })
})
