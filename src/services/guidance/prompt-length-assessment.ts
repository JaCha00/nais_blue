import {
    mergeQualityTags,
    mergeUcPreset,
    removeComments,
    type UcPresetIndex,
} from '@/services/nai/presets'
import { assembleV5TextPrompt, type TextAssemblyCenter } from '@/services/nai/text-assembly'

export type TokenAccuracyClassification = 'exact' | 'estimated' | 'unavailable'

export interface PromptLengthCharacter {
    readonly positive: string
    readonly negative: string
    readonly enabled: boolean
    readonly center?: TextAssemblyCenter
}

export interface PromptLengthAssessmentInput {
    readonly model: string
    readonly positivePrompt: string
    readonly negativePrompt: string
    readonly characters: readonly PromptLengthCharacter[]
    readonly useCoords?: boolean
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
    readonly tokenizerFamily: 't5' | 'qwen35' | 'undocumented' | 'unsupported'
    readonly reason: 'TOKENIZER_ARTIFACT_UNAVAILABLE' | 'UNSUPPORTED_MODEL'
    readonly positive: PromptSectionLengths
    readonly negative: PromptSectionLengths
}

export interface ModelTokenCapability {
    readonly tokenizerFamily: 't5' | 'qwen35' | 'undocumented'
    readonly contextLimitTokens: number | null
}

export type ModelTokenCapabilityRegistry = Readonly<Record<string, ModelTokenCapability>>

/** Model-scoped registry keeps a future V5 limit change out of prompt-length logic. */
export const CURRENT_MODEL_TOKEN_CAPABILITIES: ModelTokenCapabilityRegistry = Object.freeze({
    'nai-diffusion-5-curated': { tokenizerFamily: 'qwen35', contextLimitTokens: null },
    'nai-diffusion-5-full': { tokenizerFamily: 'qwen35', contextLimitTokens: null },
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
    const positiveBase = mergeQualityTags(
        removeComments(input.positivePrompt),
        input.qualityToggle,
        input.model,
    )
    const negativeBase = mergeUcPreset(
        removeComments(input.negativePrompt),
        input.ucPreset,
        input.model,
    )
    const positiveCharacters = enabledCharacters.map(character => removeComments(character.positive))
    const negativeCharacters = enabledCharacters.map(character => removeComments(character.negative))
    const expandedPositiveBase = assembleV5TextPrompt({
        model: input.model,
        basePrompt: positiveBase,
        characterPrompts: enabledCharacters.map((character, index) => ({
            prompt: positiveCharacters[index],
            center: character.center,
        })),
        useCoords: input.useCoords ?? false,
    })
    const capability = capabilities[input.model]
    const tokenizerFamily = capability?.tokenizerFamily ?? 'unsupported'
    const contextLimitTokens = capability?.contextLimitTokens ?? null

    return {
        model: input.model,
        classification: 'unavailable',
        tokenCount: null,
        safetyMarginTokens: null,
        contextLimitTokens,
        limitClassification: contextLimitTokens === null ? 'unavailable' : 'confirmed',
        tokenizerFamily,
        reason: capability === undefined
            ? 'UNSUPPORTED_MODEL'
            : 'TOKENIZER_ARTIFACT_UNAVAILABLE',
        positive: sectionLengths(expandedPositiveBase, positiveCharacters),
        negative: sectionLengths(negativeBase, negativeCharacters),
    }
}
