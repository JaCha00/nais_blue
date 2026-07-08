export type UcPresetIndex = 0 | 1 | 2 | 3 | 4

export const QUALITY_TAGS_SUFFIX = ', very aesthetic, masterpiece, no text'

const UC_HEAVY =
    'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'

export const UC_PRESETS_V45_FULL: Record<UcPresetIndex, string> = {
    0: UC_HEAVY,
    1: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    2: '',
    3: `${UC_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
    4: '',
}

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
