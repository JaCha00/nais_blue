import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/indexed-db', () => ({
    STRUCTURED_PROMPT_MODULE_STORE_KEY: 'nai-blue-structured-prompt-modules',
    indexedDBStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
    },
}))

import {
    mergePromptPartText,
    movePromptModulePart,
    normalizePromptModuleFolder,
    usePromptModuleLibraryStore,
} from '@/stores/prompt-module-library-store'
import { insertStructuredPartsIntoWorkflow } from '@/presentation/workflow/structured-prompt-insertion'

describe('structured prompt module library', () => {
    beforeEach(() => {
        usePromptModuleLibraryStore.setState({ folders: [], modules: [] })
    })

    it('normalizes nested management folders without accepting traversal or reserved paths', () => {
        expect(normalizePromptModuleFolder(' characters \\ fantasy / elf ')).toBe('characters/fantasy/elf')
        expect(normalizePromptModuleFolder('characters/../private')).toBeNull()
        expect(normalizePromptModuleFolder('bad:name')).toBeNull()
        expect(normalizePromptModuleFolder('')).toBe('')
    })

    it('copies prompt text without erasing an existing target and reorders one part', () => {
        expect(mergePromptPartText('silver hair', 'blue eyes')).toBe('silver hair, blue eyes')
        expect(mergePromptPartText('silver hair', 'silver hair')).toBe('silver hair')
        expect(movePromptModulePart([
            { kind: 'base', content: 'base' },
            { kind: 'detail', content: 'detail' },
        ], 'detail', 'up')).toEqual([
            { kind: 'detail', content: 'detail' },
            { kind: 'base', content: 'base' },
        ])
    })

    it('inserts only selected parts and creates a job-local character at center 0.5', () => {
        const result = insertStructuredPartsIntoWorkflow({
            positive: '1girl',
            negative: 'lowres',
            characters: { positionEnabled: false, items: [] },
            moduleName: 'Silver knight',
            createId: () => 'character:1',
            parts: [
                { kind: 'detail', content: 'moonlit armor' },
                { kind: 'character', content: 'silver hair' },
                { kind: 'character-negative', content: 'alternate costume' },
            ],
        })

        expect(result.positive).toBe('1girl, moonlit armor')
        expect(result.negative).toBe('lowres')
        expect(result.characters).toEqual({
            positionEnabled: true,
            items: [{
                id: 'character:1',
                name: 'Silver knight',
                prompt: 'silver hair',
                negative: 'alternate costume',
                enabled: true,
                position: { x: 0.5, y: 0.5 },
            }],
        })
    })

    it('creates a large module batch in one state update and skips stable duplicates', () => {
        let updates = 0
        const unsubscribe = usePromptModuleLibraryStore.subscribe(() => { updates += 1 })
        const result = usePromptModuleLibraryStore.getState().createModules([
            { name: 'Style · 00000001', folder: 'imports/styles', parts: { base: 'ink', negative: 'text' } },
            { name: 'Style · 00000002', folder: 'imports/styles', parts: { base: 'paint' } },
            { name: 'Style · 00000001', folder: 'imports/styles', parts: { base: 'duplicate' } },
        ])
        unsubscribe()

        expect(result.createdIds).toHaveLength(2)
        expect(result.skippedCount).toBe(1)
        expect(updates).toBe(1)
        expect(usePromptModuleLibraryStore.getState()).toMatchObject({
            folders: ['imports/styles'],
            modules: [
                { name: 'Style · 00000001', parts: [{ kind: 'base', content: 'ink' }, { kind: 'negative', content: 'text' }] },
                { name: 'Style · 00000002', parts: [{ kind: 'base', content: 'paint' }] },
            ],
        })

        expect(usePromptModuleLibraryStore.getState().createModules([
            { name: 'STYLE · 00000001', folder: 'imports/styles', parts: { base: 'again' } },
        ])).toEqual({ createdIds: [], skippedCount: 1 })
        expect(usePromptModuleLibraryStore.getState().modules).toHaveLength(2)
    })

    it('stores a 2,788-item catalog with one state notification', () => {
        const inputs = Array.from({ length: 2_788 }, (_, index) => ({
            name: `Shared style · ${index.toString().padStart(8, '0')}`,
            folder: 'imports/그림체',
            parts: { base: `style ${index}`, negative: 'lowres' },
        }))
        let updates = 0
        const unsubscribe = usePromptModuleLibraryStore.subscribe(() => { updates += 1 })

        const result = usePromptModuleLibraryStore.getState().createModules(inputs)
        unsubscribe()

        expect(result).toMatchObject({ skippedCount: 0 })
        expect(result.createdIds).toHaveLength(2_788)
        expect(usePromptModuleLibraryStore.getState().modules).toHaveLength(2_788)
        expect(updates).toBe(1)
    })
})
