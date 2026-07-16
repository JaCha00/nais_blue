import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useGenerationStore } from '@/stores/generation-store'
import type {
    CompositionEngineIssue,
    CompositionEnginePlan,
    DeepReadonly,
    ResolvedPromptParts,
} from '@/domain/composition'
import { ValidationBadge } from './ValidationBadge'
import { PromptLengthAssessment } from '@/components/guidance/PromptLengthAssessment'

const PROMPT_SLOTS: ReadonlyArray<{
    key: keyof Pick<ResolvedPromptParts, 'base' | 'inpainting' | 'additional' | 'workflow' | 'detail' | 'negative'>
    label: string
}> = [
    { key: 'base', label: 'base' },
    { key: 'inpainting', label: 'inpainting' },
    { key: 'additional', label: 'additional' },
    { key: 'workflow', label: 'workflow' },
    { key: 'detail', label: 'detail' },
    { key: 'negative', label: 'negative' },
]

function printableJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2) ?? String(value)
    } catch {
        return String(value)
    }
}

function IssueList({
    title,
    issues,
    tone,
}: {
    title: string
    issues: readonly DeepReadonly<CompositionEngineIssue>[]
    tone: 'warning' | 'error'
}) {
    const { t } = useTranslation()
    if (issues.length === 0) return null

    return (
        <section className="border-t border-border pt-3">
            <h4 className={cn(
                'text-xs font-semibold',
                tone === 'error' ? 'text-destructive' : 'text-warning',
            )}>
                {title} ({issues.length})
            </h4>
            <ul className="mt-2 space-y-2">
                {issues.map((issue, index) => (
                    <li
                        key={`${issue.code}-${issue.fieldPath.join('.')}-${index}`}
                        className={cn(
                            'border-l-2 pl-2 text-xs',
                            tone === 'error' ? 'border-destructive' : 'border-warning',
                        )}
                    >
                        <div className="font-mono font-semibold">{issue.code}</div>
                        <div className="mt-1 break-words text-foreground">
                            {t(issue.messageKey, { defaultValue: issue.code })}
                        </div>
                        {issue.fieldPath.length > 0 && (
                            <div className="mt-1 break-all font-mono text-muted-foreground">
                                {issue.fieldPath.join('.')}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    )
}

function PromptBlock({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-t border-border pt-3">
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                {value || '—'}
            </pre>
        </div>
    )
}

function ResolvedPlanDetails({ plan }: { plan: DeepReadonly<CompositionEnginePlan> }) {
    const { t } = useTranslation()
    const provenance = plan.provenanceDetails

    return (
        <div className="space-y-3">
            <PromptBlock label={t('composition.plan.finalPositive', 'Final positive')} value={plan.positivePrompt} />
            <PromptBlock label={t('composition.plan.finalNegative', 'Final negative')} value={plan.negativePrompt} />

            <PromptLengthAssessment plan={plan} />

            <section className="border-t border-border pt-3">
                <h4 className="text-xs font-semibold">{t('composition.plan.promptParts', 'Prompt parts')}</h4>
                <dl className="mt-2 space-y-2">
                    {PROMPT_SLOTS.map(slot => (
                        <div key={slot.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-xs">
                            <dt className="font-mono text-muted-foreground">{slot.label}</dt>
                            <dd className="min-w-0 whitespace-pre-wrap break-words font-mono">
                                {plan.promptParts[slot.key] || '—'}
                            </dd>
                        </div>
                    ))}
                </dl>
            </section>

            <section className="border-t border-border pt-3">
                <h4 className="text-xs font-semibold">
                    {t('composition.plan.characters', 'Characters')} ({plan.characters.length})
                </h4>
                {plan.characters.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">—</p>
                ) : (
                    <div className="mt-2 divide-y divide-border">
                        {plan.characters.map(character => (
                            <div key={character.characterId} className="py-2 first:pt-0 last:pb-0">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="break-all font-mono text-xs font-semibold">{character.characterId}</span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {character.position.mode === 'manual'
                                            ? `manual (${character.position.x}, ${character.position.y})`
                                            : 'ai-choice'}
                                    </span>
                                </div>
                                <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">+ {character.positive || '—'}</div>
                                <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-destructive">− {character.negative || '—'}</div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className="border-t border-border pt-3">
                <h4 className="text-xs font-semibold">{t('composition.plan.params', 'Final params')}</h4>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                    {printableJson(plan.params)}
                </pre>
            </section>

            <section className="border-t border-border pt-3">
                <h4 className="text-xs font-semibold">{t('composition.plan.outputPolicy', 'Output policy')}</h4>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                    {printableJson(plan.outputPolicy)}
                </pre>
            </section>

            <section className="border-t border-border pt-3">
                <h4 className="text-xs font-semibold">{t('composition.plan.hash', 'Plan hash')}</h4>
                <div className="mt-2 break-all font-mono text-xs">{plan.planHash.digest}</div>
                <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {plan.planHash.version} · {plan.planHash.algorithm}
                </div>
            </section>

            <section className="border-t border-border pt-3">
                <h4 className="text-xs font-semibold">{t('composition.plan.provenance', 'Provenance summary')}</h4>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                    <span>prompt: {provenance.prompts.length}</span>
                    <span>params: {provenance.params.length}</span>
                    <span>character: {provenance.characters.length}</span>
                    <span>output: {provenance.outputPolicy.length}</span>
                    <span>random: {provenance.randomSelections.length}</span>
                </div>
                {provenance.params.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                        {provenance.params.map(entry => (
                            <li key={entry.field} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                <span className="min-w-0 truncate font-mono">{entry.field}</span>
                                <span className="font-mono text-muted-foreground">← {entry.winner.layer}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    )
}

export function ResolvedPlanPanel() {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const compositionMode = useGenerationStore(state => state.compositionMode)
    const warnings = useGenerationStore(state => state.compositionWarnings)
    const errors = useGenerationStore(state => state.compositionErrors)
    const plan = useGenerationStore(state => state.lastResolvedPlan)
    const shadowDiff = useGenerationStore(state => state.compositionShadowDiff)

    useEffect(() => {
        if (errors.length > 0) setOpen(true)
    }, [errors.length])

    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            className="flex-none rounded-control border border-border bg-muted/20"
            data-testid="main-resolved-plan"
        >
            <div className="flex min-w-0 items-center gap-2 pr-3">
                <CollapsibleTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        className="h-11 min-w-0 flex-1 justify-between rounded-control px-3"
                    >
                        <span className="truncate text-xs font-medium">{t('composition.plan.title', 'Resolved plan')}</span>
                        {open
                            ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    </Button>
                </CollapsibleTrigger>
                <ValidationBadge
                    mode={compositionMode}
                    warnings={warnings}
                    errors={errors}
                    hasPlan={plan !== null}
                    className="shrink-0"
                />
            </div>
            <CollapsibleContent>
                <div className="space-y-3 border-t border-border p-3">
                    <IssueList
                        title={t('composition.validation.errorsTitle', 'Errors')}
                        issues={errors}
                        tone="error"
                    />
                    <IssueList
                        title={t('composition.validation.warningsTitle', 'Warnings')}
                        issues={warnings}
                        tone="warning"
                    />

                    {shadowDiff !== null && shadowDiff !== undefined && (
                        <section className="border-t border-border pt-3">
                            <h4 className="text-xs font-semibold">{t('composition.plan.shadowDiff', 'Shadow diff')}</h4>
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">
                                {printableJson(shadowDiff)}
                            </pre>
                        </section>
                    )}

                    {plan ? (
                        <ResolvedPlanDetails plan={plan} />
                    ) : errors.length === 0
                        && warnings.length === 0
                        && (shadowDiff === null || shadowDiff === undefined) ? (
                        <p className="text-xs text-muted-foreground">
                            {t('composition.plan.empty', 'No resolved plan yet.')}
                        </p>
                    ) : null}
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}
