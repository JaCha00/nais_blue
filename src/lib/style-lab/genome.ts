import {
    WeightedPromptTag,
    clampNumber,
    normalizeArtistList,
    normalizePromptTag,
} from './prompt-format'

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

export type StyleLabRandomFunction = () => number

function randomIndex(random: StyleLabRandomFunction, maxExclusive: number): number {
    return Math.min(maxExclusive - 1, Math.max(0, Math.floor(random() * maxExclusive)))
}

function shuffleWithRandom<T>(values: readonly T[], random: StyleLabRandomFunction): T[] {
    const shuffled = [...values]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const target = randomIndex(random, index + 1)
        const current = shuffled[index]
        shuffled[index] = shuffled[target]
        shuffled[target] = current
    }
    return shuffled
}

export function randomWeight(
    minWeight: number,
    maxWeight: number,
    random: StyleLabRandomFunction = Math.random,
): number {
    const min = clampNumber(Math.min(minWeight, maxWeight), 0.2, 2.0)
    const max = clampNumber(Math.max(minWeight, maxWeight), 0.2, 2.0)
    return Math.round((min + random() * (max - min)) * 10) / 10
}

export function genomeSignature(tags: WeightedPromptTag[]): string {
    return tags
        .map(rawTag => {
            const tag = normalizePromptTag(rawTag)
            if (!tag.tag) return ''
            return `${tag.kind}:${tag.tag.trim().toLowerCase()}:${tag.weight.toFixed(1)}`
        })
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
    random: StyleLabRandomFunction = Math.random,
): WeightedPromptTag[] {
    const pool = normalizeArtistList(artistPool)
    if (pool.length === 0) return []

    const safeMin = clampNumber(Math.min(minTags, maxTags), 1, Math.max(1, pool.length))
    const safeMax = clampNumber(Math.max(minTags, maxTags), safeMin, Math.max(safeMin, pool.length))
    const count = Math.min(pool.length, safeMin + randomIndex(random, safeMax - safeMin + 1))
    const shuffled = shuffleWithRandom(pool, random)

    return shuffled.slice(0, count).map(artist => ({
        tag: artist,
        kind: 'artist',
        weight: randomWeight(minWeight, maxWeight, random),
        artist,
    }))
}

export interface EvolutionGenomeCandidate {
    id: string
    tags: WeightedPromptTag[]
    elo: number
    battles: number
    favorite: boolean
    generation: number
}

export interface EvolutionGenomeOptions {
    artistPool: string[]
    minTags: number
    maxTags: number
    minWeight: number
    maxWeight: number
    parentCount: number
    childCount: number
    mutationRate: number
}

export interface EvolutionGenomePlan {
    parentIds: string[]
    parentCount: number
    generation: number
    childTags: WeightedPromptTag[][]
}

export function createEvolutionPlan(
    combinations: EvolutionGenomeCandidate[],
    options: EvolutionGenomeOptions,
    random: StyleLabRandomFunction = Math.random,
): EvolutionGenomePlan | null {
    const rankedPool = combinations
        .filter(combo => combo.favorite || combo.battles > 0)
        .sort((a, b) => b.elo - a.elo || b.battles - a.battles)
    const allCombinationsByElo = [...combinations].sort((a, b) => b.elo - a.elo)
    const parents = (rankedPool.length >= 2 ? rankedPool : allCombinationsByElo).slice(0, options.parentCount)
    if (parents.length < 2) return null

    const nextGeneration = Math.max(0, ...combinations.map(combo => combo.generation)) + 1
    const existingSignatures = new Set(combinations.map(combo => genomeSignature(combo.tags)))
    const childTags: WeightedPromptTag[][] = []
    let attempts = 0

    while (childTags.length < options.childCount && attempts < options.childCount * 50) {
        attempts++
        const parentA = parents[randomIndex(random, parents.length)]
        let parentB = parents[randomIndex(random, parents.length)]
        while (parentB.id === parentA.id) {
            parentB = parents[randomIndex(random, parents.length)]
        }

        const tags = breedWeightedTags(
            parentA.tags,
            parentB.tags,
            options.artistPool,
            options.minTags,
            options.maxTags,
            options.minWeight,
            options.maxWeight,
            options.mutationRate,
            random,
        )
        const signature = genomeSignature(tags)
        if (existingSignatures.has(signature)) continue
        existingSignatures.add(signature)
        childTags.push(tags)
    }

    if (childTags.length === 0) return null

    return {
        parentIds: parents.map(parent => parent.id),
        parentCount: parents.length,
        generation: nextGeneration,
        childTags,
    }
}

export function breedWeightedTags(
    parentA: WeightedPromptTag[],
    parentB: WeightedPromptTag[],
    artistPool: string[],
    minTags: number,
    maxTags: number,
    minWeight: number,
    maxWeight: number,
    mutationRate: number,
    random: StyleLabRandomFunction = Math.random,
): WeightedPromptTag[] {
    const inherited = new Map<string, WeightedPromptTag>()
    const allParents = [...parentA, ...parentB].map(normalizePromptTag)

    for (const tag of shuffleWithRandom(allParents, random)) {
        const key = `${tag.kind}:${tag.tag.toLowerCase()}`
        const previous = inherited.get(key)
        const inheritedWeight = previous
            ? Math.round(((previous.weight + tag.weight) / 2) * 10) / 10
            : tag.weight
        inherited.set(key, { ...tag, weight: inheritedWeight })
    }

    const normalizedPool = normalizeArtistList(artistPool)
    const targetMin = clampNumber(Math.min(minTags, maxTags), 1, Math.max(1, normalizedPool.length || inherited.size || 1))
    const targetMax = clampNumber(Math.max(minTags, maxTags), targetMin, Math.max(targetMin, normalizedPool.length || inherited.size || 1))
    const targetCount = targetMin + randomIndex(random, targetMax - targetMin + 1)
    let child = shuffleWithRandom([...inherited.values()], random).slice(0, targetCount)

    child = child.map(tag => {
        if (random() > mutationRate) return tag
        const delta = (random() < 0.5 ? -0.2 : 0.2)
        return {
            ...tag,
            weight: Math.round(clampNumber(tag.weight + delta, minWeight, maxWeight) * 10) / 10,
        }
    })

    const childKeys = new Set(child.filter(tag => tag.kind === 'artist').map(tag => tag.tag.toLowerCase()))
    const candidates = normalizedPool.filter(artist => !childKeys.has(artist.toLowerCase()))

    if (candidates.length > 0 && (child.length < targetMin || random() < mutationRate)) {
        const artist = candidates[randomIndex(random, candidates.length)]
        child.push({ tag: artist, kind: 'artist', weight: randomWeight(minWeight, maxWeight, random), artist })
    }

    if (child.length > targetMax) {
        child = shuffleWithRandom(child, random).slice(0, targetMax)
    }

    if (child.length < targetMin && normalizedPool.length > child.length) {
        const keys = new Set(child.filter(tag => tag.kind === 'artist').map(tag => tag.tag.toLowerCase()))
        for (const artist of shuffleWithRandom(normalizedPool, random)) {
            if (child.length >= targetMin) break
            if (keys.has(artist.toLowerCase())) continue
            child.push({ tag: artist, kind: 'artist', weight: randomWeight(minWeight, maxWeight, random), artist })
            keys.add(artist.toLowerCase())
        }
    }

    return child.map(normalizePromptTag)
}
