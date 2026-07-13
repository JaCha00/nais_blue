import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Edit3, Power, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ValidationState } from './ValidationState'
import {
    DEFAULT_COMPOSITION_WORKSPACE_LABELS,
    type CompositionWorkspaceLabels,
    type ModuleStackItem,
} from './types'

export const MODULE_STACK_ROW_HEIGHT = 80
export const MODULE_STACK_OVERSCAN = 5

export interface ModuleStackVirtualRange {
    start: number
    end: number
}

export function calculateModuleStackVirtualRange({
    itemCount,
    scrollTop,
    viewportHeight,
    rowHeight = MODULE_STACK_ROW_HEIGHT,
    overscan = MODULE_STACK_OVERSCAN,
}: {
    itemCount: number
    scrollTop: number
    viewportHeight: number
    rowHeight?: number
    overscan?: number
}): ModuleStackVirtualRange {
    const count = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0
    if (count === 0) return { start: 0, end: 0 }
    const safeRowHeight = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : MODULE_STACK_ROW_HEIGHT
    const safeScrollTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
    const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0
    const safeOverscan = Number.isFinite(overscan) ? Math.max(0, Math.trunc(overscan)) : 0
    const firstVisible = Math.min(count - 1, Math.floor(safeScrollTop / safeRowHeight))
    const visibleCount = Math.max(1, Math.ceil(safeViewportHeight / safeRowHeight))
    return {
        start: Math.max(0, firstVisible - safeOverscan),
        end: Math.min(count, firstVisible + visibleCount + safeOverscan),
    }
}

export interface ModuleStackProps {
    modules: readonly ModuleStackItem[]
    activeModuleId?: string | null
    title?: string
    disabled?: boolean
    height?: number | string
    emptyLabel?: string
    searchValue?: string
    searchLabel?: string
    labels?: Partial<CompositionWorkspaceLabels>
    className?: string
    onSearchChange?: (value: string) => void
    onSelectModule: (moduleId: string) => void
    onToggleModule?: (moduleId: string, enabled: boolean) => void
    onMoveModule?: (moduleId: string, direction: 'up' | 'down') => void
    onEditModule?: (moduleId: string) => void
}

/**
 * Controlled, fixed-row module stack. It owns only scroll measurements; every
 * domain mutation is delegated to repository-backed callbacks supplied by the page.
 */
export function ModuleStack({
    modules,
    activeModuleId,
    title,
    disabled = false,
    height = 'min(36rem, 65dvh)',
    emptyLabel,
    searchValue,
    searchLabel = 'Search modules',
    labels: labelsOverride,
    className,
    onSearchChange,
    onSelectModule,
    onToggleModule,
    onMoveModule,
    onEditModule,
}: ModuleStackProps) {
    const labels = { ...DEFAULT_COMPOSITION_WORKSPACE_LABELS, ...labelsOverride }
    const viewportRef = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)
    const [viewportHeight, setViewportHeight] = useState(560)
    const orderedModules = useMemo(
        () => [...modules].sort((left, right) => left.order - right.order),
        [modules],
    )

    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const measure = () => setViewportHeight(viewport.clientHeight || 560)
        measure()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        observer?.observe(viewport)
        return () => observer?.disconnect()
    }, [])

    const range = useMemo(() => calculateModuleStackVirtualRange({
        itemCount: orderedModules.length,
        scrollTop,
        viewportHeight,
    }), [orderedModules.length, scrollTop, viewportHeight])

    return (
        <section
            className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-card', className)}
            aria-labelledby="composition-module-stack-title"
            data-testid="composition-module-stack"
        >
            <header className="flex min-h-11 min-w-0 items-center justify-between gap-2 border-b border-border px-3">
                <h2 id="composition-module-stack-title" className="min-w-0 truncate text-sm font-semibold" title={title ?? labels.modules}>
                    {title ?? labels.modules}
                </h2>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{orderedModules.length}</span>
            </header>

            {onSearchChange && (
                <label className="relative block border-b border-border p-2">
                    <span className="sr-only">{searchLabel}</span>
                    <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                        value={searchValue ?? ''}
                        onChange={event => onSearchChange(event.currentTarget.value)}
                        className="h-11 min-w-0 pl-9"
                        placeholder={searchLabel}
                        disabled={disabled}
                    />
                </label>
            )}

            {orderedModules.length === 0 ? (
                <div className="flex min-h-44 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                    {emptyLabel ?? labels.empty}
                </div>
            ) : (
                <div
                    ref={viewportRef}
                    className="min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain"
                    style={{ height }}
                    role="list"
                    aria-label={title ?? labels.modules}
                    onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
                >
                    <div className="relative min-w-0" style={{ height: orderedModules.length * MODULE_STACK_ROW_HEIGHT }}>
                        {orderedModules.slice(range.start, range.end).map((module, offset) => {
                            const index = range.start + offset
                            const selected = module.id === activeModuleId
                            const canMoveUp = index > 0
                            const canMoveDown = index < orderedModules.length - 1
                            const validation = module.validation ?? {
                                severity: module.enabled ? 'valid' as const : 'disabled' as const,
                            }
                            return (
                                <div
                                    id={`composition-module-${module.id}`}
                                    key={module.id}
                                    role="listitem"
                                    className={cn(
                                        'absolute left-0 flex min-w-0 items-center gap-1 border-b border-border px-1',
                                        selected ? 'bg-accent text-accent-foreground' : 'bg-card hover:bg-muted/50',
                                        module.missing && 'border-l-2 border-l-destructive',
                                    )}
                                    style={{
                                        height: MODULE_STACK_ROW_HEIGHT,
                                        width: '100%',
                                        transform: `translateY(${index * MODULE_STACK_ROW_HEIGHT}px)`,
                                    }}
                                    data-module-id={module.id}
                                >
                                    {onToggleModule && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="shrink-0"
                                            disabled={disabled || module.missing}
                                            aria-label={`${module.enabled ? labels.disable : labels.enable} ${module.name}`}
                                            aria-pressed={module.enabled}
                                            onClick={() => onToggleModule(module.id, !module.enabled)}
                                        >
                                            <Power className={cn('h-4 w-4', module.enabled ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                                        </Button>
                                    )}

                                    <button
                                        type="button"
                                        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-control px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        disabled={disabled}
                                        aria-current={selected ? 'true' : undefined}
                                        onClick={() => onSelectModule(module.id)}
                                        onKeyDown={event => {
                                            if (!event.altKey || !onMoveModule) return
                                            if (event.key === 'ArrowUp' && canMoveUp) {
                                                event.preventDefault()
                                                onMoveModule(module.id, 'up')
                                            } else if (event.key === 'ArrowDown' && canMoveDown) {
                                                event.preventDefault()
                                                onMoveModule(module.id, 'down')
                                            }
                                        }}
                                        title={module.name}
                                    >
                                        <span className="block w-full truncate text-sm font-medium">{module.name}</span>
                                        <span className="flex w-full min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                                            <span className="shrink-0 font-mono">{module.kind}</span>
                                            {module.summary && <span className="min-w-0 truncate" title={module.summary}>{module.summary}</span>}
                                        </span>
                                    </button>

                                    <ValidationState validation={validation} compact className="shrink-0" />

                                    {onEditModule && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="shrink-0"
                                            disabled={disabled || module.missing}
                                            aria-label={`${labels.edit} ${module.name}`}
                                            onClick={() => onEditModule(module.id)}
                                        >
                                            <Edit3 className="h-4 w-4" aria-hidden="true" />
                                        </Button>
                                    )}

                                    {onMoveModule && (
                                        <span className="flex shrink-0">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                disabled={disabled || !canMoveUp}
                                                aria-label={`${labels.moveUp} ${module.name}`}
                                                onClick={() => onMoveModule(module.id, 'up')}
                                            >
                                                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                disabled={disabled || !canMoveDown}
                                                aria-label={`${labels.moveDown} ${module.name}`}
                                                onClick={() => onMoveModule(module.id, 'down')}
                                            >
                                                <ArrowDown className="h-4 w-4" aria-hidden="true" />
                                            </Button>
                                        </span>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </section>
    )
}
