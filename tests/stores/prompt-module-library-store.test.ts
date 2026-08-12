import { describe, expect, it } from 'vitest'

import {
    mergePromptPartText,
    movePromptModulePart,
    normalizePromptModuleFolder,
} from '@/stores/prompt-module-library-store'
import { insertStructuredPartsIntoWorkflow } from '@/presentation/workflow/structured-prompt-insertion'

describe('structured prompt module library', () => {
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
})
