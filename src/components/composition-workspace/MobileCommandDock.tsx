import { Eye, Layers3, PanelRight, Play, SlidersHorizontal, Square } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isAndroidRuntime } from '@/platform/runtime'
import type { CompositionGenerationControl } from './types'

export interface MobileCommandDockLabels {
    commands: string
    modules: string
    inspector: string
    resolved: string
    settings: string
    generate: string
    cancel: string
}

const DEFAULT_LABELS: MobileCommandDockLabels = {
    commands: 'Composition mobile commands',
    modules: 'Modules',
    inspector: 'Inspector',
    resolved: 'Resolved',
    settings: 'Settings',
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
    onOpenModules?: () => void
    onOpenInspector?: () => void
    onOpenResolved?: () => void
    onOpenSettings?: () => void
    count?: ReactNode
    simplified?: boolean
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
    onOpenSettings,
    count,
    simplified = false,
}: MobileCommandDockProps) {
    const labels = { ...DEFAULT_LABELS, ...labelsOverride }
    const actionDisabled = disabled || generation.disabled
    const dock = (
        <nav
            className={cn(
                'fixed inset-x-0 bottom-0 z-40 flex min-w-0 gap-1 bg-card md:hidden',
                // Android OEM WebViews can expose a zero env() inset under three-button navigation;
                // the larger runtime-only floor keeps every command target above the system bar.
                isAndroidRuntime
                    ? 'pb-[max(3.5rem,env(safe-area-inset-bottom))]'
                    : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
                isAndroidRuntime && 'android-landscape-safe-inline',
                'pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-2',
                className,
            )}
            aria-label={labels.commands}
            data-testid={testId}
        >
            {onOpenSettings && (
                <Button
                    type="button"
                    variant="ghost"
                    size={simplified ? 'default' : 'icon'}
                    className={simplified ? 'shrink-0 px-2' : undefined}
                    disabled={disabled}
                    aria-label={labels.settings}
                    data-testid="composition-mobile-settings"
                    onClick={onOpenSettings}
                >
                    <SlidersHorizontal className={cn('h-5 w-5', simplified && 'mr-1')} aria-hidden="true" />
                    {simplified && <span>{labels.settings}</span>}
                </Button>
            )}
            {!simplified && (
                <>
                    {onOpenModules && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            aria-label={labels.modules}
                            data-testid="composition-open-modules"
                            onClick={onOpenModules}
                        >
                            <Layers3 className="h-5 w-5" aria-hidden="true" />
                        </Button>
                    )}
                    {onOpenInspector && (
                        <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={labels.inspector} onClick={onOpenInspector}>
                            <PanelRight className="h-5 w-5" aria-hidden="true" />
                        </Button>
                    )}
                    {onOpenResolved && resolvedAvailable && (
                        <Button type="button" variant="ghost" size="icon" aria-label={labels.resolved} disabled={disabled} onClick={onOpenResolved}>
                            <Eye className="h-5 w-5" aria-hidden="true" />
                        </Button>
                    )}
                </>
            )}
            {count && <div className="shrink-0" data-testid="composition-mobile-count">{count}</div>}
            <Button
                type="button"
                variant={generation.generating ? 'destructive' : 'generate'}
                className="min-w-0 flex-1 px-3"
                disabled={actionDisabled}
                onClick={generation.generating ? generation.onCancel : generation.onGenerate}
                data-testid={generation.generating
                    ? generation.cancelTestId ?? generation.actionTestId
                    : generation.actionTestId}
                data-command-group="primary"
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
