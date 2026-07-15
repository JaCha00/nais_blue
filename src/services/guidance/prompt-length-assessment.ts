import {
    mergeQualityTags,
    mergeUcPreset,
    removeComments,
    type UcPresetIndex,
} from '@/services/nai/presets'

export type TokenAccuracyClassification = 'exact' | 'estimated' | 'unavailable'

export interface PromptLengthCharacter {
    readonly positive: string
    readonly negative: string
    readonly enabled: boolean
}

export interface PromptLengthAssessmentInput {
    readonly model: string
    readonly positivePrompt: string
    readonly negativePrompt: string
    readonly characters: readonly PromptLengthCharacter[]
    readonly qualityToggle: boolean
    readonly ucPreset: UcPresetIndex
}

export interface PromptSectionLengths {
    readonly expandedBaseCharacters: number
    readonly characterPromptCharacters: readonly number[]
    readonly enabledCharacterCharacters: number
    readonly combinedCharacters: number
}

export interface PromptLengthAssessment {
    readonly model: string
    readonly classification: TokenAccuracyClassification
    readonly tokenCount: number | null
    readonly safetyMarginTokens: number | null
    readonly tokenizerFamily: 't5' | 'undocumented' | 'unsupported'
    readonly reason: 'TOKENIZER_ARTIFACT_UNAVAILABLE' | 'UNSUPPORTED_MODEL'
    readonly positive: PromptSectionLengths
    readonly negative: PromptSectionLengths
}

const V4_T5_MODELS = new Set([
    'nai-diffusion-4-5-curated',
    'nai-diffusion-4-5-full',
    'nai-diffusion-4-curated-preview',
    'nai-diffusion-4-full',
])

const CURRENT_UNDOCUMENTED_MODELS = new Set([
    'nai-diffusion-3',
    'nai-diffusion-furry-3',
])

function sectionLengths(base: string, characters: readonly string[]): PromptSectionLengths {
    const characterCharacters = characters.reduce((total, prompt) => total + prompt.length, 0)
    return {
        expandedBaseCharacters: base.length,
        characterPromptCharacters: characters.map(prompt => prompt.length),
        enabledCharacterCharacters: characterCharacters,
        combinedCharacters: base.length + characterCharacters,
    }
}

/**
 * Mirrors payload prompt expansion through the shared NAI preset helpers. A
 * numeric token result stays closed until an official tokenizer artifact and
 * reproducible golden results establish model-level parity.
 */
export function assessPromptLengths(input: PromptLengthAssessmentInput): PromptLengthAssessment {
    const enabledCharacters = input.characters.filter(character => character.enabled)
    const positiveBase = mergeQualityTags(removeComments(input.positivePrompt), input.qualityToggle)
    const negativeBase = mergeUcPreset(removeComments(input.negativePrompt), input.ucPreset)
    const positiveCharacters = enabledCharacters.map(character => removeComments(character.positive))
    const negativeCharacters = enabledCharacters.map(character => removeComments(character.negative))
    const tokenizerFamily = V4_T5_MODELS.has(input.model)
        ? 't5'
        : CURRENT_UNDOCUMENTED_MODELS.has(input.model)
            ? 'undocumented'
            : 'unsupported'

    return {
        model: input.model,
        classification: 'unavailable',
        tokenCount: null,
        safetyMarginTokens: null,
        tokenizerFamily,
        reason: tokenizerFamily === 'unsupported'
            ? 'UNSUPPORTED_MODEL'
            : 'TOKENIZER_ARTIFACT_UNAVAILABLE',
        positive: sectionLengths(positiveBase, positiveCharacters),
        negative: sectionLengths(negativeBase, negativeCharacters),
    }
}
