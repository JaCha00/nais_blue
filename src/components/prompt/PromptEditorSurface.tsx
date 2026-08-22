import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownWideNarrow, Undo2 } from 'lucide-react'

import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { Button } from '@/components/ui/button'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { PromptSlotTabs } from '@/components/prompt/PromptSlotTabs'
import { PromptFrequencySortDialog } from '@/components/prompt/PromptFrequencySortDialog'
import {
    appendPromptModuleLine,
    PromptModulePicker,
} from '@/components/fragments/PromptModulePicker'
import { useGenerationDraftStore } from '@/stores/generation-draft-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { StructuredPromptModuleLibrary } from '@/components/prompt-modules/StructuredPromptModuleLibrary'
import { appendStructuredPromptText } from '@/presentation/workflow/structured-prompt-insertion'

type PromptSlot = 'base' | 'additional' | 'detail' | 'negative'

interface PromptContextSnapshot {
    slot: PromptSlot
    fullValue: string
    selectionStart: number
    selectionEnd: number
}

interface PromptSortRequest {
    slot: PromptSlot
    source: string
    fullValue: string
    range: readonly [start: number, end: number] | null
}

interface PromptSortUndo {
    before: string
    after: string
}

/**
 * Store-backed prompt editor shared by future Dock and Sheet containers. It
 * depends only on GenerationDraft and the font preference, deliberately
 * excluding queue, route, cancellation, and provider command ownership.
 */
export function PromptEditorSurface() {
    const { t } = useTranslation()
    const [activePromptSlot, setActivePromptSlot] = useState<PromptSlot>('base')
    const [contextSnapshot, setContextSnapshot] = useState<PromptContextSnapshot | null>(null)
    const [sortRequest, setSortRequest] = useState<PromptSortRequest | null>(null)
    const [sortUndoBySlot, setSortUndoBySlot] = useState<Partial<Record<PromptSlot, PromptSortUndo>>>({})
    const editorPanelId = `prompt-command-editor-${useId().replace(/:/g, '')}`
    const promptFontSize = useSettingsStore(state => state.promptFontSize)
    const basePrompt = useGenerationDraftStore(state => state.basePrompt)
    const additionalPrompt = useGenerationDraftStore(state => state.additionalPrompt)
    const detailPrompt = useGenerationDraftStore(state => state.detailPrompt)
    const negativePrompt = useGenerationDraftStore(state => state.negativePrompt)
    const setBasePrompt = useGenerationDraftStore(state => state.setBasePrompt)
    const setAdditionalPrompt = useGenerationDraftStore(state => state.setAdditionalPrompt)
    const setDetailPrompt = useGenerationDraftStore(state => state.setDetailPrompt)
    const setNegativePrompt = useGenerationDraftStore(state => state.setNegativePrompt)
    const characters = useCharacterPromptStore(state => state.characters)
    const addCharacter = useCharacterPromptStore(state => state.addCharacter)
    const setPositionEnabled = useCharacterPromptStore(state => state.setPositionEnabled)

    const promptSlots = [
        {
            id: 'base' as const,
            label: t('prompt.base'),
            placeholder: t('prompt.basePlaceholder'),
            value: basePrompt,
            setValue: setBasePrompt,
        },
        {
            id: 'additional' as const,
            label: t('prompt.additional'),
            placeholder: t('prompt.additionalPlaceholder'),
            value: additionalPrompt,
            setValue: setAdditionalPrompt,
        },
        {
            id: 'detail' as const,
            label: t('prompt.detail'),
            placeholder: t('prompt.detailPlaceholder'),
            value: detailPrompt,
            setValue: setDetailPrompt,
        },
        {
            id: 'negative' as const,
            label: t('prompt.negative'),
            placeholder: t('prompt.negativePlaceholder'),
            value: negativePrompt,
            setValue: setNegativePrompt,
        },
    ]
    const activePrompt = promptSlots.find(slot => slot.id === activePromptSlot) ?? promptSlots[0]
    const activeSortUndo = sortUndoBySlot[activePrompt.id]
    const canUndoSort = activeSortUndo?.after === activePrompt.value
    const canSortSelection = contextSnapshot?.slot === activePrompt.id
        && contextSnapshot.selectionEnd > contextSnapshot.selectionStart
        && contextSnapshot.fullValue
            .slice(contextSnapshot.selectionStart, contextSnapshot.selectionEnd)
            .trim().length > 0

    const openFullSort = (fullValue: string) => {
        setSortRequest({
            slot: activePrompt.id,
            source: fullValue,
            fullValue,
            range: null,
        })
    }

    const openSelectionSort = () => {
        if (!contextSnapshot || !canSortSelection) return
        // The full snapshot plus UTF-16 selection offsets form one edit
        // transaction, so the async lookup can never rewrite outside the drag.
        setSortRequest({
            slot: contextSnapshot.slot,
            source: contextSnapshot.fullValue.slice(
                contextSnapshot.selectionStart,
                contextSnapshot.selectionEnd,
            ),
            fullValue: contextSnapshot.fullValue,
            range: [contextSnapshot.selectionStart, contextSnapshot.selectionEnd],
        })
    }

    const applySortedPrompt = (sorted: string) => {
        if (!sortRequest) return
        const nextValue = sortRequest.range
            ? `${sortRequest.fullValue.slice(0, sortRequest.range[0])}${sorted}${sortRequest.fullValue.slice(sortRequest.range[1])}`
            : sorted
        promptSlots.find(slot => slot.id === sortRequest.slot)?.setValue(nextValue)
        setSortUndoBySlot(current => ({
            ...current,
            [sortRequest.slot]: { before: sortRequest.fullValue, after: nextValue },
        }))
    }

    const undoLastSort = () => {
        if (!activeSortUndo || !canUndoSort) return
        activePrompt.setValue(activeSortUndo.before)
        setSortUndoBySlot(current => ({ ...current, [activePrompt.id]: undefined }))
    }

    return (
        <div
            className="@container flex flex-none flex-col border-y border-border/60 bg-transparent"
            // A dock-level test boundary keeps responsive smoke checks coupled to
            // this shared editor surface, not react-simple-code-editor internals.
            data-testid="prompt-editor-surface"
        >
            <PromptSlotTabs
                tabs={promptSlots.map(slot => ({
                    id: slot.id,
                    label: slot.label,
                    filled: slot.value.trim().length > 0,
                    negative: slot.id === 'negative',
                }))}
                activeId={activePrompt.id}
                panelId={editorPanelId}
                label={t('prompt.title', '프롬프트')}
                onChange={id => setActivePromptSlot(id as PromptSlot)}
            />
            <div
                id={editorPanelId}
                role="tabpanel"
                aria-labelledby={`${editorPanelId}-${activePrompt.id}-tab`}
                className="flex min-h-0 flex-col"
            >
                <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border/45 px-2 py-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={!activePrompt.value.trim()}
                            onClick={() => openFullSort(activePrompt.value)}
                            data-testid="prompt-frequency-sort-all"
                        >
                            <ArrowDownWideNarrow className="mr-1 h-3.5 w-3.5" />
                            {t('promptFrequencySort.sortAll', '전체 빈도 정렬')}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={!canUndoSort}
                            onClick={undoLastSort}
                            data-testid="prompt-frequency-sort-undo"
                        >
                            <Undo2 className="mr-1 h-3.5 w-3.5" />
                            {t('promptFrequencySort.undo', '정렬 되돌리기')}
                        </Button>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
                        <StructuredPromptModuleLibrary
                            currentParts={{
                                base: basePrompt,
                                detail: detailPrompt,
                                additional: additionalPrompt,
                                negative: negativePrompt,
                                character: characters.find(character => character.enabled)?.prompt,
                                'character-negative': characters.find(character => character.enabled)?.negative,
                            }}
                            triggerLabel={t('promptModuleLibrary.triggerShort', '구조화 모듈')}
                            triggerClassName="shrink-0"
                            onInsert={(parts, module) => {
                                let character = ''
                                let characterNegative = ''
                                for (const part of parts) {
                                    if (part.kind === 'base') setBasePrompt(appendStructuredPromptText(basePrompt, part.content))
                                    else if (part.kind === 'detail') setDetailPrompt(appendStructuredPromptText(detailPrompt, part.content))
                                    else if (part.kind === 'additional') setAdditionalPrompt(appendStructuredPromptText(additionalPrompt, part.content))
                                    else if (part.kind === 'negative') setNegativePrompt(appendStructuredPromptText(negativePrompt, part.content))
                                    else if (part.kind === 'character') character = appendStructuredPromptText(character, part.content)
                                    else characterNegative = appendStructuredPromptText(characterNegative, part.content)
                                }
                                if (parts.some(part => part.kind === 'character' || part.kind === 'character-negative')) {
                                    addCharacter({
                                        name: module.name,
                                        prompt: character,
                                        negative: characterNegative,
                                        enabled: true,
                                        position: { x: 0.5, y: 0.5 },
                                    })
                                    setPositionEnabled(true)
                                }
                            }}
                        />
                        <PromptModulePicker
                            triggerLabel={t('guided.promptModules.legacyTriggerShort', '한 줄 모듈')}
                            triggerClassName="shrink-0"
                            onSelectLine={line => activePrompt.setValue(
                                appendPromptModuleLine(activePrompt.value, line),
                            )}
                        />
                    </div>
                </div>
                <ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div>
                            <AutocompleteTextarea
                                key={activePrompt.id}
                                placeholder={activePrompt.placeholder}
                                value={activePrompt.value}
                                onChange={event => activePrompt.setValue(event.target.value)}
                                onPromptContextMenu={context => {
                                    setContextSnapshot({
                                        slot: activePrompt.id,
                                        fullValue: context.value,
                                        selectionStart: context.selectionStart,
                                        selectionEnd: context.selectionEnd,
                                    })
                                }}
                                ariaLabel={activePrompt.label}
                                className={cn(
                                    'h-40 min-h-40 resize-none rounded-none border-0 bg-transparent focus-within:ring-1 focus-within:ring-inset',
                                    activePrompt.id === 'negative' && 'focus-within:ring-destructive/50',
                                )}
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-60">
                        <ContextMenuLabel>
                            {t('promptFrequencySort.contextTitle', '프롬프트 정렬')}
                        </ContextMenuLabel>
                        <ContextMenuItem disabled={!canSortSelection} onSelect={openSelectionSort}>
                            <ArrowDownWideNarrow className="mr-2 h-4 w-4" />
                            {t('promptFrequencySort.sortSelection', '선택 영역 빈도 정렬')}
                        </ContextMenuItem>
                        <ContextMenuItem
                            disabled={!contextSnapshot?.fullValue.trim()}
                            onSelect={() => contextSnapshot && openFullSort(contextSnapshot.fullValue)}
                        >
                            <ArrowDownWideNarrow className="mr-2 h-4 w-4" />
                            {t('promptFrequencySort.sortAll', '전체 빈도 정렬')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem disabled={!canUndoSort} onSelect={undoLastSort}>
                            <Undo2 className="mr-2 h-4 w-4" />
                            {t('promptFrequencySort.undo', '정렬 되돌리기')}
                        </ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
            </div>

            <PromptFrequencySortDialog
                open={sortRequest !== null}
                source={sortRequest?.source ?? ''}
                onOpenChange={open => {
                    if (!open) setSortRequest(null)
                }}
                onApply={applySortedPrompt}
            />
        </div>
    )
}
