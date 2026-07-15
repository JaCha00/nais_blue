import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import {
    IndexedDBSyncOutboxRepository,
    SyncOutboxRepositoryError,
    syncDatabaseNameForUser,
} from '@/services/sync/outbox-repository'
import { LATER, NOW } from './constants'

const ENTITY_KEY = 'scene.card\u0000scene:1'

function legacyDeleteEnvelope() {
    return {
        schemaVersion: 0,
        opId: 'op:legacy:delete',
        entityType: 'scene.card',
        entityId: 'scene:1',
        op: 'delete',
        revision: 2,
        baseRevision: 1,
        deviceId: 'device:legacy',
        userId: 'user:1',
        createdAt: NOW,
        payload: { deletedAt: NOW },
    }
}

function legacyUpsertEnvelope() {
    return {
        schemaVersion: 0,
        opId: 'op:legacy:upsert',
        entityType: 'scene.card',
        entityId: 'scene:1',
        op: 'upsert',
        revision: 2,
        baseRevision: 1,
        deviceId: 'device:legacy',
        userId: 'user:1',
        createdAt: NOW,
        payload: {
            id: 'scene:1', name: 'Legacy', scenePrompt: 'legacy prompt', createdAt: 1, orderKey: '0001',
        },
    }
}

async function createV1Database(
    factory: IDBFactory,
    name: string,
    malformed = false,
    operation: 'delete' | 'upsert' = 'delete',
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const request = factory.open(name, 1)
        request.onupgradeneeded = () => {
            request.result.createObjectStore('entities', { keyPath: 'key' })
            request.result.createObjectStore('outbox', { keyPath: 'opId' })
            request.result.createObjectStore('tombstones', { keyPath: 'key' })
            request.result.createObjectStore('checkpoints', { keyPath: 'peerId' })
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const database = request.result
            const envelope = operation === 'delete' ? legacyDeleteEnvelope() : legacyUpsertEnvelope()
            const transaction = database.transaction(['entities', 'outbox', 'tombstones', 'checkpoints'], 'readwrite')
            transaction.objectStore('entities').put(malformed
                ? { key: ENTITY_KEY, malformed: true }
                : {
                    recordSchemaVersion: 1,
                    key: ENTITY_KEY,
                    entityType: 'scene.card',
                    entityId: 'scene:1',
                    revision: 2,
                    baseRevision: 1,
                    op: operation,
                    sourceOpId: envelope.opId,
                    sourceEnvelope: envelope,
                    payload: operation === 'delete' ? null : envelope.payload,
                    deletedAt: operation === 'delete' ? NOW : null,
                    conflictOfEntityId: null,
                    conflictSourceOpId: null,
                })
            if (!malformed) {
                transaction.objectStore('outbox').put({
                    recordSchemaVersion: 1,
                    opId: envelope.opId,
                    entityKey: ENTITY_KEY,
                    envelope,
                    state: 'pending',
                })
                if (operation === 'delete') {
                    transaction.objectStore('tombstones').put({
                        recordSchemaVersion: 1,
                        key: ENTITY_KEY,
                        entityType: 'scene.card',
                        entityId: 'scene:1',
                        revision: 2,
                        sourceOpId: 'op:legacy:delete',
                        sourceEnvelope: legacyDeleteEnvelope(),
                        deletedAt: NOW,
                    })
                }
                transaction.objectStore('checkpoints').put({
                    peerId: 'peer:legacy', sequence: 4, cursor: 'cursor:4', updatedAt: NOW,
                })
            }
            transaction.oncomplete = () => {
                database.close()
                resolve()
            }
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error ?? new Error('v1 fixture aborted'))
        }
    })
}

async function readRawEntity(factory: IDBFactory, name: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const request = factory.open(name, 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const database = request.result
            const transaction = database.transaction('entities', 'readonly')
            const get = transaction.objectStore('entities').get(ENTITY_KEY)
            get.onsuccess = () => resolve(get.result)
            get.onerror = () => reject(get.error)
            transaction.oncomplete = () => database.close()
        }
    })
}

describe('sync repository schema upgrade', () => {
    it('upgrades v1 envelopes/retry records while preserving tombstones and checkpoints', async () => {
        const factory = new IDBFactory()
        const name = 'nais2-sync-v1-upgrade'
        const physicalName = syncDatabaseNameForUser(name, 'user:1')
        await createV1Database(factory, physicalName)
        const sync = new IndexedDBSyncOutboxRepository({
            factory: factory as unknown as globalThis.IDBFactory,
            keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
            databaseName: name,
            userId: 'user:1',
        })
        await sync.initialize()

        expect(await sync.getEntity('scene.card', 'scene:1')).toMatchObject({
            recordSchemaVersion: 2,
            op: 'delete',
            sourceEnvelope: { schemaVersion: 1, encrypted: false },
        })
        expect(await sync.getOutbox('op:legacy:delete')).toMatchObject({
            recordSchemaVersion: 2,
            state: 'pending',
            attemptCount: 0,
            nextAttemptAt: NOW,
            lastFailureCode: null,
            envelope: { schemaVersion: 1, encrypted: false },
        })
        expect(await sync.getTombstone('scene.card', 'scene:1')).toMatchObject({
            recordSchemaVersion: 2,
            sourceOpId: 'op:legacy:delete',
        })
        expect(await sync.getCheckpoint('peer:legacy')).toMatchObject({ sequence: 4, cursor: 'cursor:4' })
    })

    it('aborts a malformed upgrade and leaves the v1 record readable', async () => {
        const factory = new IDBFactory()
        const name = 'nais2-sync-v1-malformed'
        const physicalName = syncDatabaseNameForUser(name, 'user:1')
        await createV1Database(factory, physicalName, true)
        const sync = new IndexedDBSyncOutboxRepository({
            factory: factory as unknown as globalThis.IDBFactory,
            keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
            databaseName: name,
            userId: 'user:1',
        })

        await expect(sync.initialize()).rejects.toMatchObject({
            name: 'SyncOutboxRepositoryError',
            code: 'E_SYNC_SCHEMA_UPGRADE',
        } satisfies Partial<SyncOutboxRepositoryError>)
        expect(await readRawEntity(factory, physicalName)).toEqual({ key: ENTITY_KEY, malformed: true })
    })

    it('preserves unknown legacy upsert lineage as a conservative transportable root', async () => {
        const factory = new IDBFactory()
        const name = 'nais2-sync-v1-upsert-upgrade'
        await createV1Database(factory, syncDatabaseNameForUser(name, 'user:1'), false, 'upsert')
        const options = {
            factory: factory as unknown as globalThis.IDBFactory,
            keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
            databaseName: name,
            userId: 'user:1',
        }
        const sync = new IndexedDBSyncOutboxRepository(options)
        await sync.initialize()
        const migrated = await sync.getOutbox('op:legacy:upsert')
        expect(migrated?.envelope).toMatchObject({
            schemaVersion: 1, baseRevision: 1, baseOpId: null, lineageUnknown: true,
        })

        const receiver = new IndexedDBSyncOutboxRepository({ ...options, databaseName: `${name}-receiver` })
        await expect(receiver.receiveRemote(migrated?.envelope)).resolves.toMatchObject({ status: 'applied' })
        await sync.applyLocalMutation({
            opId: 'op:legacy:next', entityType: 'scene.card', entityId: 'scene:1', op: 'upsert',
            deviceId: 'device:local', userId: 'user:1', createdAt: LATER,
            payload: { id: 'scene:1', name: 'Legacy', scenePrompt: 'next prompt', createdAt: 1, orderKey: '0001' },
        })
        expect(await sync.getEntity('scene.card', 'scene:1')).toMatchObject({
            revision: 3, sourceOpId: 'op:legacy:next', sourceEnvelope: { baseOpId: 'op:legacy:upsert' },
        })
    })
})
