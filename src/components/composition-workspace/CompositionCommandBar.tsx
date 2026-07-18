import {
    Eye,
    Layers3,
    Lock,
    PanelRight,
    Play,
    RefreshCw,
    Square,
    Unlock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ValidationState } from './ValidationState'
import type {
    CompositionGenerationControl,
    CompositionSeedControl,
    CompositionSelectControl,
    CompositionValidationSummary,
} from './types'

export interface CompositionCostSummary {
    value: string
    label?: string
    severity?: 'normal' | 'warning' | 'error'
}

export interface CompositionResolvedControl {
    available: boolean
    label?: string
    open?: boolean
    onOpen: () => void
}

export interface CompositionCommandBarLabels {
    commands: string
    mode: string
    recipe: string
    cost: string
    seed: string
    modules: string
    inspector: string
    resolved: string
    generate: string
    cancel: string
    lockSeed: string
    unlockSeed: string
}

const DEFAULT_LABELS: CompositionCommandBarLabels = {
    commands: 'Composition commands',
    mode: 'Mode',
    recipe: 'Recipe',
    cost: 'Cost',
    seed: 'Seed',
    modules: 'Modules',
    inspector: 'Inspector',
    resolved: 'Resolved',
    generate: 'Generate',
    cancel: 'Cancel',
    lockSeed: 'Lock seed',
    unlockSeed: 'Unlock seed',
}

export interface CompositionCommandBarProps {
    mode: CompositionSelectControl
    recipe: CompositionSelectControl
    validation: CompositionValidationSummary
    cost?: CompositionCostSummary
    seed?: CompositionSeedControl
    resolved: CompositionResolvedControl
    generation: CompositionGenerationControl
    labels?: Partial<CompositionCommandBarLabels>
    disabled?: boolean
    className?: string
    onOpenModules?: () => void
    onOpenInspector?: () => void
    /** Scene UX: keep internal composition authority out of the user-facing command strip. */
    simplified?: boolean
}

function CommandSelect({
    control,
    label,
    className,
}: {
    control: CompositionSelectControl
    label: string
    className?: string
}) {
    return (
        <label className={cn('grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2', className)}>
            <span className="text-xs font-medium text-muted-foreground">{control.label ?? label}</span>
            <Select
                value={control.value}
                onValueChange={control.onChange}
                disabled={control.disabled}
            >
                <SelectTrigger className="h-11 min-w-0 max-w-full rounded-control" aria-label={control.label ?? label}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
                    {control.options.map(option => (
                        <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                            <span className="block max-w-[min(28rem,calc(100vw-5rem))] truncate" title={option.label}>{option.label}</span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </label>
    )
}

/** Controlled workspace command strip; generation behavior stays in the owning page/store. */
export function CompositionCommandBar({
    mode,
    recipe,
    validation,
    cost,
    seed,
    resolved,
    generation,
    labels: labelsOverride,
    disabled = false,
    className,
    onOpenModules,
    onOpenInspector,
    simplified = false,
}: CompositionCommandBarProps) {
    const labels = { ...DEFAULT_LABELS, ...labelsOverride }
    const actionDisabled = disabled || generation.disabled

    if (simplified) {
        return (
            <header
                className={cn('flex min-w-0 flex-wrap items-center justify-end gap-2 rounded-panel bg-card p-2', className)}
                aria-label={labels.commands}
                data-testid="composition-command-bar"
            >
                {cost && (
                    <span className="mr-auto font-mono text-xs text-muted-foreground" aria-label={`${cost.label ?? labels.cost}: ${cost.value}`}>
                        {cost.label ? `${cost.label} ` : ''}{cost.value}
                    </span>
                )}
                {seed && (
                    <label className="flex min-w-48 flex-1 items-center gap-2 sm:max-w-72">
                        <span className="text-xs font-medium text-muted-foreground">{seed.label ?? labels.seed}</span>
                        <Input value={seed.value} onChange={event => seed.onChange?.(event.currentTarget.value)} readOnly={!seed.onChange} disabled={disabled || seed.disabled} inputMode="numeric" className="h-10 min-w-0 font-mono" />
                        {seed.onToggleLock && (
                            <Button type="button" variant="ghost" size="icon" disabled={disabled || seed.disabled} aria-label={seed.locked ? labels.unlockSeed : labels.lockSeed} onClick={seed.onToggleLock}>
                                {seed.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                            </Button>
                        )}
                    </label>
                )}
                <Button
                    type="button"
                    variant={generation.generating ? 'destructive' : 'generate'}
                    className="min-w-40"
                    disabled={actionDisabled}
                    onClick={generation.generating ? generation.onCancel : generation.onGenerate}
                    data-testid={generation.generating ? generation.cancelTestId ?? generation.actionTestId : generation.actionTestId}
                >
                    {generation.generating ? <Square className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                    <span className="truncate">{generation.progressLabel ?? (generation.generating ? generation.cancelLabel ?? labels.cancel : generation.generateLabel ?? labels.generate)}</span>
                </Button>
            </header>
        )
    }

    return (
        <header
            className={cn(
                'grid min-w-0 gap-2 rounded-panel bg-card p-2',
                'md:grid-cols-2 xl:grid-cols-[minmax(10rem,0.7fr)_minmax(14rem,1.25fr)_auto_auto_minmax(9rem,0.6fr)_auto] xl:items-center',
                className,
            )}
            aria-label={labels.commands}
            data-testid="composition-command-bar"
        >
            <CommandSelect control={{ ...mode, disabled: disabled || mode.disabled }} label={labels.mode} />
            <CommandSelect control={{ ...recipe, disabled: disabled || recipe.disabled }} label={labels.recipe} />

            <div className="flex min-h-11 min-w-0 items-center justify-between gap-2 px-2">
                <ValidationState validation={validation} />
                {cost && (
                    <span
                        className={cn(
                            'shrink-0 font-mono text-xs',
                            cost.severity === 'warning' && 'text-warning',
                            cost.severity === 'error' && 'text-destructive',
                            (!cost.severity || cost.severity === 'normal') && 'text-muted-foreground',
                        )}
                        aria-label={`${cost.label ?? labels.cost}: ${cost.value}`}
                    >
                        {cost.value}
                    </span>
                )}
            </div>

            <div className="flex min-h-11 min-w-0 items-center gap-1">
                {/* Main and Scene intentionally omit persistent desktop rails to protect canvas width.
                    Keep these controlled-sheet triggers available at every breakpoint so both panels remain reachable. */}
                {onOpenModules && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        disabled={disabled}
                        aria-label={labels.modules}
                        data-testid="composition-open-modules"
                        onClick={onOpenModules}
                    >
                        <Layers3 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                )}
                {onOpenInspector && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        disabled={disabled}
                        aria-label={labels.inspector}
                        data-testid="composition-open-inspector"
                        onClick={onOpenInspector}
                    >
                        <PanelRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                )}
                <Button
                    type="button"
                    variant={resolved.open ? 'secondary' : 'outline'}
                    className="min-w-0 flex-1 px-3"
                    aria-pressed={resolved.open}
                    disabled={disabled || !resolved.available}
                    onClick={resolved.onOpen}
                >
                    <Eye className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{resolved.label ?? labels.resolved}</span>
                </Button>
            </div>

            {seed ? (
                <div className="flex min-h-11 min-w-0 items-center gap-1">
                    <label className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">{seed.label ?? labels.seed}</span>
                        <Input
                            value={seed.value}
                            onChange={event => seed.onChange?.(event.currentTarget.value)}
                            readOnly={!seed.onChange}
                            disabled={disabled || seed.disabled}
                            inputMode="numeric"
                            className="h-11 min-w-0 font-mono"
                        />
                    </label>
                    {seed.onToggleLock && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            disabled={disabled || seed.disabled}
                            aria-label={seed.locked ? labels.unlockSeed : labels.lockSeed}
                            aria-pressed={seed.locked}
                            onClick={seed.onToggleLock}
                        >
                            {seed.locked
                                ? <Lock className="h-4 w-4" aria-hidden="true" />
                                : <Unlock className="h-4 w-4" aria-hidden="true" />}
                        </Button>
                    )}
                    {seed.onPreviewWildcard && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0"
                            disabled={disabled || seed.disabled}
                            aria-label={seed.wildcardPreviewLabel ?? 'Preview wildcard'}
                            onClick={seed.onPreviewWildcard}
                        >
                            <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        </Button>
                    )}
                </div>
            ) : (
                <span className="hidden xl:block" />
            )}

            <Button
                type="button"
                variant={generation.generating ? 'destructive' : 'generate'}
                className="min-w-0 md:col-span-2 xl:col-span-1"
                disabled={actionDisabled}
                onClick={generation.generating ? generation.onCancel : generation.onGenerate}
                data-testid={generation.generating
                    ? generation.cancelTestId ?? generation.actionTestId
                    : generation.actionTestId}
            >
                {generation.generating
                    ? <Square className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                    : <Play className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="truncate">
                    {generation.progressLabel
                        ?? (generation.generating
                            ? generation.cancelLabel ?? labels.cancel
                            : generation.generateLabel ?? labels.generate)}
                </span>
            </Button>
        </header>
    )
}
