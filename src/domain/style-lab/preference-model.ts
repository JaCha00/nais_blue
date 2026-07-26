import {
    activeStylePreferenceEvents,
    type StylePreferenceEvent,
} from './preference-event'

export const STYLE_PREFERENCE_MODEL_VERSION = 'gaussian-preference-v1' as const
export const DEFAULT_PREFERENCE_MU = 0
export const DEFAULT_PREFERENCE_SIGMA = 1.4
export const MIN_PREFERENCE_SIGMA = 0.25
export const MAX_PREFERENCE_SIGMA = 2

const MIN_PREFERENCE_MU = -5
const MAX_PREFERENCE_MU = 5
const PERFORMANCE_NOISE_VARIANCE = 1

export interface PreferenceCandidatePrior {
    id: string
    /** `legacyElo` wins when migration has already renamed the old field. */
    legacyElo?: number
    elo?: number
    legacyBattles?: number
    battles?: number
    legacyFavorite?: boolean
    favorite?: boolean
}

export interface PreferenceProjection {
    modelVersion: typeof STYLE_PREFERENCE_MODEL_VERSION
    comboId: string
    mu: number
    sigma: number
    evidence: number
    views: number
    lastShownAt: number | null
    updatedAt: number
}

export interface PreferenceModelState {
    modelVersion: typeof STYLE_PREFERENCE_MODEL_VERSION
    projections: Readonly<Record<string, PreferenceProjection>>
}

export interface RankedPreferenceCandidate extends PreferenceProjection {
    score: number
}

export interface PreferenceModel {
    replay(
        candidates: readonly PreferenceCandidatePrior[],
        events: readonly StylePreferenceEvent[],
    ): PreferenceModelState
    applyEvent(state: PreferenceModelState, event: StylePreferenceEvent): PreferenceModelState
    rank(state: PreferenceModelState): RankedPreferenceCandidate[]
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value))
}

function finiteOr(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) ? value : fallback
}

/**
 * Migration supplies legacy Elo/battle/favorite fields; this weak prior links the
 * old UI projection to the new model without inventing historical preference events.
 * Low battle counts deliberately retain high uncertainty for rapid correction.
 */
export function createPreferencePrior(candidate: PreferenceCandidatePrior): PreferenceProjection {
    const legacyElo = finiteOr(candidate.legacyElo, finiteOr(candidate.elo, 1200))
    const battles = clamp(Math.floor(finiteOr(candidate.legacyBattles, finiteOr(candidate.battles, 0))), 0, 1000)
    const eloOffset = clamp((legacyElo - 1200) / 400, -2, 2) * 0.2
    const favoriteOffset = (candidate.legacyFavorite ?? candidate.favorite) ? 0.08 : 0
    const sigma = clamp(
        DEFAULT_PREFERENCE_SIGMA / Math.sqrt(1 + Math.min(battles, 20) * 0.06),
        0.7,
        DEFAULT_PREFERENCE_SIGMA,
    )
    return {
        modelVersion: STYLE_PREFERENCE_MODEL_VERSION,
        comboId: candidate.id,
        mu: eloOffset + favoriteOffset,
        sigma,
        evidence: 0,
        views: 0,
        lastShownAt: null,
        updatedAt: 0,
    }
}

function neutralProjection(comboId: string): PreferenceProjection {
    return createPreferencePrior({ id: comboId })
}

function logistic(value: number): number {
    if (value >= 0) {
        const inverse = Math.exp(-value)
        return 1 / (1 + inverse)
    }
    const exponential = Math.exp(value)
    return exponential / (1 + exponential)
}

function updateSigma(
    sigma: number,
    varianceShare: number,
    information: number,
): number {
    const retainedVariance = clamp(1 - 0.8 * varianceShare * information, 0.5, 1)
    return clamp(sigma * Math.sqrt(retainedVariance), MIN_PREFERENCE_SIGMA, MAX_PREFERENCE_SIGMA)
}

function applyPairOutcome(
    left: PreferenceProjection,
    right: PreferenceProjection,
    outcome: 0.5 | 1,
    timestamp: number,
): [PreferenceProjection, PreferenceProjection] {
    const leftVariance = left.sigma ** 2
    const rightVariance = right.sigma ** 2
    const totalVariance = leftVariance + rightVariance + PERFORMANCE_NOISE_VARIANCE
    const scale = Math.sqrt(totalVariance)
    const expectedLeft = logistic((left.mu - right.mu) / scale)
    const residual = outcome - expectedLeft
    const leftGain = 0.9 * leftVariance / totalVariance
    const rightGain = 0.9 * rightVariance / totalVariance
    const information = Math.max(0.1, 4 * expectedLeft * (1 - expectedLeft))
    const evidence = outcome === 0.5 ? 0.75 : 1

    return [
        {
            ...left,
            mu: clamp(left.mu + leftGain * residual, MIN_PREFERENCE_MU, MAX_PREFERENCE_MU),
            sigma: updateSigma(left.sigma, leftVariance / totalVariance, information),
            evidence: left.evidence + evidence,
            updatedAt: Math.max(left.updatedAt, timestamp),
        },
        {
            ...right,
            mu: clamp(right.mu - rightGain * residual, MIN_PREFERENCE_MU, MAX_PREFERENCE_MU),
            sigma: updateSigma(right.sigma, rightVariance / totalVariance, information),
            evidence: right.evidence + evidence,
            updatedAt: Math.max(right.updatedAt, timestamp),
        },
    ]
}

const UNARY_EVIDENCE: Readonly<Record<'like' | 'collect' | 'apply' | 'hide', {
    direction: -1 | 1
    strength: number
    evidence: number
}>> = {
    like: { direction: 1, strength: 0.12, evidence: 0.35 },
    collect: { direction: 1, strength: 0.24, evidence: 0.75 },
    apply: { direction: 1, strength: 0.34, evidence: 1 },
    hide: { direction: -1, strength: 0.34, evidence: 1 },
}

function applyUnaryOutcome(
    projection: PreferenceProjection,
    action: keyof typeof UNARY_EVIDENCE,
    timestamp: number,
): PreferenceProjection {
    const signal = UNARY_EVIDENCE[action]
    return {
        ...projection,
        mu: clamp(
            projection.mu + signal.direction * signal.strength * projection.sigma,
            MIN_PREFERENCE_MU,
            MAX_PREFERENCE_MU,
        ),
        sigma: clamp(projection.sigma * 0.985, MIN_PREFERENCE_SIGMA, MAX_PREFERENCE_SIGMA),
        evidence: projection.evidence + signal.evidence,
        updatedAt: Math.max(projection.updatedAt, timestamp),
    }
}

/**
 * Pure event application updates only affected projections. `undo` is intentionally
 * handled by full replay because an append-only compensating event must remove the
 * superseded event's downstream effect rather than approximate an inverse update.
 */
export function applyPreferenceEvent(
    state: PreferenceModelState,
    event: StylePreferenceEvent,
): PreferenceModelState {
    if (event.action === 'undo') return state
    const projections = { ...state.projections }
    const primary = projections[event.comboId] ?? neutralProjection(event.comboId)

    if (event.action === 'impression') {
        projections[event.comboId] = {
            ...primary,
            views: primary.views + 1,
            lastShownAt: Math.max(primary.lastShownAt ?? 0, event.createdAt),
            updatedAt: Math.max(primary.updatedAt, event.createdAt),
        }
    } else if (event.action === 'pair-win' || event.action === 'pair-tie') {
        if (!event.opponentId) return state
        const opponent = projections[event.opponentId] ?? neutralProjection(event.opponentId)
        const [updatedPrimary, updatedOpponent] = applyPairOutcome(
            primary,
            opponent,
            event.action === 'pair-tie' ? 0.5 : 1,
            event.createdAt,
        )
        projections[event.comboId] = updatedPrimary
        projections[event.opponentId] = updatedOpponent
    } else if (event.action === 'like'
        || event.action === 'collect'
        || event.action === 'apply'
        || event.action === 'hide') {
        projections[event.comboId] = applyUnaryOutcome(primary, event.action, event.createdAt)
    } else {
        // `skip` records an explicit no-judgement action. Its preceding impressions
        // already account for exposure, so it must not alter preference evidence.
        return state
    }

    return { modelVersion: STYLE_PREFERENCE_MODEL_VERSION, projections }
}

/** Rebuilds the deterministic projection from candidate priors and active events. */
export function replayPreferenceEvents(
    candidates: readonly PreferenceCandidatePrior[],
    events: readonly StylePreferenceEvent[],
): PreferenceModelState {
    const projections: Record<string, PreferenceProjection> = {}
    for (const candidate of candidates) projections[candidate.id] = createPreferencePrior(candidate)

    let state: PreferenceModelState = {
        modelVersion: STYLE_PREFERENCE_MODEL_VERSION,
        projections,
    }
    for (const event of activeStylePreferenceEvents(events)) {
        state = applyPreferenceEvent(state, event)
    }
    return state
}

export function rankPreferenceState(state: PreferenceModelState): RankedPreferenceCandidate[] {
    return Object.values(state.projections)
        .map(projection => ({ ...projection, score: projection.mu }))
        .sort((left, right) => (
            right.score - left.score
            || left.sigma - right.sigma
            || left.comboId.localeCompare(right.comboId)
        ))
}

export const gaussianPreferenceModel: PreferenceModel = Object.freeze({
    replay: replayPreferenceEvents,
    applyEvent: applyPreferenceEvent,
    rank: rankPreferenceState,
})

/** Repository hydration discards malformed derived state and rebuilds it from events. */
export function isPreferenceProjection(value: unknown): value is PreferenceProjection {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const candidate = value as Partial<PreferenceProjection>
    return candidate.modelVersion === STYLE_PREFERENCE_MODEL_VERSION
        && typeof candidate.comboId === 'string'
        && candidate.comboId.length > 0
        && typeof candidate.mu === 'number'
        && Number.isFinite(candidate.mu)
        && typeof candidate.sigma === 'number'
        && Number.isFinite(candidate.sigma)
        && candidate.sigma >= MIN_PREFERENCE_SIGMA
        && candidate.sigma <= MAX_PREFERENCE_SIGMA
        && typeof candidate.evidence === 'number'
        && Number.isFinite(candidate.evidence)
        && candidate.evidence >= 0
        && Number.isSafeInteger(candidate.views)
        && (candidate.views as number) >= 0
        && (candidate.lastShownAt === null
            || (Number.isSafeInteger(candidate.lastShownAt) && (candidate.lastShownAt as number) >= 0))
        && Number.isSafeInteger(candidate.updatedAt)
        && (candidate.updatedAt as number) >= 0
}
