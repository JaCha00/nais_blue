import { describe, expect, it } from 'vitest'

import {
    SYNC_ENVELOPE_SCHEMA_VERSION,
    SyncEnvelopeError,
    createSyncEnvelope,
    nextSyncRevision,
    validateSyncEnvelope,
} from '@/domain/sync'
import { NOW } from './constants'

describe('sync envelope and deterministic revision', () => {
    it('creates the complete local-only envelope with revision derived from its base', () => {
        const envelope = createSyncEnvelope({
            opId: 'op:a:7',
            entityType: 'prompt.fragment',
            entityId: 'fragment:7',
            op: 'upsert',
            baseRevision: 4,
            baseOpId: 'op:a:6',
            deviceId: 'device:a',
            userId: 'user:1',
            createdAt: NOW,
            encrypted: false,
            payload: { id: 'fragment:7', name: 'lighting', folder: 'shared', content: ['rim light'], orderKey: '0007' },
        })

        expect(envelope).toEqual({
            schemaVersion: SYNC_ENVELOPE_SCHEMA_VERSION,
            opId: 'op:a:7',
            entityType: 'prompt.fragment',
            entityId: 'fragment:7',
            op: 'upsert',
            revision: 5,
            baseRevision: 4,
            baseOpId: 'op:a:6',
            deviceId: 'device:a',
            userId: 'user:1',
            createdAt: NOW,
            encrypted: false,
            payload: { content: ['rim light'], folder: 'shared', id: 'fragment:7', name: 'lighting', orderKey: '0007' },
        })
        expect(validateSyncEnvelope(envelope)).toEqual(envelope)
    })

    it('uses integer revision succession rather than timestamps or object key order', () => {
        expect(nextSyncRevision(0)).toBe(1)
        expect(nextSyncRevision(41)).toBe(42)
        const left = createSyncEnvelope({
            opId: 'op:a:1', entityType: 'ui.preference', entityId: 'preferences', op: 'upsert',
            baseRevision: 2, deviceId: 'device:a', userId: 'user:1', createdAt: NOW, encrypted: false,
            baseOpId: 'op:preferences:base',
            payload: { theme: 'dark', promptFontSize: 16 },
        })
        const right = createSyncEnvelope({
            opId: 'op:a:1', entityType: 'ui.preference', entityId: 'preferences', op: 'upsert',
            baseRevision: 2, deviceId: 'device:a', userId: 'user:1', createdAt: NOW, encrypted: false,
            baseOpId: 'op:preferences:base',
            payload: { promptFontSize: 16, theme: 'dark' },
        })
        expect(right).toEqual(left)
    })

    it('requires delete envelopes to carry only a deterministic tombstone payload', () => {
        const deleted = createSyncEnvelope({
            opId: 'op:a:delete', entityType: 'scene.card', entityId: 'scene:1', op: 'delete',
            baseRevision: 8, baseOpId: 'op:a:8', deviceId: 'device:a', userId: 'user:1', createdAt: NOW, encrypted: false,
            payload: { deletedAt: NOW },
        })
        expect(deleted).toMatchObject({ revision: 9, payload: { deletedAt: NOW } })
        expect(() => createSyncEnvelope({
            opId: 'op:a:bad-delete', entityType: 'scene.card', entityId: 'scene:1', op: 'delete',
            baseRevision: 8, baseOpId: 'op:a:8', deviceId: 'device:a', userId: 'user:1', createdAt: NOW, encrypted: false,
            payload: { deletedAt: NOW, image: 'forbidden' },
        })).toThrow(SyncEnvelopeError)
    })

    it('fails closed for unavailable encryption and future envelope schemas', () => {
        expect(() => createSyncEnvelope({
            opId: 'op:a:encrypted', entityType: 'scene.card', entityId: 'scene:1', op: 'upsert',
            baseRevision: 0, deviceId: 'device:a', userId: 'user:1', createdAt: NOW, encrypted: true,
            payload: { id: 'scene:1' },
        })).toThrow(/encryption/i)

        expect(() => validateSyncEnvelope({
            schemaVersion: 99,
            opId: 'op:a:future',
        })).toThrow(SyncEnvelopeError)
    })

    it('rejects forbidden material and unknown fields across the whole public envelope contract', () => {
        const root = createSyncEnvelope({
            opId: 'op:safe', entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false,
            payload: { id: 'scene:safe', name: 'Safe', scenePrompt: 'safe', createdAt: 1, orderKey: '0001' },
        })
        expect(() => createSyncEnvelope({
            opId: 'op:unsafe', entityType: 'scene.card', entityId: 'C:\\Users\\canary\\scene', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: root.payload,
        })).toThrow(SyncEnvelopeError)
        for (const entityId of ['/tmp', '/secret.png', '/', '//server/share']) {
            expect(() => createSyncEnvelope({
                opId: 'op:unsafe-posix', entityType: 'scene.card', entityId, op: 'upsert',
                baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
                encrypted: false, payload: root.payload,
            })).toThrow(SyncEnvelopeError)
        }
        expect(() => createSyncEnvelope({
            opId: 'op:unsafe-extra', entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: root.payload, authorization: 'Bearer canary',
        } as Parameters<typeof createSyncEnvelope>[0])).toThrow(SyncEnvelopeError)
        expect(() => validateSyncEnvelope({ ...root, imageBase64: 'iVBORw0KGgoAAA' }))
            .toThrow(SyncEnvelopeError)
        for (const key of ['grid', 'solid']) {
            expect(() => createSyncEnvelope({
                opId: `op:unsafe:${key}`, entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
                baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
                encrypted: false, payload: { [key]: 'AAECAwQFBgcICQoL' },
            })).toThrow(SyncEnvelopeError)
        }
        for (const key of ['to%6ben', 's%65cret', 'image%44ata']) {
            expect(() => createSyncEnvelope({
                opId: `op:encoded-key:${key}`, entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
                baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
                encrypted: false, payload: { [key]: 'canary' },
            })).toThrow(SyncEnvelopeError)
        }
        expect(() => createSyncEnvelope({
            opId: 'AAAAGGZ0eXBhdmlmAAAAAGF2aWZtaWYx', entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: root.payload,
        })).toThrow(SyncEnvelopeError)
        expect(() => createSyncEnvelope({
            opId: 'AAAAABhmdHlwYXZpZgAAAABhdmlmbWlmMQ==', entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: root.payload,
        })).toThrow(SyncEnvelopeError)
        expect(() => createSyncEnvelope({
            opId: `${'00'.repeat(130)}89504e470d0a1a0a`, entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: root.payload,
        })).toThrow(SyncEnvelopeError)
        expect(() => createSyncEnvelope({
            opId: 'f89504e470d0a1a0a', entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: root.payload,
        })).toThrow(SyncEnvelopeError)
        expect(() => createSyncEnvelope({
            opId: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJjYW5hcnkifQ.', entityType: 'scene.card', entityId: 'scene:safe',
            op: 'upsert', baseRevision: 0, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: root.payload,
        })).toThrow(SyncEnvelopeError)
        expect(() => createSyncEnvelope({
            opId: 'op:missing-parent', entityType: 'scene.card', entityId: 'scene:safe', op: 'upsert',
            baseRevision: 1, baseOpId: null, deviceId: 'device:safe', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: root.payload,
        })).toThrow(SyncEnvelopeError)
        expect(() => validateSyncEnvelope({ ...root, lineageUnknown: true })).toThrow(SyncEnvelopeError)
        expect(() => validateSyncEnvelope({
            ...root, revision: 2, baseRevision: 1, baseOpId: 'op:fake-parent', lineageUnknown: true,
        })).toThrow(SyncEnvelopeError)
    })
})
