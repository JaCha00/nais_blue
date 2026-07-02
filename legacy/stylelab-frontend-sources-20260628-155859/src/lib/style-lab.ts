export interface WeightedArtistTag {
    artist: string
    weight: number
}

export interface StyleLabPromptParts {
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    inpaintingPrompt: string
}

export const STYLE_LAB_ARTIST_PLACEHOLDER = '{{artist_tags}}'
export const STYLE_LAB_DEFAULT_TEMPLATE = '{{basePrompt}}, {{artist_tags}}, {{additionalPrompt}}, {{detailPrompt}}'

export const DEFAULT_STYLE_LAB_ARTISTS = [
    'shnva',
    'hwansang',
    'chamooi',
    'momoko (momopoco)',
    'torino aqua',
    'necomi',
    'zain',
    'rurudo',
    'mikan03 26',
    'ask (askzy)',
    'wlop',
    'rin yuu',
    'tiv',
    'fuzichoco',
    'lack',
    'redjuice',
    'kantoku',
    'hiten',
    'gomzi',
    'popqn',
    'ciloranko',
    'ke-ta',
    'anmi',
    'hews hack',
    'mignon',
    'pako',
    'lam (ramdayo)',
    'toi8',
    'saitom',
    'as109',
    'ideolo',
    'mika pikazo',
    'toi (number8)',
    'namie',
    'nagu',
    'ebifurya',
    'houkiboshi',
    'swd3e2',
    'modare',
    'yd (orange maru)',
]

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

export function randomWeight(minWeight: number, maxWeight: number): number {
    const min = clampNumber(Math.min(minWeight, maxWeight), 0.2, 2.0)
    const max = clampNumber(Math.max(minWeight, maxWeight), 0.2, 2.0)
    return Math.round((min + Math.random() * (max - min)) * 10) / 10
}

export function formatWeightedArtistTag(tag: WeightedArtistTag): string {
    return `${tag.weight.toFixed(1)}::artist:${tag.artist} ::`
}

export function formatWeightedArtistTags(tags: WeightedArtistTag[]): string {
    return tags.map(formatWeightedArtistTag).join(', ')
}

export function getCombinationSignature(tags: WeightedArtistTag[]): string {
    return tags
        .map(tag => tag.artist.trim().toLowerCase())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join('|')
}

export function createRandomWeightedTags(
    artistPool: string[],
    minTags: number,
    maxTags: number,
    minWeight: number,
    maxWeight: number,
): WeightedArtistTag[] {
    const pool = normalizeArtistList(artistPool)
    if (pool.length === 0) return []

    const safeMin = clampNumber(Math.min(minTags, maxTags), 1, Math.max(1, pool.length))
    const safeMax = clampNumber(Math.max(minTags, maxTags), safeMin, Math.max(safeMin, pool.length))
    const count = Math.min(pool.length, safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1)))
    const shuffled = [...pool].sort(() => Math.random() - 0.5)

    return shuffled.slice(0, count).map(artist => ({
        artist,
        weight: randomWeight(minWeight, maxWeight),
    }))
}

export function calculateElo(
    winnerRating: number,
    loserRating: number,
    kFactor = 32,
): { winner: number; loser: number } {
    const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400))
    const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400))

    return {
        winner: Math.round(winnerRating + kFactor * (1 - expectedWinner)),
        loser: Math.round(loserRating + kFactor * (0 - expectedLoser)),
    }
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

export function extractArtistTagsFromText(text: string): WeightedArtistTag[] {
    const found = new Map<string, WeightedArtistTag>()
    const weightedRegex = /(\d+(?:\.\d+)?)::\s*artist:([\s\S]*?)\s*::/gi
    let weightedMatch: RegExpExecArray | null

    while ((weightedMatch = weightedRegex.exec(text)) !== null) {
        const artist = normalizeArtistName(weightedMatch[2])
        if (!artist) continue
        found.set(artist.toLowerCase(), {
            artist,
            weight: clampNumber(Number(weightedMatch[1]), 0.2, 2.0),
        })
    }

    const plainRegex = /(?:^|[,\n])\s*artist:([^,\n]+)/gi
    let plainMatch: RegExpExecArray | null
    while ((plainMatch = plainRegex.exec(text)) !== null) {
        const artist = normalizeArtistName(plainMatch[1])
        if (!artist) continue
        const key = artist.toLowerCase()
        if (!found.has(key)) {
            found.set(key, { artist, weight: 1.0 })
        }
    }

    return [...found.values()]
}

export function breedWeightedTags(
    parentA: WeightedArtistTag[],
    parentB: WeightedArtistTag[],
    artistPool: string[],
    minTags: number,
    maxTags: number,
    minWeight: number,
    maxWeight: number,
    mutationRate: number,
): WeightedArtistTag[] {
    const inherited = new Map<string, WeightedArtistTag>()
    const allParents = [...parentA, ...parentB]

    for (const tag of allParents.sort(() => Math.random() - 0.5)) {
        const key = tag.artist.toLowerCase()
        const previous = inherited.get(key)
        const inheritedWeight = previous
            ? Math.round(((previous.weight + tag.weight) / 2) * 10) / 10
            : tag.weight
        inherited.set(key, { artist: tag.artist, weight: inheritedWeight })
    }

    const normalizedPool = normalizeArtistList(artistPool)
    const targetMin = clampNumber(Math.min(minTags, maxTags), 1, Math.max(1, normalizedPool.length || inherited.size || 1))
    const targetMax = clampNumber(Math.max(minTags, maxTags), targetMin, Math.max(targetMin, normalizedPool.length || inherited.size || 1))
    const targetCount = targetMin + Math.floor(Math.random() * (targetMax - targetMin + 1))
    let child = [...inherited.values()].sort(() => Math.random() - 0.5).slice(0, targetCount)

    child = child.map(tag => {
        if (Math.random() > mutationRate) return tag
        const delta = (Math.random() < 0.5 ? -0.2 : 0.2)
        return {
            ...tag,
            weight: Math.round(clampNumber(tag.weight + delta, minWeight, maxWeight) * 10) / 10,
        }
    })

    const childKeys = new Set(child.map(tag => tag.artist.toLowerCase()))
    const candidates = normalizedPool.filter(artist => !childKeys.has(artist.toLowerCase()))

    if (candidates.length > 0 && (child.length < targetMin || Math.random() < mutationRate)) {
        const artist = candidates[Math.floor(Math.random() * candidates.length)]
        child.push({ artist, weight: randomWeight(minWeight, maxWeight) })
    }

    if (child.length > targetMax) {
        child = child.sort(() => Math.random() - 0.5).slice(0, targetMax)
    }

    if (child.length < targetMin && normalizedPool.length > child.length) {
        const keys = new Set(child.map(tag => tag.artist.toLowerCase()))
        for (const artist of normalizedPool.sort(() => Math.random() - 0.5)) {
            if (child.length >= targetMin) break
            if (keys.has(artist.toLowerCase())) continue
            child.push({ artist, weight: randomWeight(minWeight, maxWeight) })
            keys.add(artist.toLowerCase())
        }
    }

    return child.map(tag => ({
        artist: tag.artist,
        weight: Math.round(clampNumber(tag.weight, 0.2, 2.0) * 10) / 10,
    }))
}
