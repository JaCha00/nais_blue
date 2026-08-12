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
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { StructuredPromptModuleLibrary } from '@/components/prompt-modules/StructuredPromptModuleLibrary'
import { appendStructuredPromptText } from '@/presentation/workflow/structured-prompt-insertion'

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
                <div className="flex min-h-11 flex-wrap items-center justify-end gap-3 border-b border-border/45 px-2 py-1">
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
