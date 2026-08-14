import { describe, expect, it } from 'vitest'

import { applyGuidedPromptImport } from '@/presentation/workflow/guided-prompt-import-application'

const current = {
    positive: 'old positive',
    negative: 'old negative',
    characterPrompts: {
        positionEnabled: true,
        items: [{
            id: 'old-character',
            name: 'Old',
            prompt: 'old character',
            negative: '',
            enabled: true,
            position: { x: 0.5, y: 0.5 },
        }],
    },
}

const imported = {
    positive: 'new positive',
    negative: 'new negative',
    sourceName: 'fixture.png',
    characters: [{
        prompt: 'new character',
        negative: 'new character negative',
        position: { x: 0.25, y: 0.75 },
    }],
}

describe('Guided prompt import application', () => {
    it('replaces only prompt-owned fields and preserves the rest of the draft', () => {
        expect(applyGuidedPromptImport(current, imported, {
            mode: 'replace',
            createCharacterId: () => 'new-character',
            characterName: index => `Imported ${index + 1}`,
        })).toEqual({
            positive: 'new positive',
            negative: 'new negative',
            characterPrompts: {
                positionEnabled: true,
                items: [{
                    id: 'new-character',
                    name: 'Imported 1',
                    prompt: 'new character',
                    negative: 'new character negative',
                    enabled: true,
                    position: { x: 0.25, y: 0.75 },
                }],
            },
        })
    })

    it('appends prompts and characters without losing the current draft values', () => {
        const result = applyGuidedPromptImport(current, imported, {
            mode: 'append',
            createCharacterId: () => 'new-character',
            characterName: index => `Imported ${index + 1}`,
        })

        expect(result.positive).toBe('old positive, new positive')
        expect(result.negative).toBe('old negative, new negative')
        expect(result.characterPrompts.items.map(character => character.id)).toEqual([
            'old-character',
            'new-character',
        ])
    })
})
