import {
    activeStylePreferenceEvents,
    adaptiveMutationWeights,
    createEvolutionLineage,
    gaussianPreferenceModel,
    predictContextualPreference,
    proposeStyleEvolution,
    styleEvolutionNiche,
    trainContextualPreferenceModel,
    updateStyleEvolutionArchive,
    type EvolutionLineage,
    type EvolutionProposal,
    type StyleEvolutionArchiveCell,
    type StyleEvolutionTag,
    type TasteBoard,
} from '@/domain/style-lab'
import type { WeightedPromptTag } from '@/lib/style-lab'
import type { StyleCombination, StyleLabSettings } from '@/stores/style-lab-store'
import type { StyleLabRepository } from './style-lab-repository'
import { requestStyleLabPreviewRenders } from './request-preview-render'

export interface EvolveStyleBoardResult {
    childIds: string[]
    proposals: EvolutionProposal[]
    lineages: EvolutionLineage[]
    archive: StyleEvolutionArchiveCell[]
    queuedRenderCount: number
}

function asEvolutionTags(tags: readonly WeightedPromptTag[]): StyleEvolutionTag[] {
    return tags.map(tag => ({ ...tag }))
}

/**
 * Blueprint evolution is free and completes before rendering. Preference,
 * uncertainty, and tag-set novelty rank proposals; only an opted-in board budget
 * can enqueue the small top slice after lineage and archive persistence succeeds.
 */
export async function evolveStyleBoard(input: {
    candidates: readonly StyleCombination[]
    board: TasteBoard
    settings: StyleLabSettings
    artistPool: readonly string[]
    randomSeed: number
    repository: StyleLabRepository
    addCombination(tags: WeightedPromptTag[], generation: number): string | null
    now?: number
    autoRenderLimit?: number
    autoBudgetLimit?: number
    requestRenders?: typeof requestStyleLabPreviewRenders
}): Promise<EvolveStyleBoardResult> {
    const events = await input.repository.listPreferenceEvents()
    const activeEvents = activeStylePreferenceEvents(events)
    const collected = new Set(activeEvents
        .filter(event => event.action === 'collect' && event.boardId === input.board.id)
        .map(event => event.comboId))
    const positivelyRated = new Set(activeEvents
        .filter(event => event.action === 'like'
            || event.action === 'apply'
            || event.action === 'pair-win')
        .map(event => event.comboId))
    const preferredPool = input.candidates.filter(candidate => (
        collected.has(candidate.id) || positivelyRated.has(candidate.id) || candidate.favorite || candidate.battles > 0
    ))
    const source = preferredPool.length >= 2 ? preferredPool : input.candidates
    if (source.length < 2) return { childIds: [], proposals: [], lineages: [], archive: [], queuedRenderCount: 0 }

    const projections = gaussianPreferenceModel.replay(input.candidates, events).projections
    const embeddedLineages = input.candidates
        .map(candidate => candidate.lineage)
        .filter((lineage): lineage is EvolutionLineage => lineage !== undefined)
    if (embeddedLineages.length > 0) await input.repository.putEvolutionLineages(embeddedLineages)
    const [contexts, storedLineages] = await Promise.all([
        input.repository.listEvaluationContexts(),
        input.repository.listEvolutionLineages(),
    ])
    const lineageByChild = new Map(storedLineages.map(lineage => [lineage.childId, lineage]))
    const contextualCandidates = input.candidates.map(candidate => ({
        id: candidate.id,
        tags: candidate.tags,
        generation: candidate.generation,
        lineage: lineageByChild.get(candidate.id) ?? candidate.lineage ?? null,
    }))
    const contextualState = trainContextualPreferenceModel({
        boardId: input.board.id,
        candidates: contextualCandidates,
        events,
        contexts,
    })
    const latestContext = [...contexts].sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    const predictionById = Object.fromEntries(contextualCandidates.map(candidate => [
        candidate.id,
        predictContextualPreference({
            state: contextualState,
            candidate,
            context: latestContext,
            exploration: input.board.exploration,
        }),
    ]))
    const rawProposals = proposeStyleEvolution({
        boardId: input.board.id,
        candidates: source.map(candidate => ({
            id: candidate.id,
            tags: asEvolutionTags(candidate.tags),
            generation: candidate.generation,
            predictedUtility: (projections[candidate.id]?.mu ?? 0)
                + (predictionById[candidate.id]?.mu ?? 0) * 0.65,
            uncertainty: predictionById[candidate.id]?.sigma ?? projections[candidate.id]?.sigma ?? 1.4,
        })),
        artistPool: input.artistPool,
        childCount: input.settings.evolutionChildrenCount,
        minTags: input.settings.minTags,
        maxTags: input.settings.maxTags,
        minWeight: input.settings.minWeight,
        maxWeight: input.settings.maxWeight,
        rootSeed: input.randomSeed,
        mutationWeights: adaptiveMutationWeights(contextualState),
    })
    // Re-score free child blueprints directly rather than inheriting only their
    // parents' utility; this is the Phase 5 render-before-selection boundary.
    const proposals = rawProposals.map((proposal, index) => {
        const prediction = predictContextualPreference({
            state: contextualState,
            candidate: {
                id: `proposal:${index}`,
                tags: proposal.tags,
                generation: proposal.generation,
                lineage: { operator: proposal.operator, parentIds: proposal.parentIds },
            },
            context: latestContext,
            exploration: input.board.exploration,
        })
        return {
            ...proposal,
            predictedUtility: prediction.mu,
            uncertainty: prediction.sigma,
            preScore: prediction.score + proposal.novelty * 0.5,
        }
    }).sort((left, right) => right.preScore - left.preScore || left.rngSeed - right.rngSeed)
    const createdAt = input.now ?? Date.now()
    const accepted: Array<{ proposal: EvolutionProposal; childId: string }> = []
    for (const proposal of proposals) {
        const childId = input.addCombination(proposal.tags as WeightedPromptTag[], proposal.generation)
        if (childId !== null) accepted.push({ proposal, childId })
    }
    const lineages = accepted.map(({ proposal, childId }) => createEvolutionLineage({
        childId,
        boardId: input.board.id,
        parentIds: proposal.parentIds,
        operator: proposal.operator,
        diff: proposal.diff,
        rngSeed: proposal.rngSeed,
        generation: proposal.generation,
        createdAt,
    }))
    await input.repository.putEvolutionLineages(lineages)

    const familyCounts = new Map<string, number>()
    for (const candidate of input.candidates) {
        const niche = styleEvolutionNiche(asEvolutionTags(candidate.tags))
        familyCounts.set(niche, (familyCounts.get(niche) ?? 0) + 1)
    }
    const existing = await input.repository.listEvolutionArchive(input.board.id)
    const archive = updateStyleEvolutionArchive({
        boardId: input.board.id,
        existing,
        candidates: [
            ...input.candidates.map(candidate => {
                const tags = asEvolutionTags(candidate.tags)
                const niche = styleEvolutionNiche(tags)
                return {
                    comboId: candidate.id,
                    tags,
                    score: projections[candidate.id]?.mu ?? 0,
                    uncertainty: projections[candidate.id]?.sigma ?? 1.4,
                    novelty: 1 / Math.sqrt(familyCounts.get(niche) ?? 1),
                    niche,
                }
            }),
            ...accepted.map(({ proposal, childId }) => ({
                comboId: childId,
                tags: proposal.tags,
                score: proposal.preScore,
                uncertainty: proposal.uncertainty,
                novelty: proposal.novelty,
                niche: styleEvolutionNiche(proposal.tags),
            })),
        ],
        updatedAt: createdAt,
    }).filter(cell => cell.boardId === input.board.id)
    await input.repository.replaceEvolutionArchive(input.board.id, archive)

    let queuedRenderCount = 0
    const renderLimit = Math.max(0, Math.floor(input.autoRenderLimit ?? 2))
    if (input.board.autoEvolution && input.board.budgetId !== null && renderLimit > 0 && accepted.length > 0) {
        const ids = accepted.slice(0, renderLimit).map(item => item.childId)
        const queued = await (input.requestRenders ?? requestStyleLabPreviewRenders)(ids, {
            budgetId: input.board.budgetId,
            boardId: input.board.id,
            budgetLimit: input.autoBudgetLimit ?? 20,
            priority: -1,
        })
        queuedRenderCount = queued.jobs.length
    }
    return {
        childIds: accepted.map(item => item.childId),
        proposals,
        lineages,
        archive,
        queuedRenderCount,
    }
}
