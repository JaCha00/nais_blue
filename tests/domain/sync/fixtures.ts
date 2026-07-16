import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

import {
    createSyncEnvelope,
    type SyncEntityType,
    type SyncEnvelope,
} from '@/domain/sync'
import { IndexedDBSyncOutboxRepository } from '@/services/sync/outbox-repository'
import { LATER, NOW, wrappedImageCanary } from './constants'

export { LATER, NOW, wrappedImageCanary }

let databaseCounter = 0

export function repository(label: string, factory = new IDBFactory()): IndexedDBSyncOutboxRepository {
    databaseCounter += 1
    return new IndexedDBSyncOutboxRepository({
        factory: factory as unknown as globalThis.IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName: `nais2-sync-${label}-${databaseCounter}`,
        userId: 'user:1',
    })
}

export function envelope(overrides: Partial<SyncEnvelope> = {}): SyncEnvelope {
    const entityType: SyncEntityType = overrides.entityType ?? 'scene.card'
    const baseRevision = overrides.baseRevision ?? 0
    return createSyncEnvelope({
        opId: overrides.opId ?? 'op:device-a:1',
        entityType,
        entityId: overrides.entityId ?? 'scene:1',
        op: overrides.op ?? 'upsert',
        baseRevision,
        baseOpId: overrides.baseOpId ?? (baseRevision === 0 ? null : 'op:base'),
        deviceId: overrides.deviceId ?? 'device:a',
        userId: overrides.userId ?? 'user:1',
        createdAt: overrides.createdAt ?? NOW,
        encrypted: overrides.encrypted ?? false,
        payload: overrides.payload ?? {
            id: overrides.entityId ?? 'scene:1',
            name: 'Scene 1',
            scenePrompt: 'quiet harbor',
            orderKey: '0001',
            createdAt: 1,
        },
    })
}
