import { createStyleLabRandom } from '../random'
import type {
    StyleEvolutionOperator,
    StyleEvolutionTag,
} from './types'

export type MutableStyleEvolutionOperator = Exclude<StyleEvolutionOperator, 'legacy-import'>

export interface StyleMutationResult {
    tags: StyleEvolutionTag[]
    operator: MutableStyleEvolutionOperator
    diff: string[]
}

export type StyleMutationWeights = Partial<Record<MutableStyleEvolutionOperator, number>>

const OPERATORS: MutableStyleEvolutionOperator[] = [
    'tag-add', 'tag-delete', 'tag-replace', 'weight-jitter',
    'weight-mix', 'order-swap', 'order-move', 'parent-splice',
]

function key(tag: StyleEvolutionTag): string {
    return `${tag.kind}:${tag.tag.trim().toLowerCase()}`
}

function clampWeight(value: number, min: number, max: number): number {
    return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10
}

function normalize(tags: readonly StyleEvolutionTag[], minWeight: number, maxWeight: number): StyleEvolutionTag[] {
    const unique = new Set<string>()
    const result: StyleEvolutionTag[] = []
    for (const raw of tags) {
        const tag = raw.tag.trim()
        const item = { ...raw, tag, weight: clampWeight(raw.weight, minWeight, maxWeight) }
        if (!tag || unique.has(key(item))) continue
        unique.add(key(item))
        result.push(item)
    }
    return result
}

function chooseOperator(random: () => number, weights: StyleMutationWeights): MutableStyleEvolutionOperator {
    const values = OPERATORS.map(operator => Math.max(0, weights[operator] ?? 1))
    const total = values.reduce((sum, value) => sum + value, 0)
    if (total <= 0) return 'weight-jitter'
    let target = random() * total
    for (let index = 0; index < OPERATORS.length; index += 1) {
        target -= values[index]
        if (target <= 0) return OPERATORS[index]
    }
    return OPERATORS[OPERATORS.length - 1]
}

/** Applies one reproducible mutation and repairs only count/weight invariants. */
export function mutateStyleGenome(input: {
    parentA: readonly StyleEvolutionTag[]
    parentB?: readonly StyleEvolutionTag[]
    artistPool: readonly string[]
    minTags: number
    maxTags: number
    minWeight: number
    maxWeight: number
    rngSeed: number
    weights?: StyleMutationWeights
}): StyleMutationResult {
    const random = createStyleLabRandom(input.rngSeed, 'map-elites-mutation')
    const draw = () => random.nextFloat()
    const index = (length: number) => length <= 1 ? 0 : random.nextInt(length)
    const minTags = Math.max(1, Math.floor(input.minTags))
    const maxTags = Math.max(minTags, Math.floor(input.maxTags))
    let tags = normalize(input.parentA, input.minWeight, input.maxWeight)
    const parentB = normalize(input.parentB ?? [], input.minWeight, input.maxWeight)
    let operator = chooseOperator(draw, input.weights ?? {})
    const diff: string[] = []

    const addTag = (): boolean => {
        if (tags.length >= maxTags) return false
        const existing = new Set(tags.map(key))
        const choices = input.artistPool
            .map(name => name.trim())
            .filter(Boolean)
            .filter(name => !existing.has(`artist:${name.toLowerCase()}`))
        if (choices.length === 0) return false
        const name = choices[index(choices.length)]
        tags.push({ tag: name, artist: name, kind: 'artist', weight: clampWeight(
            input.minWeight + draw() * (input.maxWeight - input.minWeight),
            input.minWeight,
            input.maxWeight,
        ) })
        diff.push(`add:${name}`)
        return true
    }

    if (operator === 'tag-add' && !addTag()) operator = 'weight-jitter'
    if (operator === 'tag-delete') {
        if (tags.length > minTags) {
            const [removed] = tags.splice(index(tags.length), 1)
            diff.push(`delete:${removed.tag}`)
        } else operator = 'weight-jitter'
    }
    if (operator === 'tag-replace') {
        if (tags.length > 0) {
            const target = index(tags.length)
            const removed = tags[target]
            tags.splice(target, 1)
            if (!addTag()) tags.splice(target, 0, removed)
            else diff.unshift(`replace:${removed.tag}`)
        } else if (!addTag()) operator = 'weight-jitter'
    }
    if (operator === 'weight-jitter' && tags.length > 0) {
        const target = index(tags.length)
        const before = tags[target]
        const delta = draw() < 0.5 ? -0.2 : 0.2
        tags[target] = { ...before, weight: clampWeight(before.weight + delta, input.minWeight, input.maxWeight) }
        diff.push(`weight:${before.tag}:${before.weight}->${tags[target].weight}`)
    }
    if (operator === 'weight-mix' && tags.length > 0) {
        const target = index(tags.length)
        const before = tags[target]
        const match = parentB.find(item => key(item) === key(before)) ?? parentB[index(parentB.length)]
        if (match === undefined) operator = 'weight-jitter'
        else {
            tags[target] = { ...before, weight: clampWeight((before.weight + match.weight) / 2, input.minWeight, input.maxWeight) }
            diff.push(`mix-weight:${before.tag}:${before.weight}->${tags[target].weight}`)
        }
    }
    if (operator === 'order-swap') {
        if (tags.length < 2) operator = 'weight-jitter'
        else {
            const left = index(tags.length)
            let right = index(tags.length)
            if (right === left) right = (right + 1) % tags.length
            const leftName = tags[left].tag
            const rightName = tags[right].tag
            ;[tags[left], tags[right]] = [tags[right], tags[left]]
            diff.push(`swap:${leftName}:${rightName}`)
        }
    }
    if (operator === 'order-move') {
        if (tags.length < 2) operator = 'weight-jitter'
        else {
            const from = index(tags.length)
            let to = index(tags.length)
            if (to === from) to = (to + 1) % tags.length
            const [moved] = tags.splice(from, 1)
            tags.splice(to, 0, moved)
            diff.push(`move:${moved.tag}:${from}->${to}`)
        }
    }
    if (operator === 'parent-splice') {
        if (parentB.length === 0) operator = 'weight-jitter'
        else {
            const cutA = Math.max(1, Math.floor(tags.length * (0.25 + draw() * 0.5)))
            const cutB = Math.floor(parentB.length * draw() * 0.5)
            tags = normalize([...tags.slice(0, cutA), ...parentB.slice(cutB)], input.minWeight, input.maxWeight)
            diff.push(`splice:${cutA}:${cutB}`)
        }
    }

    tags = normalize(tags, input.minWeight, input.maxWeight)
    while (tags.length < minTags && addTag()) { /* bounded by the finite pool */ }
    if (tags.length > maxTags) tags = tags.slice(0, maxTags)
    // Degenerate fallbacks still produce an explicit deterministic change attempt.
    if (diff.length === 0 && tags.length > 0) {
        const before = tags[0]
        tags[0] = { ...before, weight: clampWeight(before.weight + 0.2, input.minWeight, input.maxWeight) }
        diff.push(`fallback-weight:${before.tag}:${before.weight}->${tags[0].weight}`)
        operator = 'weight-jitter'
    }
    return { tags, operator, diff }
}
