import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CompositionModule, EntityId } from '@/domain/composition/types'
import { calculateFixedVirtualRange } from '@/lib/virtualization/fixed-range'

export { calculateFixedVirtualRange } from '@/lib/virtualization/fixed-range'

export const FIXED_MODULE_ROW_HEIGHT = 68
export const FIXED_MODULE_OVERSCAN = 5

export interface VirtualModuleRow {
    module: CompositionModule
    issueLevel: 'valid' | 'warning' | 'error'
}

export interface FixedVirtualModuleListProps {
    rows: readonly VirtualModuleRow[]
    selectedId: EntityId | null
    checkedIds: ReadonlySet<EntityId>
    onSelect: (id: EntityId) => void
    onCheck: (id: EntityId, checked: boolean) => void
    emptyLabel: string
}

/** Fixed-height virtualization keeps the Asset Studio responsive with 500+ modules. */
export function FixedVirtualModuleList({
    rows,
    selectedId,
    checkedIds,
    onSelect,
    onCheck,
    emptyLabel,
}: FixedVirtualModuleListProps) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)
    const [viewportHeight, setViewportHeight] = useState(352)

    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const updateHeight = () => setViewportHeight(viewport.clientHeight || 352)
        updateHeight()
        const observer = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(updateHeight)
        observer?.observe(viewport)
        return () => observer?.disconnect()
    }, [])

    const windowRange = useMemo(() => calculateFixedVirtualRange({
        itemCount: rows.length,
        scrollTop,
        viewportHeight,
    }), [rows.length, scrollTop, viewportHeight])

    if (rows.length === 0) {
        return (
            <div className="flex min-h-44 items-center justify-center border-t border-border px-3 text-center text-sm text-muted-foreground">
                {emptyLabel}
            </div>
        )
    }

    return (
        <div
            ref={viewportRef}
            className="h-[22rem] min-h-0 w-full overflow-x-hidden overflow-y-auto border-t border-border sm:h-[26rem]"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            role="list"
            aria-label="Modules"
            data-testid="virtual-module-list"
        >
            <div className="relative w-full" style={{ height: rows.length * FIXED_MODULE_ROW_HEIGHT }}>
                {rows.slice(windowRange.start, windowRange.end).map((row, offset) => {
                    const index = windowRange.start + offset
                    const selected = selectedId === row.module.id
                    return (
                        <div
                            key={row.module.id}
                            role="listitem"
                            className={cn(
                                'absolute left-0 flex w-full min-w-0 items-center gap-1 border-b border-border px-1',
                                selected ? 'bg-accent text-accent-foreground' : 'bg-card hover:bg-muted/50',
                            )}
                            style={{
                                height: FIXED_MODULE_ROW_HEIGHT,
                                transform: `translateY(${index * FIXED_MODULE_ROW_HEIGHT}px)`,
                            }}
                            data-module-id={row.module.id}
                        >
                            <label className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control focus-within:ring-2 focus-within:ring-ring">
                                <input
                                    type="checkbox"
                                    checked={checkedIds.has(row.module.id)}
                                    onChange={(event) => onCheck(row.module.id, event.currentTarget.checked)}
                                    aria-label={`${row.module.name} select`}
                                    className="h-4 w-4 accent-primary"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() => onSelect(row.module.id)}
                                aria-current={selected ? 'true' : undefined}
                                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium" title={row.module.name}>{row.module.name}</span>
                                    <span className="block truncate font-mono text-[11px] text-muted-foreground" title={row.module.id}>
                                        {row.module.kind} · {row.module.id}
                                    </span>
                                </span>
                                <span className="shrink-0" aria-label={row.issueLevel}>
                                    {row.issueLevel === 'valid'
                                        ? <CheckCircle2 className="h-4 w-4 text-success" />
                                        : <CircleAlert className={cn('h-4 w-4', row.issueLevel === 'error' ? 'text-destructive' : 'text-warning')} />}
                                </span>
                                <span className={cn(
                                    'min-w-8 shrink-0 text-center text-[11px] font-medium',
                                    row.module.enabled ? 'text-primary' : 'text-muted-foreground',
                                )}>
                                    {row.module.enabled ? 'ON' : 'OFF'}
                                </span>
                            </button>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
