import {
    activeStylePreferenceEvents,
    type StylePreferenceEvent,
} from './preference-event'
import type { StyleEvaluationContext } from './evaluation-context'
import type { StyleMutationWeights } from './evolution/mutation'

export const STYLE_CONTEXTUAL_MODEL_VERSION = 'style-contextual-linear-v1' as const

export interface ContextualStyleCandidate {
    id: string
    tags: readonly { tag: string; kind?: string; weight?: number }[]
    generation: number
    lineage?: {
        operator?: string
        parentIds?: readonly string[]
    } | null
}

export interface ContextualFeatureInput {
    candidate: ContextualStyleCandidate
    boardId: string
    context?: StyleEvaluationContext | null
}

export interface ContextualPreferenceModelState {
    modelVersion: typeof STYLE_CONTEXTUAL_MODEL_VERSION
    boardId: string
    weights: Readonly<Record<string, number>>
    precision: Readonly<Record<string, number>>
    evidence: number
}

export interface ContextualPrediction {
    comboId: string
    mu: number
    sigma: number
    score: number
    topFeatures: string[]
}

function normalizedTag(tag: ContextualStyleCandidate['tags'][number]) {
    return {
        key: `${tag.kind ?? 'tag'}:${tag.tag.trim().toLowerCase()}`,
        weight: Number.isFinite(tag.weight) ? Math.min(2, Math.max(0.2, tag.weight as number)) : 1,
    }
}

function add(features: Record<string, number>, key: string, value: number): void {
    if (!key || !Number.isFinite(value) || value === 0) return
    features[key] = (features[key] ?? 0) + value
}

/**
 * Sparse features preserve tag presence, exact weight/order tendencies, pairs,
 * generation/lineage, and board/render context. Cross-features let one board learn
 * a direction without leaking it into another board's recommendations.
 */
export function extractContextualStyleFeatures(input: ContextualFeatureInput): Record<string, number> {
    const features: Record<string, number> = { bias: 1 }
    const tags = input.candidate.tags.map(normalizedTag).filter(tag => !tag.key.endsWith(':'))
    add(features, 'tag-count', Math.min(2, tags.length / 6))
    tags.forEach((tag, index) => {
        const order = tags.length <= 1 ? 1 : 1 - index / (tags.length - 1)
        add(features, `tag:${tag.key}`, 1)
        add(features, `weight:${tag.key}`, tag.weight)
        add(features, `order:${tag.key}`, order)
        add(features, `board:${input.boardId}|tag:${tag.key}`, 1)
    })
    for (let left = 0; left < tags.length; left += 1) {
        for (let right = left + 1; right < tags.length; right += 1) {
            const pair = [tags[left].key, tags[right].key].sort().join('+')
            add(features, `pair:${pair}`, 0.7)
            add(features, `board:${input.boardId}|pair:${pair}`, 0.7)
        }
    }
    add(features, 'generation', 0.1 + Math.min(1.9, Math.log2(1 + Math.max(0, input.candidate.generation)) / 3))
    if (input.candidate.lineage?.operator) add(features, `lineage:${input.candidate.lineage.operator}`, 1)
    if (input.candidate.lineage?.parentIds) {
        add(features, 'lineage:parent-count', Math.min(2, input.candidate.lineage.parentIds.length / 2))
    }
    if (input.context !== undefined && input.context !== null) {
        add(features, `context:model:${input.context.model}`, 0.6)
        add(features, `context:sampler:${input.context.sampler}`, 0.6)
        add(features, `context:prompt:${input.context.promptHash}`, 0.4)
        add(features, `context:plan:${input.context.planHash}`, 0.4)
    }
    return Object.fromEntries(Object.entries(features).sort(([left], [right]) => left.localeCompare(right)))
}

function eventLabel(event: StylePreferenceEvent): number | null {
    if (event.action === 'like') return 1
    if (event.action === 'collect') return 1.8
    if (event.action === 'apply') return 2.4
    if (event.action === 'hide') return -2
    if (event.action === 'pair-win') return 1.6
    if (event.action === 'pair-tie') return 0
    return null
}

function eventAppliesToBoard(event: StylePreferenceEvent, boardId: string): boolean {
    if (event.action === 'collect') return event.boardId === boardId
    if (event.action === 'apply' && event.boardId !== undefined) return event.boardId === boardId
    if ((event.action === 'pair-win' || event.action === 'pair-tie') && event.boardId !== undefined) {
        return event.boardId === boardId
    }
    return true
}

interface TrainingExample {
    features: Record<string, number>
    label: number
}

/** Deterministic online ridge updates are intentionally small-data friendly and replaceable. */
export function trainContextualPreferenceModel(input: {
    boardId: string
    candidates: readonly ContextualStyleCandidate[]
    events: readonly StylePreferenceEvent[]
    contexts?: readonly StyleEvaluationContext[]
}): ContextualPreferenceModelState {
    const candidates = new Map(input.candidates.map(candidate => [candidate.id, candidate]))
    const contexts = new Map((input.contexts ?? []).map(context => [context.id, context]))
    const examples: TrainingExample[] = []
    for (const event of activeStylePreferenceEvents(input.events)) {
        const label = eventLabel(event)
        const candidate = candidates.get(event.comboId)
        if (label === null || candidate === undefined || !eventAppliesToBoard(event, input.boardId)) continue
        const context = event.contextId === undefined ? null : contexts.get(event.contextId) ?? null
        examples.push({
            features: extractContextualStyleFeatures({ candidate, boardId: input.boardId, context }),
            label,
        })
        if ((event.action === 'pair-win' || event.action === 'pair-tie') && event.opponentId) {
            const opponent = candidates.get(event.opponentId)
            if (opponent !== undefined) examples.push({
                features: extractContextualStyleFeatures({ candidate: opponent, boardId: input.boardId, context }),
                label: event.action === 'pair-win' ? -label : 0,
            })
        }
    }

    const weights: Record<string, number> = {}
    const precision: Record<string, number> = {}
    for (let epoch = 0; epoch < 3; epoch += 1) {
        for (const example of examples) {
            const entries = Object.entries(example.features)
            const norm = Math.sqrt(entries.reduce((sum, [, value]) => sum + value * value, 0)) || 1
            const prediction = entries.reduce((sum, [key, value]) => sum + (weights[key] ?? 0) * value, 0)
            const error = Math.max(-3, Math.min(3, example.label - prediction))
            for (const [key, value] of entries) {
                const confidence = precision[key] ?? 0
                const rate = 0.22 / (norm * Math.sqrt(1 + confidence))
                weights[key] = (weights[key] ?? 0) * 0.999 + rate * error * value
                precision[key] = confidence + value * value * 0.35
            }
        }
    }
    return {
        modelVersion: STYLE_CONTEXTUAL_MODEL_VERSION,
        boardId: input.boardId,
        weights,
        precision,
        evidence: examples.length,
    }
}

export function predictContextualPreference(input: {
    state: ContextualPreferenceModelState
    candidate: ContextualStyleCandidate
    context?: StyleEvaluationContext | null
    exploration?: number
}): ContextualPrediction {
    const features = extractContextualStyleFeatures({
        candidate: input.candidate,
        boardId: input.state.boardId,
        context: input.context,
    })
    const contributions = Object.entries(features).map(([key, value]) => ({
        key,
        value: (input.state.weights[key] ?? 0) * value,
    }))
    const mu = Math.max(-5, Math.min(5, contributions.reduce((sum, item) => sum + item.value, 0)))
    const totalMagnitude = Object.values(features).reduce((sum, value) => sum + value * value, 0) || 1
    const variance = Object.entries(features).reduce((sum, [key, value]) => (
        sum + value * value / (1 + (input.state.precision[key] ?? 0))
    ), 0) / totalMagnitude
    const sigma = Math.max(0.2, Math.min(2, Math.sqrt(variance) * 1.6))
    return {
        comboId: input.candidate.id,
        mu,
        sigma,
        score: mu + sigma * Math.max(0, Math.min(1, input.exploration ?? 0.35)),
        topFeatures: contributions
            .filter(item => item.key !== 'bias')
            .sort((left, right) => Math.abs(right.value) - Math.abs(left.value) || left.key.localeCompare(right.key))
            .slice(0, 3)
            .map(item => item.key),
    }
}

export function rankContextualStyleCandidates(input: {
    state: ContextualPreferenceModelState
    candidates: readonly ContextualStyleCandidate[]
    context?: StyleEvaluationContext | null
    exploration?: number
}): ContextualPrediction[] {
    return input.candidates
        .map(candidate => predictContextualPreference({
            state: input.state,
            candidate,
            context: input.context,
            exploration: input.exploration,
        }))
        .sort((left, right) => right.score - left.score || left.comboId.localeCompare(right.comboId))
}

/** Positive learned feature families bias future mutation operators, with bounded defaults. */
export function adaptiveMutationWeights(
    state: ContextualPreferenceModelState,
): Required<StyleMutationWeights> {
    const signal = (prefix: string): number => Object.entries(state.weights)
        .filter(([key, value]) => key.includes(prefix) && value > 0)
        .reduce((sum, [, value]) => sum + value, 0)
    const tag = Math.min(3, signal('tag:'))
    const weight = Math.min(3, signal('weight:'))
    const order = Math.min(3, signal('order:'))
    const pair = Math.min(3, signal('pair:'))
    return {
        'tag-add': 1 + tag * 0.35,
        'tag-delete': 0.75 + Math.max(0, 1 - tag * 0.1),
        'tag-replace': 1 + tag * 0.2,
        'weight-jitter': 1 + weight * 0.4,
        'weight-mix': 1 + weight * 0.25,
        'order-swap': 0.8 + order * 0.35,
        'order-move': 0.8 + order * 0.35,
        'parent-splice': 1 + pair * 0.45,
    }
}
