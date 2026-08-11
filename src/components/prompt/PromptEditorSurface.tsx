import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { cn } from '@/lib/utils'
import { PromptSlotTabs } from '@/components/prompt/PromptSlotTabs'
import {
    appendPromptModuleLine,
    PromptModulePicker,
} from '@/components/fragments/PromptModulePicker'
import { useGenerationDraftStore } from '@/stores/generation-draft-store'
import { useSettingsStore } from '@/stores/settings-store'

type PromptSlot = 'base' | 'additional' | 'detail' | 'negative'

/**
 * Store-backed prompt editor shared by future Dock and Sheet containers. It
 * depends only on GenerationDraft and the font preference, deliberately
 * excluding queue, route, cancellation, and provider command ownership.
 */
export function PromptEditorSurface() {
    const { t } = useTranslation()
    const [activePromptSlot, setActivePromptSlot] = useState<PromptSlot>('base')
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
                <div className="flex min-h-11 items-center justify-end border-b border-border/45 px-2">
                    <PromptModulePicker
                        triggerLabel={t('guided.promptModules.triggerShort', '모듈 불러오기')}
                        triggerClassName="shrink-0"
                        onSelectLine={line => activePrompt.setValue(
                            appendPromptModuleLine(activePrompt.value, line),
                        )}
                    />
                </div>
                <AutocompleteTextarea
                    key={activePrompt.id}
                    placeholder={activePrompt.placeholder}
                    value={activePrompt.value}
                    onChange={event => activePrompt.setValue(event.target.value)}
                    ariaLabel={activePrompt.label}
                    className={cn(
                        'h-40 min-h-40 resize-none rounded-none border-0 bg-transparent focus-within:ring-1 focus-within:ring-inset',
                        activePrompt.id === 'negative' && 'focus-within:ring-destructive/50',
                    )}
                    style={{ fontSize: `${promptFontSize}px` }}
                />
            </div>
        </div>
    )
}
