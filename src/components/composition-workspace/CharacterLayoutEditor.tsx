import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { CharacterPosition } from '@/domain/composition'
import { ValidationState } from './ValidationState'
import type { CharacterLayoutItem } from './types'

export const CHARACTER_LAYOUT_ROW_HEIGHT = 288
export const CHARACTER_LAYOUT_VIRTUALIZATION_THRESHOLD = 40
export const CHARACTER_LAYOUT_OVERSCAN = 3

export interface CharacterLayoutVirtualRange {
    start: number
    end: number
}

/** Pure range calculation shared by the UI and scale contract tests. */
export function calculateCharacterLayoutVirtualRange({
    itemCount,
    scrollTop,
    viewportHeight,
    rowHeight = CHARACTER_LAYOUT_ROW_HEIGHT,
    overscan = CHARACTER_LAYOUT_OVERSCAN,
}: {
    itemCount: number
    scrollTop: number
    viewportHeight: number
    rowHeight?: number
    overscan?: number
}): CharacterLayoutVirtualRange {
    const count = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0
    if (count === 0) return { start: 0, end: 0 }
    const safeRowHeight = Number.isFinite(rowHeight) && rowHeight > 0
        ? rowHeight
        : CHARACTER_LAYOUT_ROW_HEIGHT
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

export interface CharacterLayoutEditorLabels {
    title: string
    aiChoice: string
    manual: string
    positionMode: string
    x: string
    y: string
    moveUp: string
    moveDown: string
    empty: string
}

const DEFAULT_LABELS: CharacterLayoutEditorLabels = {
    title: 'Character layout',
    aiChoice: 'AI choice',
    manual: 'Manual',
    positionMode: 'Position mode',
    x: 'X position',
    y: 'Y position',
    moveUp: 'Move up',
    moveDown: 'Move down',
    empty: 'No character slots',
}

export interface CharacterLayoutEditorProps {
    characters: readonly CharacterLayoutItem[]
    title?: string
    disabled?: boolean
    labels?: Partial<CharacterLayoutEditorLabels>
    className?: string
    onChangePosition: (characterId: string, position: CharacterPosition) => void
    onMoveCharacter?: (characterId: string, direction: 'up' | 'down') => void
}

/** Controlled character-position editor; position writes are delegated to the caller. */
export function CharacterLayoutEditor({
    characters,
    title,
    disabled = false,
    labels: labelsOverride,
    className,
    onChangePosition,
    onMoveCharacter,
}: CharacterLayoutEditorProps) {
    const labels = { ...DEFAULT_LABELS, ...labelsOverride }
    const viewportRef = useRef<HTMLDivElement>(null)
    const [scrollTop, setScrollTop] = useState(0)
    const [viewportHeight, setViewportHeight] = useState(560)
    const virtualized = characters.length >= CHARACTER_LAYOUT_VIRTUALIZATION_THRESHOLD

    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const measure = () => setViewportHeight(viewport.clientHeight || 560)
        measure()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        observer?.observe(viewport)
        return () => observer?.disconnect()
    }, [])

    const range = useMemo(() => virtualized
        ? calculateCharacterLayoutVirtualRange({
            itemCount: characters.length,
            scrollTop,
            viewportHeight,
        })
        : { start: 0, end: characters.length }, [characters.length, scrollTop, viewportHeight, virtualized])

    const updateCoordinate = (character: CharacterLayoutItem, coordinate: 'x' | 'y', rawValue: string) => {
        if (character.position.mode !== 'manual') return
        const nextValue = Number(rawValue)
        if (!Number.isFinite(nextValue)) return
        onChangePosition(character.id, {
            ...character.position,
            [coordinate]: nextValue,
        })
    }

    return (
        <section
            className={cn('min-w-0 rounded-panel border border-border bg-card', className)}
            aria-labelledby="composition-character-layout-title"
            data-testid="composition-character-layout"
        >
            <header className="flex min-h-11 min-w-0 items-center gap-2 border-b border-border px-3">
                <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <h3 id="composition-character-layout-title" className="min-w-0 truncate text-sm font-semibold" title={title ?? labels.title}>
                    {title ?? labels.title}
                </h3>
            </header>

            {characters.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">{labels.empty}</p>
            ) : (
                <div
                    ref={viewportRef}
                    className="max-h-[min(44rem,65dvh)] min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain"
                    data-virtualized={virtualized ? 'true' : 'false'}
                    onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
                >
                    <div
                        className={cn('min-w-0 divide-y divide-border', virtualized && 'relative divide-y-0')}
                        style={virtualized ? { height: characters.length * CHARACTER_LAYOUT_ROW_HEIGHT } : undefined}
                    >
                    {characters.slice(range.start, range.end).map((character, offset) => {
                        const index = range.start + offset
                        const manual = character.position.mode === 'manual'
                        return (
                            <fieldset
                                key={character.id}
                                className={cn(
                                    'min-w-0 border-b border-border p-3 disabled:opacity-45',
                                    virtualized && 'absolute left-0 overflow-hidden',
                                )}
                                style={virtualized ? {
                                    height: CHARACTER_LAYOUT_ROW_HEIGHT,
                                    width: '100%',
                                    transform: `translateY(${index * CHARACTER_LAYOUT_ROW_HEIGHT}px)`,
                                } : undefined}
                                disabled={disabled || !character.enabled}
                                onKeyDown={event => {
                                    if (!event.altKey || !onMoveCharacter) return
                                    if (event.key === 'ArrowUp' && index > 0) {
                                        event.preventDefault()
                                        onMoveCharacter(character.id, 'up')
                                    } else if (event.key === 'ArrowDown' && index < characters.length - 1) {
                                        event.preventDefault()
                                        onMoveCharacter(character.id, 'down')
                                    }
                                }}
                            >
                                <legend className="sr-only">{character.name}</legend>
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="min-w-0 flex-1">
                                        <span className="line-clamp-2 break-words text-sm font-medium" title={character.name}>{character.name}</span>
                                        <span className="block truncate font-mono text-[11px] text-muted-foreground" title={character.id}>{character.id}</span>
                                    </span>
                                    {character.validation && <ValidationState validation={character.validation} compact />}
                                    {onMoveCharacter && (
                                        <span className="flex shrink-0">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                disabled={disabled || index === 0}
                                                aria-label={`${labels.moveUp} ${character.name}`}
                                                onClick={() => onMoveCharacter(character.id, 'up')}
                                            >
                                                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                disabled={disabled || index === characters.length - 1}
                                                aria-label={`${labels.moveDown} ${character.name}`}
                                                onClick={() => onMoveCharacter(character.id, 'down')}
                                            >
                                                <ArrowDown className="h-4 w-4" aria-hidden="true" />
                                            </Button>
                                        </span>
                                    )}
                                </div>

                                <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)]">
                                    <div className="min-w-0">
                                        <Label htmlFor={`character-position-mode-${character.id}`} className="sr-only">
                                            {labels.positionMode}: {character.name}
                                        </Label>
                                        <Select
                                            value={character.position.mode}
                                            onValueChange={value => onChangePosition(
                                                character.id,
                                                value === 'manual'
                                                    ? { mode: 'manual', x: 0.5, y: 0.5 }
                                                    : { mode: 'ai-choice' },
                                            )}
                                        >
                                            <SelectTrigger id={`character-position-mode-${character.id}`} className="h-11 min-w-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ai-choice">{labels.aiChoice}</SelectItem>
                                                <SelectItem value="manual">{labels.manual}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="grid min-w-0 grid-cols-2 gap-2">
                                        <Label className="min-w-0 text-xs text-muted-foreground">
                                            <span className="mb-1 block">{labels.x}</span>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={1}
                                                step={0.01}
                                                inputMode="decimal"
                                                value={character.position.mode === 'manual' ? character.position.x : ''}
                                                disabled={!manual || disabled || !character.enabled}
                                                onChange={event => updateCoordinate(character, 'x', event.currentTarget.value)}
                                                className="h-11 min-w-0 font-mono"
                                            />
                                        </Label>
                                        <Label className="min-w-0 text-xs text-muted-foreground">
                                            <span className="mb-1 block">{labels.y}</span>
                                            <Input
                                                type="number"
                                                min={0}
                                                max={1}
                                                step={0.01}
                                                inputMode="decimal"
                                                value={character.position.mode === 'manual' ? character.position.y : ''}
                                                disabled={!manual || disabled || !character.enabled}
                                                onChange={event => updateCoordinate(character, 'y', event.currentTarget.value)}
                                                className="h-11 min-w-0 font-mono"
                                            />
                                        </Label>
                                    </div>
                                </div>
                            </fieldset>
                        )
                    })}
                    </div>
                </div>
            )}
        </section>
    )
}
