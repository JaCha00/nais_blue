import type {
    PreferenceCandidatePrior,
    PreferenceProjection,
    StyleEvaluationContext,
    StyleLabArenaLeague,
} from '@/domain/style-lab'
import type { AnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import {
    recordArenaSkip,
    recordArenaTie,
    recordArenaWin,
    type RecordArenaPreferenceResult,
} from './record-preference'
import { suggestArenaPair, type SuggestArenaPairInput } from './suggest-arena-pair'
import type { StyleLabRepository } from './style-lab-repository'

export interface GuidedStylePreviewRequestResult {
    readonly rejected: readonly {
        readonly comboId: string
        readonly reason: string
    }[]
}

export type GuidedStylePreviewRequest = (
    combinationIds: readonly string[],
    options: {
        readonly evaluationContext: StyleEvaluationContext
        readonly costConsent: AnlasCostConsentSnapshot
    },
) => Promise<GuidedStylePreviewRequestResult>

export interface StartGuidedStyleComparisonInput {
    readonly candidates: SuggestArenaPairInput['candidates']
    readonly league: StyleLabArenaLeague
    readonly context: StyleEvaluationContext
    readonly randomSeed: number
    readonly repository: StyleLabRepository
    readonly requestPreviews: GuidedStylePreviewRequest
    readonly costConsent: AnlasCostConsentSnapshot
}

export interface GuidedStyleComparisonStartResult {
    readonly pair: [string, string]
    readonly context: StyleEvaluationContext
    readonly projections: readonly PreferenceProjection[]
    readonly rejectedPreviewIds: readonly string[]
}

/**
 * Opens one durable fair exposure and queues both previews under the exact same
 * immutable evaluation context. React surfaces only project the returned facts.
 */
export async function startGuidedStyleComparison(
    input: StartGuidedStyleComparisonInput,
): Promise<GuidedStyleComparisonStartResult | null> {
    const exposure = await suggestArenaPair({
        candidates: input.candidates,
        league: input.league,
        context: input.context,
        randomSeed: input.randomSeed,
        repository: input.repository,
    })
    if (exposure === null) return null

    const preview = await input.requestPreviews(exposure.pair, {
        evaluationContext: exposure.context,
        costConsent: input.costConsent,
    })
    return {
        pair: exposure.pair,
        context: exposure.context,
        projections: exposure.projections,
        rejectedPreviewIds: preview.rejected.map(item => item.comboId),
    }
}

export type GuidedStyleDecision =
    | { readonly kind: 'win'; readonly winnerId: string; readonly loserId: string }
    | { readonly kind: 'tie'; readonly leftId: string; readonly rightId: string }
    | { readonly kind: 'skip'; readonly leftId: string; readonly rightId: string }

export interface RecordGuidedStyleDecisionInput {
    readonly candidates: readonly PreferenceCandidatePrior[]
    readonly context: StyleEvaluationContext
    readonly repository: StyleLabRepository
    readonly decision: GuidedStyleDecision
}

/** Repository-first preference recording shared by Guided and full Style Lab. */
export function recordGuidedStyleDecision(
    input: RecordGuidedStyleDecisionInput,
): Promise<RecordArenaPreferenceResult> {
    const common = {
        candidates: input.candidates,
        context: input.context,
        repository: input.repository,
    }
    if (input.decision.kind === 'win') {
        return recordArenaWin({
            ...common,
            winnerId: input.decision.winnerId,
            loserId: input.decision.loserId,
        })
    }
    if (input.decision.kind === 'tie') {
        return recordArenaTie({
            ...common,
            leftId: input.decision.leftId,
            rightId: input.decision.rightId,
        })
    }
    return recordArenaSkip({
        ...common,
        leftId: input.decision.leftId,
        rightId: input.decision.rightId,
    })
}
