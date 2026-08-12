import type { WorkflowCharacterPrompts } from '@/domain/workflow/single-image-draft'
import type {
    StructuredPromptModulePart,
} from '@/stores/prompt-module-library-store'

export function appendStructuredPromptText(current: string, incoming: string): string {
    const left = current.trimEnd()
    const right = incoming.trim()
    if (!right) return current
    if (!left) return right
    return `${left}${left.endsWith(',') ? ' ' : ', '}${right}`
}

/** Maps selected library parts into one draft without leaking job-local coordinates back to the module. */
export function insertStructuredPartsIntoWorkflow(input: {
    readonly positive: string
    readonly negative: string
    readonly characters: WorkflowCharacterPrompts
    readonly parts: readonly StructuredPromptModulePart[]
    readonly moduleName: string
    readonly createId?: () => string
}): {
    readonly positive: string
    readonly negative: string
    readonly characters: WorkflowCharacterPrompts
} {
    let positive = input.positive
    let negative = input.negative
    let character = ''
    let characterNegative = ''
    for (const part of input.parts) {
        if (part.kind === 'base' || part.kind === 'detail' || part.kind === 'additional') {
            positive = appendStructuredPromptText(positive, part.content)
        } else if (part.kind === 'negative') {
            negative = appendStructuredPromptText(negative, part.content)
        } else if (part.kind === 'character') {
            character = appendStructuredPromptText(character, part.content)
        } else {
            characterNegative = appendStructuredPromptText(characterNegative, part.content)
        }
    }
    const hasCharacterPart = input.parts.some(part => part.kind === 'character' || part.kind === 'character-negative')
    return {
        positive,
        negative,
        characters: hasCharacterPart
            ? {
                positionEnabled: true,
                items: [...input.characters.items, {
                    id: input.createId?.() ?? `guided-character-${crypto.randomUUID()}`,
                    name: input.moduleName,
                    prompt: character,
                    negative: characterNegative,
                    enabled: true,
                    position: { x: 0.5, y: 0.5 },
                }],
            }
            : input.characters,
    }
}
