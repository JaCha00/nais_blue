import { isDeepStrictEqual } from 'node:util'

import {
    buildGenerateImagePayload,
    varietySigma,
    type BuildOptions,
    type CharacterPromptInput,
    type CharacterReferenceOptions,
    type GenerationRequest,
    type NaiImagePayload,
} from '@/services/nai/payload'
import {
    QUALITY_TAGS_SUFFIX,
    UC_PRESETS_V45_FULL,
    type UcPresetIndex,
} from '@/services/nai/presets'

const REDACTED_BASE64 = '[REDACTED:BASE64]'

type JsonObject = Record<string, unknown>
type CharacterReferenceType = CharacterReferenceOptions['referenceType']

interface AdaptedFixtureBase {
    expected: NaiImagePayload
    options: BuildOptions
    request: GenerationRequest
}

export interface ExactNaiWebFixture extends AdaptedFixtureBase {
    kind: 'exact'
}

export interface TransportGapNaiWebFixture extends AdaptedFixtureBase {
    gapKind: 'cached-i2i' | 'cached-vibe'
    kind: 'transport-gap'
}

export type AdaptedNaiWebFixture = ExactNaiWebFixture | TransportGapNaiWebFixture

function invalid(path: string, expectation: string): never {
    throw new TypeError(`Invalid sanitized NAI web fixture at ${path}: ${expectation}`)
}

function recordAt(value: unknown, path: string): JsonObject {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return invalid(path, 'expected an object')
    }
    return value as JsonObject
}

function arrayAt(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) return invalid(path, 'expected an array')
    return value
}

function stringAt(value: unknown, path: string): string {
    if (typeof value !== 'string') return invalid(path, 'expected a string')
    return value
}

function numberAt(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid(path, 'expected a finite number')
    }
    return value
}

function booleanAt(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') return invalid(path, 'expected a boolean')
    return value
}

function own(object: JsonObject, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key)
}

function expectValue(actual: unknown, expected: unknown, path: string): void {
    if (!isDeepStrictEqual(actual, expected)) {
        invalid(path, `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
    }
}

function ucPresetAt(value: unknown): UcPresetIndex {
    if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) return value
    return invalid('$.parameters.ucPreset', 'expected an integer from 0 through 4')
}

function imageFormatAt(value: unknown): 'png' | 'webp' {
    if (value === 'png' || value === 'webp') return value
    return invalid('$.parameters.image_format', 'expected "png" or "webp"')
}

function streamAt(value: unknown): 'msgpack' | undefined {
    if (value === undefined) return undefined
    if (value === 'msgpack') return value
    return invalid('$.parameters.stream', 'expected "msgpack" or an omitted key')
}

function referenceTypeAt(value: unknown, path: string): CharacterReferenceType {
    if (
        value === 'character'
        || value === 'style'
        || value === 'character&style'
        || value === 'costume'
        || value === 'delta'
    ) {
        return value
    }
    return invalid(path, 'expected a supported character reference type')
}

function removeQualitySuffix(input: string, qualityToggle: boolean): string {
    if (!qualityToggle) return input
    if (!input.endsWith(QUALITY_TAGS_SUFFIX)) {
        invalid(
            '$.input',
            `qualityToggle=true requires the exact target suffix ${JSON.stringify(QUALITY_TAGS_SUFFIX)}`,
        )
    }
    return input.slice(0, -QUALITY_TAGS_SUFFIX.length)
}

function removeUcPrefix(negativePrompt: string, ucPreset: UcPresetIndex): string {
    const preset = UC_PRESETS_V45_FULL[ucPreset]
    if (!preset) return negativePrompt
    if (negativePrompt === preset) return ''

    const prefix = `${preset}, `
    if (!negativePrompt.startsWith(prefix)) {
        invalid(
            '$.parameters.negative_prompt',
            `ucPreset=${ucPreset} requires the exact target UC prefix`,
        )
    }
    return negativePrompt.slice(prefix.length)
}

function centerAt(value: unknown, path: string): { x: number; y: number } {
    const center = recordAt(value, path)
    return {
        x: numberAt(center.x, `${path}.x`),
        y: numberAt(center.y, `${path}.y`),
    }
}

function reconstructCharacters(parameters: JsonObject, useCoords: boolean): CharacterPromptInput[] {
    const legacyCharacters = arrayAt(parameters.characterPrompts, '$.parameters.characterPrompts')
    const positivePrompt = recordAt(parameters.v4_prompt, '$.parameters.v4_prompt')
    const positiveCaption = recordAt(positivePrompt.caption, '$.parameters.v4_prompt.caption')
    const positiveCharacters = arrayAt(
        positiveCaption.char_captions,
        '$.parameters.v4_prompt.caption.char_captions',
    )
    const negativePrompt = recordAt(parameters.v4_negative_prompt, '$.parameters.v4_negative_prompt')
    const negativeCaption = recordAt(negativePrompt.caption, '$.parameters.v4_negative_prompt.caption')
    const negativeCharacters = arrayAt(
        negativeCaption.char_captions,
        '$.parameters.v4_negative_prompt.caption.char_captions',
    )

    expectValue(positivePrompt.use_coords, useCoords, '$.parameters.v4_prompt.use_coords')
    expectValue(positivePrompt.use_order, true, '$.parameters.v4_prompt.use_order')
    expectValue(positiveCharacters.length, legacyCharacters.length, '$.parameters.v4_prompt.caption.char_captions')
    expectValue(negativeCharacters.length, legacyCharacters.length, '$.parameters.v4_negative_prompt.caption.char_captions')

    return legacyCharacters.map((value, index) => {
        const path = `$.parameters.characterPrompts[${index}]`
        const character = recordAt(value, path)
        const prompt = stringAt(character.prompt, `${path}.prompt`)
        const negative = stringAt(character.uc, `${path}.uc`)
        const center = centerAt(character.center, `${path}.center`)
        expectValue(character.enabled, true, `${path}.enabled`)
        if (!prompt.trim()) invalid(`${path}.prompt`, 'expected a non-blank enabled character prompt')
        if (!useCoords) expectValue(center, { x: 0.5, y: 0.5 }, `${path}.center`)

        const positivePath = `$.parameters.v4_prompt.caption.char_captions[${index}]`
        const positiveCharacter = recordAt(positiveCharacters[index], positivePath)
        expectValue(positiveCharacter.char_caption, prompt, `${positivePath}.char_caption`)
        expectValue(
            arrayAt(positiveCharacter.centers, `${positivePath}.centers`),
            [center],
            `${positivePath}.centers`,
        )

        const negativePath = `$.parameters.v4_negative_prompt.caption.char_captions[${index}]`
        const negativeCharacter = recordAt(negativeCharacters[index], negativePath)
        expectValue(negativeCharacter.char_caption, negative, `${negativePath}.char_caption`)
        expectValue(
            arrayAt(negativeCharacter.centers, `${negativePath}.centers`),
            [center],
            `${negativePath}.centers`,
        )

        return { prompt, negativePrompt: negative, enabled: true, center }
    })
}

function reconstructCharacterReferences(parameters: JsonObject): CharacterReferenceOptions[] | undefined {
    const referenceKeys = [
        'director_reference_descriptions',
        'director_reference_information_extracted',
        'director_reference_strength_values',
        'director_reference_secondary_strength_values',
        'director_reference_images_cached',
        'director_reference_images',
    ] as const
    if (!referenceKeys.some(key => own(parameters, key))) return undefined
    if (own(parameters, 'director_reference_images')) {
        invalid('$.parameters.director_reference_images', 'this imported fixture adapter expects cached references')
    }

    const descriptions = arrayAt(
        parameters.director_reference_descriptions,
        '$.parameters.director_reference_descriptions',
    )
    const information = arrayAt(
        parameters.director_reference_information_extracted,
        '$.parameters.director_reference_information_extracted',
    )
    const strengths = arrayAt(
        parameters.director_reference_strength_values,
        '$.parameters.director_reference_strength_values',
    )
    const secondaryStrengths = arrayAt(
        parameters.director_reference_secondary_strength_values,
        '$.parameters.director_reference_secondary_strength_values',
    )
    const cachedImages = arrayAt(
        parameters.director_reference_images_cached,
        '$.parameters.director_reference_images_cached',
    )
    for (const [name, values] of [
        ['director_reference_information_extracted', information],
        ['director_reference_strength_values', strengths],
        ['director_reference_secondary_strength_values', secondaryStrengths],
        ['director_reference_images_cached', cachedImages],
    ] as const) {
        expectValue(values.length, descriptions.length, `$.parameters.${name}`)
    }

    return descriptions.map((value, index) => {
        const path = `$.parameters.director_reference_descriptions[${index}]`
        const description = recordAt(value, path)
        const caption = recordAt(description.caption, `${path}.caption`)
        const referenceType = referenceTypeAt(caption.base_caption, `${path}.caption.base_caption`)
        expectValue(caption.char_captions, [], `${path}.caption.char_captions`)
        expectValue(description.legacy_uc, false, `${path}.legacy_uc`)
        expectValue(information[index], 1, `$.parameters.director_reference_information_extracted[${index}]`)

        const secondaryStrength = numberAt(
            secondaryStrengths[index],
            `$.parameters.director_reference_secondary_strength_values[${index}]`,
        )
        const cached = recordAt(
            cachedImages[index],
            `$.parameters.director_reference_images_cached[${index}]`,
        )
        return {
            referenceType,
            strength: numberAt(
                strengths[index],
                `$.parameters.director_reference_strength_values[${index}]`,
            ),
            fidelity: 1 - secondaryStrength,
            cacheSecretKey: stringAt(
                cached.cache_secret_key,
                `$.parameters.director_reference_images_cached[${index}].cache_secret_key`,
            ),
        }
    })
}

function asExpectedPayload(fixture: JsonObject, parameters: JsonObject): NaiImagePayload {
    const action = fixture.action
    if (action !== 'generate' && action !== 'img2img' && action !== 'infill') {
        invalid('$.action', 'expected generate, img2img, or infill')
    }
    stringAt(fixture.input, '$.input')
    stringAt(fixture.model, '$.model')

    // Preserve the complete fixture object. Reconstructing only the known
    // fields here would silently discard a newly added top-level key and let
    // parity pass even though the target builder omitted it.
    expectValue(fixture.parameters, parameters, '$.parameters')
    return fixture as unknown as NaiImagePayload
}

/**
 * Reverses a sanitized NAIS3/NAI-web payload into the current target builder's
 * input contract. Derived prompt fields are validated before their target-side
 * quality and UC decorations are removed; the adapter never edits the fixture.
 */
export function adaptNaiWebPayloadFixture(value: unknown): AdaptedNaiWebFixture {
    const fixture = recordAt(value, '$')
    const parameters = recordAt(fixture.parameters, '$.parameters')
    const expected = asExpectedPayload(fixture, parameters)
    const qualityToggle = booleanAt(parameters.qualityToggle, '$.parameters.qualityToggle')
    const ucPreset = ucPresetAt(parameters.ucPreset)
    const useCoords = booleanAt(parameters.use_coords, '$.parameters.use_coords')
    const prompt = removeQualitySuffix(expected.input, qualityToggle)
    const capturedNegative = stringAt(parameters.negative_prompt, '$.parameters.negative_prompt')
    const negativePrompt = removeUcPrefix(capturedNegative, ucPreset)
    const width = numberAt(parameters.width, '$.parameters.width')
    const height = numberAt(parameters.height, '$.parameters.height')
    const sigma = parameters.skip_cfg_above_sigma
    if (sigma !== null) numberAt(sigma, '$.parameters.skip_cfg_above_sigma')
    const variety = sigma !== null

    const positiveV4 = recordAt(parameters.v4_prompt, '$.parameters.v4_prompt')
    const positiveCaption = recordAt(positiveV4.caption, '$.parameters.v4_prompt.caption')
    const negativeV4 = recordAt(parameters.v4_negative_prompt, '$.parameters.v4_negative_prompt')
    const negativeCaption = recordAt(negativeV4.caption, '$.parameters.v4_negative_prompt.caption')
    expectValue(positiveCaption.base_caption, expected.input, '$.parameters.v4_prompt.caption.base_caption')
    expectValue(negativeCaption.base_caption, capturedNegative, '$.parameters.v4_negative_prompt.caption.base_caption')

    const request: GenerationRequest = {
        prompt,
        negativePrompt,
        model: expected.model,
        width,
        height,
        steps: numberAt(parameters.steps, '$.parameters.steps'),
        cfgScale: numberAt(parameters.scale, '$.parameters.scale'),
        cfgRescale: numberAt(parameters.cfg_rescale, '$.parameters.cfg_rescale'),
        sampler: stringAt(parameters.sampler, '$.parameters.sampler'),
        noiseSchedule: stringAt(parameters.noise_schedule, '$.parameters.noise_schedule'),
        seed: numberAt(parameters.seed, '$.parameters.seed'),
        variety,
        qualityToggle,
        ucPreset,
        characterPrompts: reconstructCharacters(parameters, useCoords),
        useCoords,
    }
    expectValue(
        sigma,
        varietySigma({ model: request.model, variety, width, height }),
        '$.parameters.skip_cfg_above_sigma',
    )

    const options: BuildOptions = {
        imageFormat: imageFormatAt(parameters.image_format),
    }
    const stream = streamAt(parameters.stream)
    if (stream) options.stream = stream
    const characterReferences = reconstructCharacterReferences(parameters)
    if (characterReferences) options.characterReferences = characterReferences

    if (expected.action === 'img2img') {
        stringAt(parameters.image_cache_secret_key, '$.parameters.image_cache_secret_key')
        options.i2i = {
            strength: numberAt(parameters.strength, '$.parameters.strength'),
            noise: numberAt(parameters.noise, '$.parameters.noise'),
            extraNoiseSeed: numberAt(parameters.extra_noise_seed, '$.parameters.extra_noise_seed'),
            colorCorrect: booleanAt(parameters.color_correct, '$.parameters.color_correct'),
            imageBase64: REDACTED_BASE64,
        }
        return { kind: 'transport-gap', gapKind: 'cached-i2i', expected, request, options }
    }
    if (expected.action !== 'generate') {
        invalid('$.action', 'the imported fixture set supports generate and cached img2img only')
    }

    if (own(parameters, 'reference_image_multiple_cached')) {
        const cachedVibes = arrayAt(
            parameters.reference_image_multiple_cached,
            '$.parameters.reference_image_multiple_cached',
        )
        const strengths = arrayAt(
            parameters.reference_strength_multiple,
            '$.parameters.reference_strength_multiple',
        )
        expectValue(strengths.length, cachedVibes.length, '$.parameters.reference_strength_multiple')
        options.vibes = cachedVibes.map((value, index) => {
            const path = `$.parameters.reference_image_multiple_cached[${index}]`
            const cached = recordAt(value, path)
            stringAt(cached.cache_secret_key, `${path}.cache_secret_key`)
            stringAt(cached.data, `${path}.data`)
            return {
                strength: numberAt(strengths[index], `$.parameters.reference_strength_multiple[${index}]`),
                encodedVibeBase64: REDACTED_BASE64,
            }
        })
        return { kind: 'transport-gap', gapKind: 'cached-vibe', expected, request, options }
    }
    if (own(parameters, 'reference_strength_multiple')) {
        invalid(
            '$.parameters.reference_strength_multiple',
            'strengths require reference_image_multiple_cached in this imported fixture set',
        )
    }

    return { kind: 'exact', expected, request, options }
}

export function buildAdaptedNaiWebPayload(adapted: AdaptedNaiWebFixture): NaiImagePayload {
    return buildGenerateImagePayload(adapted.request, adapted.options)
}
