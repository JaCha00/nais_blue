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
})
