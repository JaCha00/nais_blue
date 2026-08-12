import { describe, expect, it } from 'vitest'

import {
    IndexedDbWorkflowDraftRepository,
    type WorkflowDraftPersistencePort,
} from '@/adapters/workflow/indexeddb-workflow-draft-repository'
import {
    createBatchImageDraft,
    createSingleImageDraft,
    reviseSingleImageDraft,
} from '@/domain/workflow/single-image-draft'

const NOW = '2026-08-08T00:00:00.000Z'
const LATER = '2026-08-08T00:00:01.000Z'

class MemoryCasPersistence implements WorkflowDraftPersistencePort {
    value: string | null = null
    rejectNextCas = false

    async getItem(): Promise<string | null> {
        return this.value
    }

    async compareAndSet(_key: string, expected: string | null, next: string): Promise<boolean> {
        if (this.rejectNextCas) {
            this.rejectNextCas = false
            return false
        }
        if (this.value !== expected) return false
        this.value = next
        return true
    }
}

describe('IndexedDB workflow draft repository', () => {
    it('creates, reads, and replaces an exact revision through CAS', async () => {
        const persistence = new MemoryCasPersistence()
        const repository = new IndexedDbWorkflowDraftRepository(persistence)
        const created = createSingleImageDraft({ id: 'draft:1', now: NOW, seed: 42 })

        await expect(repository.commit({ expectedRevision: null, draft: created })).resolves.toMatchObject({
            status: 'committed',
        })
        const updated = reviseSingleImageDraft(created, { updatedAt: LATER, currentNodeId: 'prompt' })
        await expect(repository.commit({ expectedRevision: 0, draft: updated })).resolves.toMatchObject({
            status: 'committed',
            draft: { revision: 1, currentNodeId: 'prompt' },
        })
        await expect(repository.get('draft:1')).resolves.toMatchObject({ revision: 1 })
    })

    it('returns the current authority instead of overwriting a stale revision', async () => {
        const persistence = new MemoryCasPersistence()
        const repository = new IndexedDbWorkflowDraftRepository(persistence)
        const created = createSingleImageDraft({ id: 'draft:1', now: NOW, seed: 42 })
        await repository.commit({ expectedRevision: null, draft: created })
        const updated = reviseSingleImageDraft(created, { updatedAt: LATER, currentNodeId: 'prompt' })
        await repository.commit({ expectedRevision: 0, draft: updated })

        const stale = reviseSingleImageDraft(created, { updatedAt: LATER, currentNodeId: 'resolution' })
        await expect(repository.commit({ expectedRevision: 0, draft: stale })).resolves.toEqual({
            status: 'conflict',
            current: updated,
        })
    })

    it('retries a storage-level CAS race while preserving draft-level revision authority', async () => {
        const persistence = new MemoryCasPersistence()
        persistence.rejectNextCas = true
        const repository = new IndexedDbWorkflowDraftRepository(persistence)
        const draft = createSingleImageDraft({ id: 'draft:1', now: NOW, seed: 42 })

        await expect(repository.commit({ expectedRevision: null, draft })).resolves.toMatchObject({
            status: 'committed',
        })
        await expect(repository.list()).resolves.toHaveLength(1)
    })

    it('hydrates v1 drafts with an empty draft-owned character collection', async () => {
        const persistence = new MemoryCasPersistence()
        const current = createSingleImageDraft({ id: 'draft:v1', now: NOW, seed: 42 })
        const { characterPrompts: _characters, ...legacyPayload } = current.payload
        persistence.value = JSON.stringify({
            schemaVersion: 1,
            drafts: [{ ...current, schemaVersion: 1, payload: legacyPayload }],
        })
        const repository = new IndexedDbWorkflowDraftRepository(persistence)

        await expect(repository.get(current.id)).resolves.toMatchObject({
            schemaVersion: 2,
            payload: { characterPrompts: { positionEnabled: false, items: [] } },
        })
    })

    it('keeps legacy single-image and batch-image revisions in one compatible document', async () => {
        const persistence = new MemoryCasPersistence()
        const repository = new IndexedDbWorkflowDraftRepository(persistence)
        const single = createSingleImageDraft({ id: 'draft:single', now: NOW, seed: 1 })
        const batch = createBatchImageDraft({
            id: 'draft:batch',
            now: LATER,
            seed: 2,
            batchMode: 'same-settings',
        })

        await repository.commit({ expectedRevision: null, draft: single })
        await repository.commit({ expectedRevision: null, draft: batch })

        await expect(repository.list()).resolves.toEqual([batch, single])
        await expect(repository.get(batch.id)).resolves.toMatchObject({
            kind: 'batch-image',
            payload: { count: 4 },
        })
    })

    it('atomically moves an exact draft revision to trash and restores it', async () => {
        const persistence = new MemoryCasPersistence()
        const repository = new IndexedDbWorkflowDraftRepository(persistence)
        const draft = createSingleImageDraft({ id: 'draft:trash', now: NOW, seed: 42 })
        await repository.commit({ expectedRevision: null, draft })

        await expect(repository.moveToTrash(draft.id, draft.revision, Date.parse(LATER))).resolves.toMatchObject({
            status: 'trashed',
            item: { draft: { id: draft.id }, deletedAt: Date.parse(LATER) },
        })
        await expect(repository.get(draft.id)).resolves.toBeNull()
        await expect(repository.listTrash()).resolves.toMatchObject([{ draft: { id: draft.id } }])

        await expect(repository.restoreFromTrash(draft.id)).resolves.toEqual({ status: 'restored', draft })
        await expect(repository.get(draft.id)).resolves.toEqual(draft)
        await expect(repository.listTrash()).resolves.toEqual([])
    })

    it('does not trash a draft when the visible revision is stale', async () => {
        const persistence = new MemoryCasPersistence()
        const repository = new IndexedDbWorkflowDraftRepository(persistence)
        const draft = createSingleImageDraft({ id: 'draft:stale-trash', now: NOW, seed: 42 })
        await repository.commit({ expectedRevision: null, draft })
        const updated = reviseSingleImageDraft(draft, { updatedAt: LATER, currentNodeId: 'prompt' })
        await repository.commit({ expectedRevision: 0, draft: updated })

        await expect(repository.moveToTrash(draft.id, 0, Date.parse(LATER))).resolves.toEqual({
            status: 'conflict',
            current: updated,
        })
        await expect(repository.get(draft.id)).resolves.toEqual(updated)
        await expect(repository.listTrash()).resolves.toEqual([])
    })
})
