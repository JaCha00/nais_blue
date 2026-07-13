import { AlertCircle, AlertTriangle, CircleDashed, LoaderCircle, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ReadonlyCompositionIssue, ReadonlyCompositionPlan } from './types'

export interface ResolvedPlanViewLabels {
    title: string
    loading: string
    empty: string
    positive: string
    negative: string
    promptParts: string
    characters: string
    params: string
    paramsWinner: string
    output: string
    warnings: string
    errors: string
    randomTrace: string
    provenance: string
    repair: string
}

const DEFAULT_LABELS: ResolvedPlanViewLabels = {
    title: 'Resolved plan',
    loading: 'Resolving plan…',
    empty: 'No resolved plan yet.',
    positive: 'Positive prompt',
    negative: 'Negative prompt',
    promptParts: 'Prompt slots',
    characters: 'Characters',
    params: 'Parameters',
    paramsWinner: 'Winning source',
    output: 'Output policy',
    warnings: 'Warnings',
    errors: 'Errors',
    randomTrace: 'Random trace',
    provenance: 'Provenance',
    repair: 'Repair',
}

export interface ResolvedPlanViewProps {
    plan?: ReadonlyCompositionPlan | null
    issues?: readonly ReadonlyCompositionIssue[]
    loading?: boolean
    error?: string | null
    title?: string
    labels?: Partial<ResolvedPlanViewLabels>
    className?: string
    onRepairIssue?: (issue: ReadonlyCompositionIssue) => void
}

function JsonValue({ value }: { value: unknown }) {
    let printable = ''
    try {
        printable = JSON.stringify(value, null, 2) ?? String(value)
    } catch {
        printable = String(value)
    }
    return <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5">{printable}</pre>
}

function PlanText({ children }: { children?: string }) {
    return <p className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{children || '—'}</p>
}

function PlanSection({ title, count, children, open = true }: {
    title: string
    count?: number
    children: ReactNode
    open?: boolean
}) {
    return (
        <details className="border-t border-border" open={open}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 break-words">{title}</span>
                {count !== undefined && <span className="shrink-0 font-mono text-xs text-muted-foreground">{count}</span>}
            </summary>
            <div className="min-w-0 px-3 pb-3">{children}</div>
        </details>
    )
}

/** Complete, non-mutating resolved-plan projection for desktop rails and sheets. */
export function ResolvedPlanView({
    plan,
    issues: suppliedIssues,
    loading = false,
    error,
    title,
    labels: labelsOverride,
    className,
    onRepairIssue,
}: ResolvedPlanViewProps) {
    const labels = { ...DEFAULT_LABELS, ...labelsOverride }
    const issues = suppliedIssues ?? plan?.issues ?? []
    const errors = issues.filter(issue => issue.severity === 'error')
    const warnings = issues.filter(issue => issue.severity === 'warning')

    return (
        <section
            className={cn('min-w-0 overflow-hidden rounded-panel border border-border bg-card', className)}
            aria-labelledby="composition-resolved-plan-title"
            data-testid="composition-resolved-plan"
        >
            <header className="flex min-h-11 min-w-0 items-center justify-between gap-2 border-b border-border px-3">
                <h2 id="composition-resolved-plan-title" className="min-w-0 truncate text-sm font-semibold" title={title ?? labels.title}>
                    {title ?? labels.title}
                </h2>
                {plan && <span className="shrink-0 break-all font-mono text-[11px] text-muted-foreground">r{plan.documentRevision}</span>}
            </header>

            {loading ? (
                <div className="flex min-h-44 items-center justify-center gap-2 p-4 text-sm text-muted-foreground" role="status">
                    <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    {labels.loading}
                </div>
            ) : error ? (
                <div className="flex min-h-44 items-start gap-2 border-l-2 border-l-destructive bg-destructive/10 p-4 text-sm" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                    <span className="min-w-0 whitespace-pre-wrap break-words">{error}</span>
                </div>
            ) : !plan ? (
                <div className="flex min-h-44 items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                    <CircleDashed className="h-4 w-4" aria-hidden="true" />
                    {labels.empty}
                </div>
            ) : (
                <div className="min-w-0">
                    {(errors.length > 0 || warnings.length > 0) && (
                        <section className="divide-y divide-border">
                            {errors.length > 0 && (
                                <IssueGroup
                                    title={labels.errors}
                                    issues={errors}
                                    tone="error"
                                    repairLabel={labels.repair}
                                    onRepairIssue={onRepairIssue}
                                />
                            )}
                            {warnings.length > 0 && (
                                <IssueGroup
                                    title={labels.warnings}
                                    issues={warnings}
                                    tone="warning"
                                    repairLabel={labels.repair}
                                    onRepairIssue={onRepairIssue}
                                />
                            )}
                        </section>
                    )}

                    <PlanSection title={labels.positive}>
                        <PlanText>{plan.positivePrompt}</PlanText>
                    </PlanSection>
                    <PlanSection title={labels.negative}>
                        <PlanText>{plan.negativePrompt}</PlanText>
                    </PlanSection>

                    <PlanSection title={labels.promptParts} count={Object.keys(plan.promptParts).length}>
                        <dl className="divide-y divide-border border-y border-border">
                            {Object.entries(plan.promptParts).map(([slot, value]) => (
                                <div key={slot} className="grid min-w-0 gap-1 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
                                    <dt className="break-all font-mono text-xs text-muted-foreground">{slot}</dt>
                                    <dd className="min-w-0"><PlanText>{typeof value === 'string' ? value : JSON.stringify(value)}</PlanText></dd>
                                </div>
                            ))}
                        </dl>
                    </PlanSection>

                    <PlanSection title={labels.characters} count={plan.characters.length} open={plan.characters.length > 0}>
                        {plan.characters.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
                            <div className="divide-y divide-border border-y border-border">
                                {plan.characters.map(character => (
                                    <article key={character.characterId} className="min-w-0 py-2">
                                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                                            <strong className="min-w-0 break-all font-mono text-xs">{character.characterId}</strong>
                                            <span className="font-mono text-[11px] text-muted-foreground">
                                                {character.position.mode === 'manual'
                                                    ? `${character.position.x}, ${character.position.y}`
                                                    : character.position.mode}
                                            </span>
                                        </div>
                                        <p className="mt-1 whitespace-pre-wrap break-words text-xs">+ {character.positive || '—'}</p>
                                        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">− {character.negative || '—'}</p>
                                    </article>
                                ))}
                            </div>
                        )}
                    </PlanSection>

                    <PlanSection title={labels.params}>
                        <JsonValue value={plan.params} />
                        {plan.provenanceDetails.params.length > 0 && (
                            <div className="mt-3 divide-y divide-border border-y border-border">
                                {plan.provenanceDetails.params.map(param => (
                                    <div key={param.field} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 py-2 text-xs">
                                        <span className="min-w-0 break-all font-mono">{param.field}</span>
                                        <span className="shrink-0 text-muted-foreground" aria-label={labels.paramsWinner}>← {param.winner.layer}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </PlanSection>

                    <PlanSection title={labels.output}>
                        <JsonValue value={plan.outputPolicy} />
                    </PlanSection>

                    <PlanSection title={labels.randomTrace} count={plan.randomTrace.length} open={false}>
                        {plan.randomTrace.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : (
                            <div className="divide-y divide-border border-y border-border">
                                {plan.randomTrace.map((trace, index) => (
                                    <div key={`${trace.ruleId}-${trace.drawIndex}-${index}`} className="min-w-0 py-2 font-mono text-xs">
                                        <div className="break-all">{trace.streamKey} · {trace.ruleId}</div>
                                        <div className="mt-1 break-all text-muted-foreground">#{trace.drawIndex} seed {trace.seed} → {String(trace.result)}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </PlanSection>

                    <PlanSection title={labels.provenance} open={false}>
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-xs">
                            <dt className="text-muted-foreground">prompt</dt><dd>{plan.provenanceDetails.prompts.length}</dd>
                            <dt className="text-muted-foreground">params</dt><dd>{plan.provenanceDetails.params.length}</dd>
                            <dt className="text-muted-foreground">character</dt><dd>{plan.provenanceDetails.characters.length}</dd>
                            <dt className="text-muted-foreground">output</dt><dd>{plan.provenanceDetails.outputPolicy.length}</dd>
                            <dt className="text-muted-foreground">random</dt><dd>{plan.provenanceDetails.randomSelections.length}</dd>
                            <dt className="text-muted-foreground">hash</dt><dd className="break-all">{plan.planHash.digest}</dd>
                        </dl>
                    </PlanSection>
                </div>
            )}
        </section>
    )
}

function IssueGroup({
    title,
    issues,
    tone,
    repairLabel,
    onRepairIssue,
}: {
    title: string
    issues: readonly ReadonlyCompositionIssue[]
    tone: 'warning' | 'error'
    repairLabel: string
    onRepairIssue?: (issue: ReadonlyCompositionIssue) => void
}) {
    const Icon = tone === 'error' ? AlertCircle : AlertTriangle
    return (
        <div className={cn('border-l-2 p-3', tone === 'error' ? 'border-l-destructive bg-destructive/10' : 'border-l-warning bg-warning/10')}>
            <h3 className={cn('flex items-center gap-2 text-sm font-semibold', tone === 'error' ? 'text-destructive' : 'text-warning')}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {title} ({issues.length})
            </h3>
            <ul className="mt-2 divide-y divide-border">
                {issues.map((issue, index) => (
                    <li key={`${issue.code}-${issue.fieldPath.join('.')}-${index}`} className="flex min-w-0 items-center gap-2 py-2">
                        <span className="min-w-0 flex-1">
                            <strong className="block break-all font-mono text-xs">{issue.code}</strong>
                            <span className="mt-1 block break-words text-xs text-muted-foreground">{issue.messageKey}</span>
                        </span>
                        {onRepairIssue && issue.actionId && (
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0"
                                aria-label={`${repairLabel} ${issue.code}`}
                                onClick={() => onRepairIssue(issue)}
                            >
                                <Wrench className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    )
}
