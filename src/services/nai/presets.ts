import {
    QUALITY_TAGS_SUFFIX,
    QUALITY_TAGS_BY_SELECTABLE_MODEL,
    UC_PRESETS_BY_SELECTABLE_MODEL,
    UC_PRESETS_V4_CURATED,
    UC_PRESETS_V4_FULL,
    UC_PRESETS_V45_CURATED,
    UC_PRESETS_V45_FULL,
    UC_PRESETS_V5,
    type UcPresetIndex,
} from '@/lib/nai-preset-text'

export {
    QUALITY_TAGS_SUFFIX,
    QUALITY_TAGS_BY_SELECTABLE_MODEL,
    UC_PRESETS_BY_SELECTABLE_MODEL,
    UC_PRESETS_V4_CURATED,
    UC_PRESETS_V4_FULL,
    UC_PRESETS_V45_CURATED,
    UC_PRESETS_V45_FULL,
    UC_PRESETS_V5,
    type UcPresetIndex,
}

export function removeComments(prompt: string): string {
    return prompt
        .split('\n')
        .filter(line => !line.trimStart().startsWith('#'))
        .join('\n')
}

function isV5Model(model: string): boolean {
    return model.startsWith('nai-diffusion-5-')
}

function appendPromptPart(prompt: string, part: string): string {
    if (!part) return prompt
    return prompt.trim().length > 0 ? `${prompt}, ${part}` : part
}

export function mergeQualityTags(
    prompt: string,
    qualityToggle: boolean,
    model = 'nai-diffusion-4-5-full',
    transparentBackground = false,
): string {
    let merged = prompt
    if (transparentBackground && isV5Model(model)) {
        merged = appendPromptPart(merged, 'transparent background')
    }
    if (!qualityToggle) return merged
    const suffix = QUALITY_TAGS_BY_SELECTABLE_MODEL[model]
        ?? QUALITY_TAGS_SUFFIX.replace(/^,\s*/, '')
    return appendPromptPart(merged, suffix)
}

export function mergeUcPreset(
    negativePrompt: string,
    ucPreset: UcPresetIndex,
    model = 'nai-diffusion-4-5-full',
): string {
    const preset = (UC_PRESETS_BY_SELECTABLE_MODEL[model] ?? UC_PRESETS_V45_FULL)[ucPreset]
    if (!preset) return negativePrompt
    return negativePrompt ? `${preset}, ${negativePrompt}` : preset
}

export function qualityPresetTagHint(qualityToggle: boolean): number {
    return qualityToggle ? 1 : 0
}

const UC_PRESET_TAG_HINTS: Readonly<Record<UcPresetIndex, number>> = Object.freeze({
    0: 2,
    1: 3,
    2: 5,
    3: 4,
    4: 0,
})

export function ucPresetTagHint(ucPreset: UcPresetIndex): number {
    return UC_PRESET_TAG_HINTS[ucPreset]
}
