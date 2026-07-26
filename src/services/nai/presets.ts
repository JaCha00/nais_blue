import {
    QUALITY_TAGS_SUFFIX,
    UC_PRESETS_V45_FULL,
    type UcPresetIndex,
} from '@/lib/nai-preset-text'

export { QUALITY_TAGS_SUFFIX, UC_PRESETS_V45_FULL, type UcPresetIndex }

export function removeComments(prompt: string): string {
    return prompt
        .split('\n')
        .filter(line => !line.trimStart().startsWith('#'))
        .join('\n')
}

export function mergeQualityTags(prompt: string, qualityToggle: boolean): string {
    return qualityToggle ? `${prompt}${QUALITY_TAGS_SUFFIX}` : prompt
}

export function mergeUcPreset(negativePrompt: string, ucPreset: UcPresetIndex): string {
    const preset = UC_PRESETS_V45_FULL[ucPreset]
    if (!preset) return negativePrompt
    return negativePrompt ? `${preset}, ${negativePrompt}` : preset
}
