export type UcPresetIndex = 0 | 1 | 2 | 3 | 4

export const QUALITY_TAGS_SUFFIX = ', very aesthetic, masterpiece, no text'

const UC_HEAVY =
    'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'

/**
 * This table is the shared V4.5 Full wire contract for payload assembly and
 * metadata import. Keeping both directions on one dependency prevents preset
 * indices or text from drifting during a generation/import round trip.
 */
export const UC_PRESETS_V45_FULL: Readonly<Record<UcPresetIndex, string>> = Object.freeze({
    0: UC_HEAVY,
    1: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    2: '',
    3: `${UC_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
    4: '',
})
