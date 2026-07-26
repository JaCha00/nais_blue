import { styleCombinationIdentity } from '../identity'
import { createStyleLabRandom } from '../random'
import { classifyStyleEvolutionAxes, styleEvolutionArchiveKey } from './archive'
import { mutateStyleGenome, type StyleMutationWeights } from './mutation'
import type { EvolutionProposal, StyleEvolutionTag } from './types'

export interface EvolutionPolicyCandidate {
    id: string
    tags: readonly StyleEvolutionTag[]
    generation: number
    predictedUtility: number
    uncertainty: number
}

function tagSet(tags: readonly StyleEvolutionTag[]): Set<string> {
    return new Set(tags.map(tag => `${tag.kind}:${tag.tag.trim().toLowerCase()}`))
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
    if (left.size === 0 || right.size === 0) return 0
    let overlap = 0
    for (const item of left) if (right.has(item)) overlap += 1
    return overlap / (left.size + right.size - overlap)
}

function genomeNovelty(tags: readonly StyleEvolutionTag[], references: readonly EvolutionPolicyCandidate[]): number {
    if (references.length === 0) return 1
    const features = tagSet(tags)
    const nearest = Math.max(...references.map(candidate => jaccard(features, tagSet(candidate.tags))))
    return 1 - nearest
}

/** Generates free blueprints first and ranks them before any render budget is consumed. */
export function proposeStyleEvolution(input: {
    boardId: string
    candidates: readonly EvolutionPolicyCandidate[]
    artistPool: readonly string[]
    childCount: number
    minTags: number
    maxTags: number
    minWeight: number
    maxWeight: number
    rootSeed: number
    mutationWeights?: StyleMutationWeights
}): EvolutionProposal[] {
    if (input.candidates.length < 2) return []
    const parents = [...input.candidates].sort((left, right) => (
        right.predictedUtility - left.predictedUtility
        || right.uncertainty - left.uncertainty
        || left.id.localeCompare(right.id)
    ))
    const parentPool = parents.slice(0, Math.max(2, Math.min(parents.length, 12)))
    const random = createStyleLabRandom(input.rootSeed, `map-elites:${input.boardId}`)
    const existingHashes = new Set(input.candidates.map(candidate => styleCombinationIdentity(candidate.tags).renderHash))
    const proposals: EvolutionProposal[] = []
    const target = Math.max(1, Math.min(100, Math.floor(input.childCount)))
    let attempts = 0
    while (proposals.length < target && attempts < target * 30) {
        attempts += 1
        const parentA = parentPool[random.nextInt(parentPool.length)]
        let parentB = parentPool[random.nextInt(parentPool.length)]
        if (parentB.id === parentA.id) parentB = parentPool[(parentPool.indexOf(parentA) + 1) % parentPool.length]
        const rngSeed = random.nextUint32()
        const mutation = mutateStyleGenome({
            parentA: parentA.tags,
            parentB: parentB.tags,
            artistPool: input.artistPool,
            minTags: input.minTags,
            maxTags: input.maxTags,
            minWeight: input.minWeight,
            maxWeight: input.maxWeight,
            rngSeed,
            weights: input.mutationWeights,
        })
        const renderHash = styleCombinationIdentity(mutation.tags).renderHash
        if (existingHashes.has(renderHash)) continue
        existingHashes.add(renderHash)
        const novelty = genomeNovelty(mutation.tags, input.candidates)
        const predictedUtility = (parentA.predictedUtility + parentB.predictedUtility) / 2
        const uncertainty = Math.max(parentA.uncertainty, parentB.uncertainty) * 0.8 + novelty * 0.2
        const axes = classifyStyleEvolutionAxes(mutation.tags)
        proposals.push({
            tags: mutation.tags,
            parentIds: [parentA.id, parentB.id],
            operator: mutation.operator,
            diff: mutation.diff,
            rngSeed,
            generation: Math.max(parentA.generation, parentB.generation) + 1,
            predictedUtility,
            uncertainty,
            novelty,
            preScore: predictedUtility + uncertainty * 0.25 + novelty * 0.5,
            archiveKey: styleEvolutionArchiveKey(input.boardId, axes),
        })
    }
    return proposals.sort((left, right) => right.preScore - left.preScore || left.rngSeed - right.rngSeed)
}
