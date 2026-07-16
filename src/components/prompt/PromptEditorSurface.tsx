import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { cn } from '@/lib/utils'
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
        <div className="flex min-h-40 flex-none flex-col gap-2 rounded-panel bg-canvas p-2">
            <div className="grid grid-cols-4 gap-1" role="tablist" aria-label={t('prompt.title', '프롬프트')}>
                {promptSlots.map(slot => {
                    const isActive = slot.id === activePrompt.id
                    return (
                        <button
                            key={slot.id}
                            type="button"
                            role="tab"
                            id={`${editorPanelId}-${slot.id}-tab`}
                            aria-selected={isActive}
                            aria-controls={editorPanelId}
                            onClick={() => setActivePromptSlot(slot.id)}
                            className={cn(
                                'relative flex h-11 min-w-0 items-center justify-center rounded-control px-2 text-xs font-medium transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                isActive
                                    ? slot.id === 'negative' ? 'bg-destructive/10 text-destructive' : 'bg-accent text-primary'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                        >
                            <span className="truncate">{slot.label}</span>
                            {slot.value && !isActive && (
                                <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-current opacity-60" aria-hidden="true" />
                            )}
                        </button>
                    )
                })}
            </div>
            <div
                id={editorPanelId}
                role="tabpanel"
                aria-labelledby={`${editorPanelId}-${activePrompt.id}-tab`}
                className="min-h-28 flex-1"
            >
                <AutocompleteTextarea
                    key={activePrompt.id}
                    placeholder={activePrompt.placeholder}
                    value={activePrompt.value}
                    onChange={event => activePrompt.setValue(event.target.value)}
                    className={cn(
                        'h-full min-h-28 resize-none rounded-control bg-card',
                        activePrompt.id === 'negative' && 'border-destructive/30',
                    )}
                    style={{ fontSize: `${promptFontSize}px` }}
                />
            </div>
        </div>
    )
}
