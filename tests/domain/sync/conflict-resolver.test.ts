import { describe, expect, it, vi } from 'vitest'

import { createSyncEnvelope, type SyncEnvelope } from '@/domain/sync'
import {
    isDocumentedLwwEntityType,
    resolveSyncConflict,
    resolveSyncOperationSet,
} from '@/services/sync/conflict-resolver'
import { NOW } from './constants'

function upsert(overrides: Partial<SyncEnvelope>): SyncEnvelope {
    const baseRevision = overrides.baseRevision ?? 1
    return createSyncEnvelope({
        opId: overrides.opId ?? 'op:a',
        entityType: overrides.entityType ?? 'composition.module',
        entityId: overrides.entityId ?? 'module:1',
        op: 'upsert',
        baseRevision,
        baseOpId: overrides.baseOpId ?? (baseRevision === 0 ? null : 'op:base'),
        deviceId: overrides.deviceId ?? 'device:a',
        userId: 'user:1',
        createdAt: overrides.createdAt ?? NOW,
        encrypted: false,
        payload: overrides.payload ?? { id: 'module:1', name: 'A' },
    })
}

describe('deterministic sync conflict resolver', () => {
    it('creates the same conflict copy for concurrent Composition edits regardless of input order', () => {
        const left = upsert({ opId: 'op:a', deviceId: 'device:a', payload: { id: 'module:1', name: 'Local' } })
        const right = upsert({ opId: 'op:b', deviceId: 'device:b', payload: { id: 'module:1', name: 'Remote' } })

        const forward = resolveSyncConflict(left, right)
        const reverse = resolveSyncConflict(right, left)

        expect(forward).toMatchObject({
            kind: 'conflict-copy',
            winner: { opId: 'op:b' },
            loser: { opId: 'op:a' },
        })
        expect(reverse).toEqual(forward)
        expect(forward.conflictCopyId).toMatch(/^module:1~conflict~/)
        expect(forward.winner?.payload).toEqual({ id: 'module:1', name: 'Remote' })
        expect(forward.loser?.payload).toEqual({ id: 'module:1', name: 'Local' })
        expect(forward).not.toHaveProperty('mergedPayload')
    })

    it('uses LWW only for the documented simple UI preference entity', () => {
        const older = upsert({
            opId: 'op:preferences:a', entityType: 'ui.preference', entityId: 'preferences', deviceId: 'device:a',
            payload: { theme: 'light' },
        })
        const newer = upsert({
            opId: 'op:preferences:b', entityType: 'ui.preference', entityId: 'preferences', deviceId: 'device:b',
            payload: { theme: 'dark' },
        })

        expect(isDocumentedLwwEntityType('ui.preference')).toBe(true)
        expect(isDocumentedLwwEntityType('scene.card')).toBe(false)
        expect(resolveSyncConflict(older, newer)).toMatchObject({ kind: 'lww', winner: { opId: 'op:preferences:b' } })
    })

    it('never field-merges immutable generation snapshots', () => {
        const left = upsert({
            opId: 'op:job:a', entityType: 'generation.job-snapshot', entityId: 'job:1', deviceId: 'device:a',
            payload: { snapshotHash: 'sha256:a', snapshot: { parameters: { seed: 1 }, prompt: { positive: 'a' } } },
        })
        const right = upsert({
            opId: 'op:job:b', entityType: 'generation.job-snapshot', entityId: 'job:1', deviceId: 'device:b',
            payload: { snapshotHash: 'sha256:b', snapshot: { parameters: { steps: 28 }, prompt: { negative: 'b' } } },
        })
        const identical = upsert({
            opId: 'op:job:c', entityType: 'generation.job-snapshot', entityId: 'job:1', deviceId: 'device:c',
            payload: left.payload,
        })

        expect(resolveSyncConflict(left, right)).toMatchObject({
            kind: 'manual-resolution',
            winner: null,
            candidates: [{ opId: 'op:job:a' }, { opId: 'op:job:b' }],
        })
        expect(resolveSyncConflict(left, identical)).toMatchObject({ kind: 'equivalent' })
    })

    it('makes a tombstone dominate a concurrent edit and preserves the edit as a conflict copy', () => {
        const edit = upsert({
            opId: 'op:edit', entityType: 'scene.card', entityId: 'scene:1', deviceId: 'device:b',
            payload: { id: 'scene:1', scenePrompt: 'offline edit' },
        })
        const deletion = createSyncEnvelope({
            opId: 'op:delete', entityType: 'scene.card', entityId: 'scene:1', op: 'delete',
            baseRevision: 1, baseOpId: 'op:base', deviceId: 'device:a', userId: 'user:1', createdAt: NOW, encrypted: false,
            payload: { deletedAt: NOW },
        })

        const forward = resolveSyncConflict(edit, deletion)
        const reverse = resolveSyncConflict(deletion, edit)
        expect(forward).toMatchObject({
            kind: 'tombstone',
            winner: { opId: 'op:delete', op: 'delete' },
            loser: { opId: 'op:edit', op: 'upsert' },
        })
        expect(reverse).toEqual(forward)
        expect(forward.conflictCopyId).toMatch(/^scene:1~conflict~/)
    })

    it('recognizes a direct revision descendant without manufacturing a conflict', () => {
        const revisionOne = upsert({ opId: 'op:1', baseRevision: 0, baseOpId: null, payload: { id: 'module:1', name: 'one' } })
        const revisionTwo = upsert({ opId: 'op:2', baseRevision: 1, baseOpId: 'op:1', payload: { id: 'module:1', name: 'two' } })
        expect(resolveSyncConflict(revisionTwo, revisionOne)).toMatchObject({
            kind: 'causal',
            winner: { opId: 'op:2', revision: 2 },
        })
    })

    it('reduces branched descendants to the same maximal frontier for every arrival order', () => {
        const base = upsert({ opId: 'op:base', baseRevision: 0, baseOpId: null, payload: { id: 'module:1', name: 'base' } })
        const a1 = upsert({ opId: 'op:a:1', baseRevision: 1, baseOpId: base.opId, payload: { id: 'module:1', name: 'a1' } })
        const a2 = upsert({ opId: 'op:a:2', baseRevision: 2, baseOpId: a1.opId, payload: { id: 'module:1', name: 'a2' } })
        const b1 = upsert({ opId: 'op:b:1', baseRevision: 1, baseOpId: base.opId, payload: { id: 'module:1', name: 'b1' } })
        const permutations = [
            [base, a1, a2, b1],
            [base, b1, a1, a2],
            [a2, b1, base, a1],
            [b1, a2, a1, base],
        ]

        const projections = permutations.map(operations => resolveSyncOperationSet(operations))
        for (const projection of projections) {
            expect(projection).toMatchObject({ primary: { opId: 'op:a:2' }, effectiveRevision: 3 })
            expect(projection?.conflictCopies.map(copy => copy.envelope.opId)).toEqual(['op:b:1'])
            expect(projection?.statusByOpId.get('op:a:1')).toMatchObject({ status: 'ignored' })
        }
    })

    it('normalizes equivalent branch heads to one deterministic representative', () => {
        const base = upsert({ opId: 'op:base', baseRevision: 0, baseOpId: null, payload: { id: 'module:1', name: 'base' } })
        const shared = { id: 'module:1', name: 'same' }
        const a = upsert({ opId: 'op:a', deviceId: 'device:a', payload: shared })
        const b = upsert({ opId: 'op:b', deviceId: 'device:b', payload: shared })
        const c = upsert({ opId: 'op:c', deviceId: 'device:c', payload: { id: 'module:1', name: 'different' } })

        const forward = resolveSyncOperationSet([base, a, b, c])
        const reverse = resolveSyncOperationSet([c, b, a, base])
        expect(forward?.primary.opId).toBe('op:c')
        expect(forward?.conflictCopies.map(copy => copy.envelope.opId)).toEqual(['op:b'])
        expect(reverse?.primary).toEqual(forward?.primary)
        expect(reverse?.conflictCopies).toEqual(forward?.conflictCopies)
        expect(resolveSyncOperationSet([base, a, b])?.conflictCopies).toEqual([])
    })

    it('uses locale-independent ordering and keeps generated conflict identifiers bounded', () => {
        const entityId = 'm'.repeat(512)
        const base = upsert({
            opId: 'op:base', baseRevision: 0, baseOpId: null, entityId,
            payload: { id: entityId, name: 'base' },
        })
        const left = upsert({
            opId: 'op:z', deviceId: 'device:z', entityId,
            payload: { id: entityId, name: 'left' },
        })
        const right = upsert({
            opId: 'op:umlaut', deviceId: 'device:ä', entityId,
            payload: { id: entityId, name: 'right' },
        })
        const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
            throw new Error('locale-sensitive comparison is forbidden')
        })
        try {
            const projection = resolveSyncOperationSet([base, left, right])
            expect(projection?.primary.opId).toBe('op:umlaut')
            expect(projection?.conflictCopies[0].conflictCopyId.length).toBeLessThanOrEqual(512)
        } finally {
            localeCompare.mockRestore()
        }
    })

    it('fails closed before an entity operation set can exceed the retained projection bound', () => {
        const operations = Array.from({ length: 2_049 }, (_, index) => upsert({
            opId: `op:bounded:${index}`,
            baseRevision: 0,
            baseOpId: null,
            payload: { id: 'module:1', name: `bounded edit ${index}` },
        }))
        expect(() => resolveSyncOperationSet(operations)).toThrow('bounded projection limit')
    })
})
