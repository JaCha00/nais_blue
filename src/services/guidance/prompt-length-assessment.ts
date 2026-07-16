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
    readonly contextLimitTokens: number | null
    readonly limitClassification: 'confirmed' | 'unavailable'
    readonly tokenizerFamily: 't5' | 'undocumented' | 'unsupported'
    readonly reason: 'TOKENIZER_ARTIFACT_UNAVAILABLE' | 'UNSUPPORTED_MODEL'
    readonly positive: PromptSectionLengths
    readonly negative: PromptSectionLengths
}

export interface ModelTokenCapability {
    readonly tokenizerFamily: 't5' | 'undocumented'
    readonly contextLimitTokens: number
}

export type ModelTokenCapabilityRegistry = Readonly<Record<string, ModelTokenCapability>>

/** Model-scoped registry keeps a future V5 limit change out of prompt-length logic. */
export const CURRENT_MODEL_TOKEN_CAPABILITIES: ModelTokenCapabilityRegistry = Object.freeze({
    'nai-diffusion-4-5-curated': { tokenizerFamily: 't5', contextLimitTokens: 512 },
    'nai-diffusion-4-5-full': { tokenizerFamily: 't5', contextLimitTokens: 512 },
    'nai-diffusion-4-curated-preview': { tokenizerFamily: 't5', contextLimitTokens: 512 },
    'nai-diffusion-4-full': { tokenizerFamily: 't5', contextLimitTokens: 512 },
})

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
export function assessPromptLengths(
    input: PromptLengthAssessmentInput,
    capabilities: ModelTokenCapabilityRegistry = CURRENT_MODEL_TOKEN_CAPABILITIES,
): PromptLengthAssessment {
    const enabledCharacters = input.characters.filter(character => character.enabled)
    const positiveBase = mergeQualityTags(removeComments(input.positivePrompt), input.qualityToggle)
    const negativeBase = mergeUcPreset(removeComments(input.negativePrompt), input.ucPreset)
    const positiveCharacters = enabledCharacters.map(character => removeComments(character.positive))
    const negativeCharacters = enabledCharacters.map(character => removeComments(character.negative))
    const capability = capabilities[input.model]
    const tokenizerFamily = capability?.tokenizerFamily ?? 'unsupported'

    return {
        model: input.model,
        classification: 'unavailable',
        tokenCount: null,
        safetyMarginTokens: null,
        contextLimitTokens: capability?.contextLimitTokens ?? null,
        limitClassification: capability === undefined ? 'unavailable' : 'confirmed',
        tokenizerFamily,
        reason: capability === undefined
            ? 'UNSUPPORTED_MODEL'
            : 'TOKENIZER_ARTIFACT_UNAVAILABLE',
        positive: sectionLengths(positiveBase, positiveCharacters),
        negative: sectionLengths(negativeBase, negativeCharacters),
    }
}
