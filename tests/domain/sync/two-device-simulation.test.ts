import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { canonicalSerialize } from '@/domain/composition/canonical-serialize'
import { typeFixtureModule } from '@/domain/composition/types.typecheck'
import { createSyncEnvelope } from '@/domain/sync'
import { IndexedDBSyncOutboxRepository } from '@/services/sync/outbox-repository'
import { sanitizeSyncPayload } from '@/services/sync/sanitizer'
import { LATER, NOW } from './constants'

function device(factory: IDBFactory, databaseName: string): IndexedDBSyncOutboxRepository {
    return new IndexedDBSyncOutboxRepository({
        factory: factory as unknown as globalThis.IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName,
        userId: 'user:1',
    })
}

function scenePayload(prompt: string) {
    return {
        id: 'scene:1', presetId: 'preset:1', name: 'Scene', scenePrompt: prompt,
        width: 832, height: 1216, createdAt: 1, orderKey: '0001',
    }
}

describe('network-free two-device sync simulation', () => {
    it('defers reordered operations, survives reconnect, and applies each op once', async () => {
        const a = device(new IDBFactory(), 'device-a-reorder')
        const factoryB = new IDBFactory()
        let b = device(factoryB, 'device-b-reorder')

        const revisionOne = await a.applyLocalMutation({
            opId: 'op:a:1', entityType: 'scene.card', entityId: 'scene:1', op: 'upsert',
            deviceId: 'device:a', userId: 'user:1', createdAt: NOW, payload: scenePayload('first'),
        })
        const revisionTwo = await a.applyLocalMutation({
            opId: 'op:a:2', entityType: 'scene.card', entityId: 'scene:1', op: 'upsert',
            deviceId: 'device:a', userId: 'user:1', createdAt: LATER, payload: scenePayload('second'),
        })

        expect(await b.receiveRemote(revisionTwo)).toMatchObject({ status: 'deferred', duplicateDelivery: false })
        expect(await b.getEntity('scene.card', 'scene:1')).toBeNull()
        await b.close()
        b = device(factoryB, 'device-b-reorder')

        expect(await b.receiveRemote(revisionOne)).toMatchObject({ status: 'ignored' })
        expect(await b.getEntity('scene.card', 'scene:1')).toMatchObject({
            revision: 2, sourceOpId: 'op:a:2', payload: { scenePrompt: 'second' },
        })
        expect(await b.receiveRemote(revisionOne)).toMatchObject({ status: 'ignored', duplicateDelivery: true })
        expect(await b.receiveRemote(revisionTwo)).toMatchObject({ status: 'applied', duplicateDelivery: true })
    })

    it('converges concurrent Composition edits to one winner plus the same deterministic conflict copy', async () => {
        const a = device(new IDBFactory(), 'device-a-composition')
        const b = device(new IDBFactory(), 'device-b-composition')
        const basePayload = { ...structuredClone(typeFixtureModule), id: 'module:1', name: 'Base' }
        const base = await a.applyLocalMutation({
            opId: 'op:a:base', entityType: 'composition.module', entityId: 'module:1', op: 'upsert',
            deviceId: 'device:a', userId: 'user:1', createdAt: NOW, payload: basePayload,
        })
        await b.receiveRemote(base)

        const editA = await a.applyLocalMutation({
            opId: 'op:a:2', entityType: 'composition.module', entityId: 'module:1', op: 'upsert',
            deviceId: 'device:a', userId: 'user:1', createdAt: LATER, payload: { ...basePayload, name: 'Edit A' },
        })
        const editB = await b.applyLocalMutation({
            opId: 'op:b:2', entityType: 'composition.module', entityId: 'module:1', op: 'upsert',
            deviceId: 'device:b', userId: 'user:1', createdAt: LATER, payload: { ...basePayload, name: 'Edit B' },
        })

        await Promise.all([a.receiveRemote(editB), b.receiveRemote(editA)])
        const projectionA = {
            primary: await a.getEntity('composition.module', 'module:1'),
            conflicts: await a.listConflictCopies('composition.module', 'module:1'),
        }
        const projectionB = {
            primary: await b.getEntity('composition.module', 'module:1'),
            conflicts: await b.listConflictCopies('composition.module', 'module:1'),
        }
        expect(canonicalSerialize(projectionA)).toBe(canonicalSerialize(projectionB))
        expect(projectionA.primary).toMatchObject({ sourceOpId: 'op:b:2', payload: { name: 'Edit B' } })
        expect(projectionA.conflicts).toEqual([
            expect.objectContaining({
                conflictOfEntityId: 'module:1',
                sourceOpId: 'op:a:2',
                payload: expect.objectContaining({ name: 'Edit A' }),
            }),
        ])
    })

    it('lets a tombstone win delete-vs-edit and never resurrects it on stale or duplicate delivery', async () => {
        const a = device(new IDBFactory(), 'device-a-delete')
        const b = device(new IDBFactory(), 'device-b-delete')
        const base = await a.applyLocalMutation({
            opId: 'op:a:base', entityType: 'scene.card', entityId: 'scene:1', op: 'upsert',
            deviceId: 'device:a', userId: 'user:1', createdAt: NOW, payload: scenePayload('base'),
        })
        await b.receiveRemote(base)

        const deletion = await a.applyLocalMutation({
            opId: 'op:a:delete', entityType: 'scene.card', entityId: 'scene:1', op: 'delete',
            deviceId: 'device:a', userId: 'user:1', createdAt: LATER,
        })
        const edit = await b.applyLocalMutation({
            opId: 'op:b:edit', entityType: 'scene.card', entityId: 'scene:1', op: 'upsert',
            deviceId: 'device:b', userId: 'user:1', createdAt: LATER, payload: scenePayload('offline edit'),
        })
        await Promise.all([a.receiveRemote(edit), b.receiveRemote(deletion)])

        const staleEdit = createSyncEnvelope({
            opId: 'op:c:stale', entityType: 'scene.card', entityId: 'scene:1', op: 'upsert', baseRevision: 1,
            baseOpId: 'op:a:base',
            deviceId: 'device:c', userId: 'user:1', createdAt: '2026-07-15T00:00:02.000Z', encrypted: false,
            payload: scenePayload('stale resurrection'),
        })
        await Promise.all([
            a.receiveRemote(staleEdit),
            b.receiveRemote(staleEdit),
            a.receiveRemote(edit),
            b.receiveRemote(deletion),
        ])

        const primaryA = await a.getEntity('scene.card', 'scene:1')
        const primaryB = await b.getEntity('scene.card', 'scene:1')
        expect(primaryA).toMatchObject({ op: 'delete', sourceOpId: 'op:a:delete', payload: null })
        expect(primaryB).toEqual(primaryA)
        expect(await a.getTombstone('scene.card', 'scene:1')).toMatchObject({ sourceOpId: 'op:a:delete' })
        expect(await b.getTombstone('scene.card', 'scene:1')).toMatchObject({ sourceOpId: 'op:a:delete' })
        expect((await a.listConflictCopies('scene.card', 'scene:1')).map(record => record.sourceOpId).sort())
            .toEqual(['op:b:edit', 'op:c:stale'])
        expect(canonicalSerialize(await a.listConflictCopies('scene.card', 'scene:1')))
            .toBe(canonicalSerialize(await b.listConflictCopies('scene.card', 'scene:1')))
    })

    it('rebuilds the same branched-descendant frontier for reordered delivery permutations', async () => {
        const modulePayload = (name: string) => sanitizeSyncPayload('composition.module', {
            ...structuredClone(typeFixtureModule), id: 'module:frontier', name,
        })
        const base = createSyncEnvelope({
            opId: 'op:frontier:base', entityType: 'composition.module', entityId: 'module:frontier', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:base', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: modulePayload('base'),
        })
        const a1 = createSyncEnvelope({
            opId: 'op:frontier:a1', entityType: 'composition.module', entityId: 'module:frontier', op: 'upsert',
            baseRevision: 1, baseOpId: base.opId, deviceId: 'device:a', userId: 'user:1', createdAt: LATER,
            encrypted: false, payload: modulePayload('a1'),
        })
        const a2 = createSyncEnvelope({
            opId: 'op:frontier:a2', entityType: 'composition.module', entityId: 'module:frontier', op: 'upsert',
            baseRevision: 2, baseOpId: a1.opId, deviceId: 'device:a', userId: 'user:1',
            createdAt: '2026-07-15T00:00:02.000Z', encrypted: false, payload: modulePayload('a2'),
        })
        const b1 = createSyncEnvelope({
            opId: 'op:frontier:b1', entityType: 'composition.module', entityId: 'module:frontier', op: 'upsert',
            baseRevision: 1, baseOpId: base.opId, deviceId: 'device:b', userId: 'user:1', createdAt: LATER,
            encrypted: false, payload: modulePayload('b1'),
        })
        const permutations = [
            [base, a1, a2, b1],
            [base, b1, a2, a1],
            [a2, b1, base, a1],
        ]
        const projections = []
        for (const [index, operations] of permutations.entries()) {
            const target = device(new IDBFactory(), `device-frontier-${index}`)
            for (const operation of operations) await target.receiveRemote(operation)
            projections.push({
                primary: await target.getEntity('composition.module', 'module:frontier'),
                conflicts: await target.listConflictCopies('composition.module', 'module:frontier'),
                tombstone: await target.getTombstone('composition.module', 'module:frontier'),
            })
        }

        expect(projections.map(canonicalSerialize)).toEqual([
            canonicalSerialize(projections[0]),
            canonicalSerialize(projections[0]),
            canonicalSerialize(projections[0]),
        ])
        expect(projections[0].primary).toMatchObject({ sourceOpId: a2.opId })
        expect(projections[0].conflicts.map(record => record.sourceOpId)).toEqual([b1.opId])
    })

    it('coalesces equivalent conflict heads identically when the distinct branch arrives first or last', async () => {
        const modulePayload = (name: string) => sanitizeSyncPayload('composition.module', {
            ...structuredClone(typeFixtureModule), id: 'module:cohort', name,
        })
        const base = createSyncEnvelope({
            opId: 'op:cohort:base', entityType: 'composition.module', entityId: 'module:cohort', op: 'upsert',
            baseRevision: 0, baseOpId: null, deviceId: 'device:base', userId: 'user:1', createdAt: NOW,
            encrypted: false, payload: modulePayload('base'),
        })
        const branch = (suffix: string, deviceId: string, name: string) => createSyncEnvelope({
            opId: `op:cohort:${suffix}`, entityType: 'composition.module', entityId: 'module:cohort', op: 'upsert',
            baseRevision: 1, baseOpId: base.opId, deviceId, userId: 'user:1', createdAt: LATER,
            encrypted: false, payload: modulePayload(name),
        })
        const a = branch('a', 'device:a', 'same')
        const b = branch('b', 'device:b', 'same')
        const c = branch('c', 'device:c', 'different')
        const permutations = [[base, a, b, c], [base, c, a, b]]
        const projections = []
        for (const [index, operations] of permutations.entries()) {
            const target = device(new IDBFactory(), `device-cohort-${index}`)
            for (const operation of operations) await target.receiveRemote(operation)
            projections.push({
                primary: await target.getEntity('composition.module', 'module:cohort'),
                conflicts: await target.listConflictCopies('composition.module', 'module:cohort'),
            })
        }
        expect(canonicalSerialize(projections[1])).toBe(canonicalSerialize(projections[0]))
        expect(projections[0].primary).toMatchObject({ sourceOpId: c.opId })
        expect(projections[0].conflicts.map(record => record.sourceOpId)).toEqual([b.opId])
    })
})
