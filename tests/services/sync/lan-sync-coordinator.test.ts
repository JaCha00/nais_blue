import { describe, expect, it } from 'vitest'

import type {
    SyncCheckpoint,
    SyncEnvelope,
} from '@/domain/sync'
import {
    SyncTransportError,
    type SyncTransport,
    type SyncTransportManifest,
    type SyncTransportPullResult,
    type SyncTransportPushReceipt,
    type SyncTransportRequestOptions,
} from '@/domain/sync/transport'
import { LanSyncCoordinator } from '@/services/sync/lan-sync-coordinator'
import { envelope, repository } from '../../domain/sync/fixtures'
import { LATER, NOW } from '../../domain/sync/constants'

class ScriptedTransport implements SyncTransport {
    readonly kind = 'lan' as const
    readonly peerId = 'peer:b'
    pushed: SyncEnvelope[][] = []
    pullAcks: Array<{ opIds: readonly string[]; checkpoint: SyncCheckpoint }> = []
    pullAfter: Array<SyncCheckpoint | null> = []
    cancelledRequestIds: string[] = []
    pullResult: SyncTransportPullResult = {
        envelopes: [],
        checkpoint: { sequence: 0, cursor: 'cursor:0' },
        hasMore: false,
    }
    pushError: Error | null = null
    pushReceipt: SyncTransportPushReceipt | null = null

    async manifest(): Promise<SyncTransportManifest> {
        return {
            protocolVersion: 1,
            peerId: this.peerId,
            pendingOperations: this.pullResult.envelopes.length,
            maxJsonBytes: 2 * 1024 * 1024,
            maxOperations: 100,
            imageMode: 'r2-reference',
        }
    }

    async pull(input: { after: SyncCheckpoint | null }): Promise<SyncTransportPullResult> {
        this.pullAfter.push(structuredClone(input.after))
        return structuredClone(this.pullResult)
    }

    async acknowledgePull(input: { opIds: readonly string[]; checkpoint: SyncCheckpoint }): Promise<void> {
        this.pullAcks.push(structuredClone({ opIds: input.opIds, checkpoint: input.checkpoint }))
    }

    async push(input: SyncTransportRequestOptions & {
        envelopes: readonly SyncEnvelope[]
    }): Promise<SyncTransportPushReceipt> {
        if (this.pushError !== null) throw this.pushError
        this.pushed.push(structuredClone([...input.envelopes]))
        return this.pushReceipt ?? {
            acceptedOpIds: input.envelopes.map(item => item.opId),
            checkpoint: { sequence: 1, cursor: 'cursor:1' },
        }
    }

    async cancel(requestId: string): Promise<void> { this.cancelledRequestIds.push(requestId) }
}

describe('LanSyncCoordinator', () => {
    it('exchanges only sanitized envelopes and advances a reconnect checkpoint', async () => {
        const local = repository('phase12-paired')
        await local.applyLocalMutation({
            opId: 'op:a:1',
            entityType: 'scene.card',
            entityId: 'scene:local',
            op: 'upsert',
            deviceId: 'device:a',
            userId: 'user:1',
            createdAt: NOW,
            payload: {
                id: 'scene:local',
                name: 'Local scene',
                scenePrompt: 'quiet harbor',
                orderKey: '0001',
                createdAt: 1,
                token: 'must-not-cross',
                thumbnail: 'must-not-cross',
            },
        })
        const remoteEnvelope = envelope({
            opId: 'op:b:1',
            entityId: 'scene:remote',
            deviceId: 'device:b',
            payload: {
                id: 'scene:remote',
                name: 'Remote scene',
                scenePrompt: 'snow field',
                orderKey: '0002',
                createdAt: 2,
            },
        })
        const transport = new ScriptedTransport()
        transport.pullResult = {
            envelopes: [remoteEnvelope],
            checkpoint: { sequence: 4, cursor: 'cursor:4' },
            hasMore: false,
        }
        transport.pushReceipt = {
            acceptedOpIds: ['op:a:1'],
            checkpoint: { sequence: 5, cursor: 'cursor:5' },
        }

        const result = await new LanSyncCoordinator(local, transport).synchronizeOnce({ now: LATER })

        expect(result).toMatchObject({ pulled: 1, pushed: 1, duplicates: 0, moreInbound: false })
        expect(transport.pushed[0]?.[0]?.payload).not.toHaveProperty('token')
        expect(transport.pushed[0]?.[0]?.payload).not.toHaveProperty('thumbnail')
        expect(await local.getEntity('scene.card', 'scene:remote')).not.toBeNull()
        expect(await local.getCheckpoint('peer:b:pull')).toMatchObject({ sequence: 4, cursor: 'cursor:4' })
        expect(await local.getCheckpoint('peer:b:push')).toMatchObject({ sequence: 5, cursor: 'cursor:5' })
        expect((await local.getOutbox('op:a:1'))?.state).toBe('acked')
    })

    it('recovers an interrupted acknowledgement by accepting a duplicate op exactly once', async () => {
        const local = repository('phase12-duplicate')
        const repeated = envelope({ opId: 'op:b:duplicate', entityId: 'scene:remote' })
        await local.receiveRemote(repeated, NOW)
        const transport = new ScriptedTransport()
        transport.pullResult = {
            envelopes: [repeated],
            checkpoint: { sequence: 8, cursor: 'cursor:8' },
            hasMore: false,
        }

        const result = await new LanSyncCoordinator(local, transport).synchronizeOnce({ now: LATER })

        expect(result).toMatchObject({ pulled: 1, duplicates: 1 })
        expect(transport.pullAcks).toEqual([{
            opIds: ['op:b:duplicate'],
            checkpoint: { sequence: 8, cursor: 'cursor:8' },
        }])
        expect(await local.listConflictCopies('scene.card', 'scene:remote')).toHaveLength(0)
    })

    it('keeps a claimed operation retryable after timeout or cancellation', async () => {
        const local = repository('phase12-retry')
        await local.applyLocalMutation({
            opId: 'op:a:retry',
            entityType: 'scene.card',
            entityId: 'scene:retry',
            op: 'upsert',
            deviceId: 'device:a',
            userId: 'user:1',
            createdAt: NOW,
            payload: {
                id: 'scene:retry',
                name: 'Retry scene',
                scenePrompt: '',
                orderKey: '0001',
                createdAt: 1,
            },
        })
        const transport = new ScriptedTransport()
        transport.pushError = new SyncTransportError('E_SYNC_TIMEOUT', 'Timed out.', true)

        await expect(new LanSyncCoordinator(local, transport).synchronizeOnce({ now: LATER }))
            .rejects.toMatchObject({ code: 'E_SYNC_TIMEOUT' })
        expect(await local.getOutbox('op:a:retry')).toMatchObject({
            state: 'retry',
            attemptCount: 1,
            lastFailureCode: 'E_SYNC_TIMEOUT',
        })
    })

    it('does not touch repository data when peer authentication fails', async () => {
        const local = repository('phase12-unpaired')
        const transport = new ScriptedTransport()
        transport.manifest = async () => {
            throw new SyncTransportError('E_SYNC_UNPAIRED', 'Pairing required.', false)
        }

        await expect(new LanSyncCoordinator(local, transport).synchronizeOnce({ now: NOW }))
            .rejects.toMatchObject({ code: 'E_SYNC_UNPAIRED' })
        expect(await local.listOutbox()).toEqual([])
        expect(await local.getCheckpoint('peer:b:pull')).toBeNull()
        expect(await local.getCheckpoint('peer:b:push')).toBeNull()
    })

    it('does not resurrect a tombstone when a stale upsert arrives over a later connection', async () => {
        const local = repository('phase12-tombstone')
        const original = envelope({
            opId: 'op:b:root',
            entityId: 'scene:deleted',
            deviceId: 'device:b',
        })
        const deletion = envelope({
            opId: 'op:b:delete',
            entityId: 'scene:deleted',
            deviceId: 'device:b',
            op: 'delete',
            baseRevision: 1,
            baseOpId: original.opId,
            createdAt: LATER,
            payload: { deletedAt: LATER },
        })
        const stale = envelope({
            opId: 'op:c:stale',
            entityId: 'scene:deleted',
            deviceId: 'device:c',
            createdAt: NOW,
        })
        const transport = new ScriptedTransport()
        transport.pullResult = {
            envelopes: [original, deletion],
            checkpoint: { sequence: 10, cursor: 'cursor:10' },
            hasMore: false,
        }
        await new LanSyncCoordinator(local, transport).synchronizeOnce({ now: LATER })
        transport.pullResult = {
            envelopes: [stale],
            checkpoint: { sequence: 11, cursor: 'cursor:11' },
            hasMore: false,
        }

        await new LanSyncCoordinator(local, transport).synchronizeOnce({ now: LATER })

        expect((await local.getEntity('scene.card', 'scene:deleted'))?.op).toBe('delete')
        expect(await local.getTombstone('scene.card', 'scene:deleted')).toMatchObject({
            sourceOpId: 'op:b:delete',
        })
    })

    it('does not let a later push receipt skip the next inbound page', async () => {
        const local = repository('phase12-directional-checkpoints')
        await local.applyLocalMutation({
            opId: 'op:a:push', entityType: 'scene.card', entityId: 'scene:push', op: 'upsert',
            deviceId: 'device:a', userId: 'user:1', createdAt: NOW,
            payload: { id: 'scene:push', name: 'Push', scenePrompt: '', orderKey: '0001', createdAt: 1 },
        })
        const transport = new ScriptedTransport()
        transport.pullResult = {
            envelopes: [envelope({ opId: 'op:b:page-1', entityId: 'scene:page-1' })],
            checkpoint: { sequence: 100, cursor: 'cursor:100' },
            hasMore: true,
        }
        transport.pushReceipt = {
            acceptedOpIds: ['op:a:push'],
            checkpoint: { sequence: 201, cursor: 'cursor:201' },
        }

        const first = await new LanSyncCoordinator(local, transport).synchronizeOnce({ now: LATER })
        transport.pullResult = {
            envelopes: [envelope({ opId: 'op:b:page-2', entityId: 'scene:page-2' })],
            checkpoint: { sequence: 101, cursor: 'cursor:101' },
            hasMore: false,
        }
        const second = await new LanSyncCoordinator(local, transport).synchronizeOnce({ now: LATER })

        expect(first.moreInbound).toBe(true)
        expect(second.moreInbound).toBe(false)
        expect(transport.pullAfter).toEqual([null, { sequence: 100, cursor: 'cursor:100' }])
        expect(await local.getEntity('scene.card', 'scene:page-2')).not.toBeNull()
        expect(await local.getCheckpoint('peer:b:pull')).toMatchObject({ sequence: 101 })
        expect(await local.getCheckpoint('peer:b:push')).toMatchObject({ sequence: 201 })
    })

    it('sends request-scoped native cancellation after dispatch and keeps the lease retryable', async () => {
        const local = repository('phase12-dispatched-cancel')
        await local.applyLocalMutation({
            opId: 'op:a:cancel', entityType: 'scene.card', entityId: 'scene:cancel', op: 'upsert',
            deviceId: 'device:a', userId: 'user:1', createdAt: NOW,
            payload: { id: 'scene:cancel', name: 'Cancel', scenePrompt: '', orderKey: '0001', createdAt: 1 },
        })
        const transport = new ScriptedTransport()
        let dispatched: (() => void) | null = null
        const started = new Promise<void>(resolve => { dispatched = resolve })
        let seenTimeout: number | undefined
        transport.push = async input => {
            seenTimeout = input.timeoutMs
            dispatched?.()
            return new Promise((_resolve, reject) => {
                input.signal?.addEventListener('abort', () => {
                    reject(new SyncTransportError('E_SYNC_CANCELLED', 'Cancelled.', true))
                }, { once: true })
            })
        }
        const controller = new AbortController()
        const coordinator = new LanSyncCoordinator(
            local,
            transport,
            5_000,
            5_000,
            () => 'sync-request-cancel',
        )
        const run = coordinator.synchronizeOnce({ now: LATER, signal: controller.signal })
        await started
        controller.abort()

        await expect(run).rejects.toMatchObject({ code: 'E_SYNC_CANCELLED' })
        expect(seenTimeout).toBe(5_000)
        expect(transport.cancelledRequestIds).toContain('sync-request-cancel')
        expect(await local.getOutbox('op:a:cancel')).toMatchObject({
            state: 'retry',
            lastFailureCode: 'E_SYNC_CANCELLED',
        })
    })
})
