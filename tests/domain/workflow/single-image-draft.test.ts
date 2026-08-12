import { describe, expect, it } from 'vitest'

import {
    createBatchImageDraft,
    SINGLE_IMAGE_NODE_IDS,
    createSingleImageDraft,
    isBatchImageDraft,
    isBatchImageDraftReady,
    isSingleImageDraft,
    isSingleImageDraftReady,
    isWorkflowDraft,
    listBatchImageDraftIssues,
    listSingleImageDraftIssues,
    reviseBatchImageDraft,
    reviseSingleImageDraft,
} from '@/domain/workflow/single-image-draft'

const NOW = '2026-08-08T00:00:00.000Z'
const LATER = '2026-08-08T00:00:01.000Z'

describe('single-image workflow draft', () => {
    it('creates one complete recommended-settings draft without pretending it is ready', () => {
        const draft = createSingleImageDraft({ id: 'draft:1', now: NOW, seed: 42 })

        expect(draft).toMatchObject({
            schemaVersion: 2,
            kind: 'single-image',
            revision: 0,
            currentNodeId: 'model',
            payload: {
                mode: 'text-to-image',
                generation: {
                    steps: 28,
                    cfgScale: 5,
                    sampler: 'k_euler_ancestral',
                    scheduler: 'karras',
                    seed: 42,
                },
                credentialPolicy: { kind: 'auto' },
                characterPrompts: { positionEnabled: false, items: [] },
                output: {
                    directory: 'NAI_Blue_Output',
                    imageFormat: 'png',
                    metadataMode: 'embedded',
                },
            },
        })
        expect(listSingleImageDraftIssues(draft)).toEqual([
            'model-required',
            'prompt-required',
            'resolution-required',
        ])
        expect(isSingleImageDraftReady(draft)).toBe(false)
        expect(isSingleImageDraft(draft)).toBe(true)
        expect(SINGLE_IMAGE_NODE_IDS).toEqual(['model', 'prompt', 'resolution', 'settings', 'review'])
    })

    it('advances an immutable revision only after typed generation inputs are valid', () => {
        const current = createSingleImageDraft({ id: 'draft:1', now: NOW, seed: 42 })
        const next = reviseSingleImageDraft(current, {
            updatedAt: LATER,
            currentNodeId: 'review',
            status: 'review',
            payload: {
                ...current.payload,
                model: 'nai-diffusion-4-5-full',
                prompt: { positive: '1girl, blue hour', negative: 'blurry' },
                resolution: { width: 832, height: 1216 },
            },
        })

        expect(next.revision).toBe(1)
        expect(next.updatedAt).toBe(LATER)
        expect(isSingleImageDraftReady(next)).toBe(true)
        expect(current.payload.model).toBeNull()
    })

    it('rejects malformed persisted dimensions and backward timestamps', () => {
        const draft = createSingleImageDraft({ id: 'draft:1', now: NOW, seed: 42 })

        expect(isSingleImageDraft({
            ...draft,
            payload: { ...draft.payload, resolution: { width: 801, height: 1216 } },
        })).toBe(false)
        expect(() => reviseSingleImageDraft(draft, {
            updatedAt: '2026-08-07T23:59:59.000Z',
        })).toThrow('updatedAt must be monotonic')
    })

    it('persists incomplete character editing but blocks an enabled blank character', () => {
        const created = createSingleImageDraft({ id: 'draft:characters', now: NOW, seed: 42 })
        const draft = reviseSingleImageDraft(created, {
            updatedAt: LATER,
            payload: {
                ...created.payload,
                model: 'nai-diffusion-4-5-full',
                prompt: { positive: 'portrait', negative: '' },
                resolution: { width: 832, height: 1216 },
                characterPrompts: {
                    positionEnabled: false,
                    items: [{
                        id: 'character:1',
                        prompt: '# comment only',
                        negative: '',
                        enabled: true,
                        position: { x: 0.5, y: 0.5 },
                    }],
                },
            },
        })

        expect(isSingleImageDraft(draft)).toBe(true)
        expect(listSingleImageDraftIssues(draft)).toContain('character-prompt-invalid')
        expect(isSingleImageDraftReady(draft)).toBe(false)
    })
})

describe('batch-image workflow draft', () => {
    it('creates a detached resumable draft without treating missing choices as valid', () => {
        const draft = createBatchImageDraft({
            id: 'batch:1',
            now: NOW,
            seed: 100,
            batchMode: 'variations',
        })

        expect(draft).toMatchObject({
            kind: 'batch-image',
            revision: 0,
            currentNodeId: 'model',
            payload: {
                batchMode: 'variations',
                count: 4,
                variationOrder: 'random',
                scenes: [],
                generation: { seed: 100 },
            },
        })
        expect(listBatchImageDraftIssues(draft)).toEqual([
            'model-required',
            'prompt-required',
            'resolution-required',
        ])
        expect(isBatchImageDraft(draft)).toBe(true)
        expect(isWorkflowDraft(draft)).toBe(true)
        expect(isBatchImageDraftReady(draft)).toBe(false)
    })

    it('persists incomplete scene editing but requires every scene before enqueue', () => {
        const created = createBatchImageDraft({
            id: 'batch:scene',
            now: NOW,
            seed: 200,
            batchMode: 'scenes',
        })
        const editing = reviseBatchImageDraft(created, {
            updatedAt: LATER,
            currentNodeId: 'scenes',
            payload: {
                ...created.payload,
                model: 'nai-diffusion-4-5-full',
                resolution: { width: 1024, height: 1024 },
                scenes: [{ id: 'scene:1', name: 'Opening', positive: '', negative: '', count: 2 }],
            },
        })

        expect(isBatchImageDraft(editing)).toBe(true)
        expect(listBatchImageDraftIssues(editing)).toContain('scene-invalid')

        const ready = reviseBatchImageDraft(editing, {
            updatedAt: '2026-08-08T00:00:02.000Z',
            currentNodeId: 'review',
            status: 'review',
            payload: {
                ...editing.payload,
                scenes: [{ ...editing.payload.scenes[0]!, positive: 'wide shot, blue hour' }],
            },
        })
        expect(isBatchImageDraftReady(ready)).toBe(true)
    })
})
