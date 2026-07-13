import { Eye, Layers3, PanelRight, Play, Square } from 'lucide-react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CompositionGenerationControl } from './types'

export interface MobileCommandDockLabels {
    commands: string
    modules: string
    inspector: string
    resolved: string
    generate: string
    cancel: string
}

const DEFAULT_LABELS: MobileCommandDockLabels = {
    commands: 'Composition mobile commands',
    modules: 'Modules',
    inspector: 'Inspector',
    resolved: 'Resolved',
    generate: 'Generate',
    cancel: 'Cancel',
}

export interface MobileCommandDockProps {
    generation: CompositionGenerationControl
    disabled?: boolean
    resolvedAvailable?: boolean
    labels?: Partial<MobileCommandDockLabels>
    className?: string
    testId?: string
    onOpenModules: () => void
    onOpenInspector: () => void
    onOpenResolved: () => void
}

/** Fixed mobile command dock; every critical action remains one tap from the canvas. */
export function MobileCommandDock({
    generation,
    disabled = false,
    resolvedAvailable = true,
    labels: labelsOverride,
    className,
    testId = 'composition-mobile-command-dock',
    onOpenModules,
    onOpenInspector,
    onOpenResolved,
}: MobileCommandDockProps) {
    const labels = { ...DEFAULT_LABELS, ...labelsOverride }
    const actionDisabled = disabled || generation.disabled
    const dock = (
        <nav
            className={cn(
                'fixed inset-x-0 bottom-0 z-40 grid min-w-0 grid-cols-[2.75rem_2.75rem_2.75rem_minmax(0,1fr)] gap-1 border-t border-border bg-card md:hidden',
                'pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-2',
                className,
            )}
            aria-label={labels.commands}
            data-testid={testId}
        >
            <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={labels.modules} onClick={onOpenModules}>
                <Layers3 className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={labels.inspector} onClick={onOpenInspector}>
                <PanelRight className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={labels.resolved}
                disabled={disabled || !resolvedAvailable}
                onClick={onOpenResolved}
            >
                <Eye className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button
                type="button"
                variant={generation.generating ? 'destructive' : 'generate'}
                className="min-w-0 px-3"
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
        </nav>
    )
    return typeof document === 'undefined' ? dock : createPortal(dock, document.body)
}
