export type PromptTagKind = 'artist' | 'style' | 'quality' | 'subject' | 'plain'

export interface WeightedPromptTag {
    tag: string
    kind: PromptTagKind
    weight: number
    artist?: string
}

export interface StyleLabPromptParts {
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    inpaintingPrompt: string
}

export const STYLE_LAB_ARTIST_PLACEHOLDER = '{{artist_tags}}'
export const STYLE_LAB_DEFAULT_TEMPLATE = '{{basePrompt}}, {{inpaintingPrompt}}, {{artist_tags}}, {{additionalPrompt}}, {{detailPrompt}}'

export function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

export function normalizeArtistName(input: string): string {
    let value = input.trim().replace(/,+$/g, '').trim()
    if (!value) return ''

    const weightedMatch = value.match(/^(?:\d+(?:\.\d+)?::\s*)?artist:([\s\S]*?)\s*(?:::\s*)?$/i)
    if (weightedMatch) {
        value = weightedMatch[1]
    } else {
        value = value
            .replace(/^\s*[-•*]\s*/, '')
            .replace(/^\s*\d+[.)]\s*/, '')
    }

    value = value
        .replace(/^\d+(?:\.\d+)?::\s*/i, '')
        .replace(/^artist:/i, '')
        .replace(/\s*::\s*$/g, '')
        .replace(/,+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()

    return value
}

export function parseArtistInput(input: string): string[] {
    const seen = new Set<string>()
    const artists: string[] = []

    for (const raw of input.split(/[\n,]+/)) {
        const artist = normalizeArtistName(raw)
        if (!artist) continue
        const key = artist.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        artists.push(artist)
    }

    return artists
}

export function normalizeArtistList(artists: string[]): string[] {
    return parseArtistInput(artists.join('\n'))
}

function normalizePlainTag(input: string): string {
    return input
        .trim()
        .replace(/,+$/g, '')
        .replace(/^\s*[-•*]\s*/, '')
        .replace(/^\s*\d+[.)]\s*/, '')
        .replace(/^\d+(?:\.\d+)?::\s*/i, '')
        .replace(/\s*::\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function detectPromptTagKind(tag: Partial<WeightedPromptTag> & { artist?: string }): PromptTagKind {
    if (tag.kind) return tag.kind
    const raw = String(tag.tag ?? tag.artist ?? '')
    return tag.artist || /^(?:\d+(?:\.\d+)?::\s*)?artist:/i.test(raw) ? 'artist' : 'plain'
}

export function normalizePromptTag(tag: Partial<WeightedPromptTag> & { artist?: string }): WeightedPromptTag {
    const kind = detectPromptTagKind(tag)
    const text = kind === 'artist'
        ? normalizeArtistName(String(tag.tag ?? tag.artist ?? ''))
        : normalizePlainTag(String(tag.tag ?? tag.artist ?? ''))
    const weight = Math.round(clampNumber(Number.isFinite(tag.weight) ? Number(tag.weight) : 1.0, 0.2, 2.0) * 10) / 10

    return {
        tag: text,
        kind,
        weight,
        ...(kind === 'artist' ? { artist: text } : {}),
    }
}

export function formatWeightedPromptTag(tag: WeightedPromptTag): string {
    const normalized = normalizePromptTag(tag)
    if (!normalized.tag) return ''
    if (normalized.kind === 'artist') {
        return `${normalized.weight.toFixed(1)}::artist:${normalized.tag} ::`
    }
    if (normalized.weight === 1.0) {
        return normalized.tag
    }
    return `${normalized.weight.toFixed(1)}::${normalized.tag} ::`
}

export function formatWeightedPromptTags(tags: WeightedPromptTag[]): string {
    return tags.map(formatWeightedPromptTag).filter(Boolean).join(', ')
}

export function buildStyleLabPrompt(
    template: string,
    artistTags: string,
    parts: StyleLabPromptParts,
): string {
    const source = template.trim() || STYLE_LAB_DEFAULT_TEMPLATE
    const replacements: Record<string, string> = {
        [STYLE_LAB_ARTIST_PLACEHOLDER]: artistTags,
        '{{basePrompt}}': parts.basePrompt,
        '{{additionalPrompt}}': parts.additionalPrompt,
        '{{detailPrompt}}': parts.detailPrompt,
        '{{inpaintingPrompt}}': parts.inpaintingPrompt,
    }

    let rendered = source
    for (const [key, value] of Object.entries(replacements)) {
        rendered = rendered.split(key).join(value)
    }

    if (!source.includes(STYLE_LAB_ARTIST_PLACEHOLDER)) {
        rendered = rendered.trim() ? `${rendered}, ${artistTags}` : artistTags
    }

    return compactPrompt(rendered)
}

export function compactPrompt(prompt: string): string {
    return prompt
        .replace(/[\t ]+/g, ' ')
        .replace(/\s+,/g, ',')
        .replace(/,\s*,+/g, ',')
        .replace(/^\s*,\s*/g, '')
        .replace(/\s*,\s*$/g, '')
        .trim()
}

export function extractArtistTagsFromText(text: string): WeightedPromptTag[] {
    const found = new Map<string, WeightedPromptTag>()
    const weightedRegex = /(\d+(?:\.\d+)?)::\s*artist:([\s\S]*?)\s*::/gi
    let weightedMatch: RegExpExecArray | null

    while ((weightedMatch = weightedRegex.exec(text)) !== null) {
        const artist = normalizeArtistName(weightedMatch[2])
        if (!artist) continue
        found.set(artist.toLowerCase(), {
            tag: artist,
            kind: 'artist',
            weight: clampNumber(Number(weightedMatch[1]), 0.2, 2.0),
            artist,
        })
    }

    const plainRegex = /(?:^|[,\n])\s*artist:([^,\n]+)/gi
    let plainMatch: RegExpExecArray | null
    while ((plainMatch = plainRegex.exec(text)) !== null) {
        const artist = normalizeArtistName(plainMatch[1])
        if (!artist) continue
        const key = artist.toLowerCase()
        if (!found.has(key)) {
            found.set(key, { tag: artist, kind: 'artist', weight: 1.0, artist })
        }
    }

    return [...found.values()]
}
