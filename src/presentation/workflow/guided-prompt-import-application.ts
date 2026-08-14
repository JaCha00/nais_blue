import { appendPromptModuleLine } from '@/components/fragments/PromptModulePicker'
import type { WorkflowCharacterPrompts } from '@/domain/workflow/single-image-draft'

import type { GuidedPromptImportValue } from './guided-prompt-import'

export interface GuidedPromptEditingValue {
    readonly positive: string
    readonly negative: string
    readonly characterPrompts: WorkflowCharacterPrompts
}

/** Applies both local and app-wide imports through one replace/append contract. */
export function applyGuidedPromptImport(
    current: GuidedPromptEditingValue,
    imported: GuidedPromptImportValue,
    options: {
        readonly mode: 'replace' | 'append'
        readonly createCharacterId: () => string
        readonly characterName: (index: number) => string
    },
): GuidedPromptEditingValue {
    const append = options.mode === 'append'
    const importedCharacters = imported.characters ?? []
    const nextCharacters = importedCharacters.length === 0
        ? current.characterPrompts
        : {
            positionEnabled: true,
            items: [
                ...(append ? current.characterPrompts.items : []),
                ...importedCharacters.map((character, index) => ({
                    id: options.createCharacterId(),
                    name: options.characterName(index),
                    prompt: character.prompt,
                    negative: character.negative,
                    enabled: character.prompt.trim().length > 0,
                    position: { ...character.position },
                })),
            ],
        }

    return {
        positive: imported.positive
            ? append ? appendPromptModuleLine(current.positive, imported.positive) : imported.positive
            : current.positive,
        negative: imported.negative
            ? append ? appendPromptModuleLine(current.negative, imported.negative) : imported.negative
            : current.negative,
        characterPrompts: nextCharacters,
    }
}
