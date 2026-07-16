import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReadonlyCompositionPlan } from '@/components/composition-workspace/types'
import { assessPromptLengths } from '@/services/guidance/prompt-length-assessment'
import type { UcPresetIndex } from '@/services/nai/presets'

function normalizeUcPreset(value: number): UcPresetIndex {
    return value >= 0 && value <= 4 ? value as UcPresetIndex : 0
}

/** Accessible, fail-closed prompt sizing for the exact plan sent to payload expansion. */
export function PromptLengthAssessment({ plan }: { plan: ReadonlyCompositionPlan }) {
    const { t } = useTranslation()
    const descriptionId = useId()
    const assessment = assessPromptLengths({
        model: plan.params.model,
        positivePrompt: plan.positivePrompt,
        negativePrompt: plan.negativePrompt,
        characters: plan.characters,
        qualityToggle: plan.params.qualityToggle,
        ucPreset: normalizeUcPreset(plan.params.ucPreset),
    })

    return (
        <section className="border-t border-border px-3 py-3" aria-labelledby={`${descriptionId}-title`}>
            <h3 id={`${descriptionId}-title`} className="text-sm font-semibold">
                {t('tokenAssessment.title')}
            </h3>
            <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
                {t('tokenAssessment.unavailable')}
            </p>
            <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-xs">
                <dt>{t('tokenAssessment.classification')}</dt>
                <dd className="font-medium">{t(`tokenAssessment.classifications.${assessment.classification}`)}</dd>
                <dt>{t('tokenAssessment.model')}</dt>
                <dd className="break-all font-mono text-right">{assessment.model}</dd>
                <dt>{t('tokenAssessment.contextLimit')}</dt>
                <dd className="font-medium">
                    {assessment.contextLimitTokens === null
                        ? t('tokenAssessment.limitUnavailable')
                        : t('tokenAssessment.tokens', { count: assessment.contextLimitTokens })}
                </dd>
                <dt>{t('tokenAssessment.positiveCombined')}</dt>
                <dd>{t('tokenAssessment.characters', { count: assessment.positive.combinedCharacters })}</dd>
                <dt>{t('tokenAssessment.negativeCombined')}</dt>
                <dd>{t('tokenAssessment.characters', { count: assessment.negative.combinedCharacters })}</dd>
            </dl>
            <details className="mt-3 rounded-control border border-border motion-reduce:transition-none">
                <summary
                    className="flex min-h-11 cursor-pointer list-none items-center px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                    aria-describedby={descriptionId}
                >
                    {t('tokenAssessment.breakdown')}
                </summary>
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-t border-border p-3 text-xs">
                    <dt>{t('tokenAssessment.expandedBase')}</dt>
                    <dd>{assessment.positive.expandedBaseCharacters}</dd>
                    <dt>{t('tokenAssessment.characterPositive')}</dt>
                    <dd>{assessment.positive.enabledCharacterCharacters}</dd>
                    <dt>{t('tokenAssessment.expandedNegative')}</dt>
                    <dd>{assessment.negative.expandedBaseCharacters}</dd>
                    <dt>{t('tokenAssessment.characterNegative')}</dt>
                    <dd>{assessment.negative.enabledCharacterCharacters}</dd>
                    <dt>{t('tokenAssessment.safetyMargin')}</dt>
                    <dd>{t('tokenAssessment.notCalculated')}</dd>
                </dl>
            </details>
        </section>
    )
}
