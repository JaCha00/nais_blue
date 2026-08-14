import type { NAIMetadata } from '@/lib/metadata-parser'

export interface GuidedPromptImportValue {
    positive: string
    negative: string
    sourceName: string
    characters?: readonly GuidedPromptImportCharacter[]
}

export interface GuidedPromptImportCharacter {
    prompt: string
    negative: string
    position: { x: number; y: number }
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function metadataPrompts(metadata: NAIMetadata): { positive: string; negative: string } {
    const parts = metadata.promptParts
    const positive = parts
        ? [parts.base, parts.additional, parts.detail].map(value => value.trim()).filter(Boolean).join(', ')
        : stringValue(metadata.v4_prompt?.caption?.base_caption) || stringValue(metadata.prompt)
    const negative = stringValue(parts?.negative)
        || stringValue(metadata.v4_negative_prompt?.caption?.base_caption)
        || stringValue(metadata.negativePrompt)
    return { positive, negative }
}

function coordinate(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0.1, Math.min(0.9, value))
        : 0.5
}

function metadataCharacters(metadata: NAIMetadata): GuidedPromptImportCharacter[] {
    const positive = metadata.v4_prompt?.caption?.char_captions ?? []
    const negative = metadata.v4_negative_prompt?.caption?.char_captions ?? []
    return positive.map((character, index) => ({
        prompt: stringValue(character.char_caption),
        negative: stringValue(negative[index]?.char_caption),
        position: {
            x: coordinate(character.centers?.[0]?.x),
            y: coordinate(character.centers?.[0]?.y),
        },
    })).filter(character => character.prompt.length > 0 || character.negative.length > 0)
}

export function guidedPromptImportFromMetadata(
    metadata: NAIMetadata,
    sourceName: string,
): GuidedPromptImportValue | null {
    const prompts = metadataPrompts(metadata)
    const characters = metadataCharacters(metadata)
    if (!prompts.positive && !prompts.negative && characters.length === 0) return null
    return {
        ...prompts,
        sourceName,
        ...(characters.length === 0 ? {} : { characters }),
    }
}
