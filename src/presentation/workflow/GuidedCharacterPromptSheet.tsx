import { Eye, EyeOff, Plus, Trash2, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type {
    WorkflowCharacterPrompt,
    WorkflowCharacterPrompts,
} from '@/domain/workflow/single-image-draft'

interface GuidedCharacterPromptSheetProps {
    value: WorkflowCharacterPrompts
    disabled: boolean
    onChange(value: WorkflowCharacterPrompts): void
}

function hasPrompt(value: string): boolean {
    return value.split(/\r?\n/).some(line => {
        const trimmed = line.trim()
        return trimmed.length > 0 && !trimmed.startsWith('#')
    })
}

export function GuidedCharacterPromptSheet({
    value,
    disabled,
    onChange,
}: GuidedCharacterPromptSheetProps) {
    const { t } = useTranslation()
    const enabledCount = value.items.filter(character => character.enabled).length

    const addCharacter = () => onChange({
        ...value,
        items: [...value.items, {
            id: `guided-character-${crypto.randomUUID()}`,
            prompt: '',
            negative: '',
            enabled: true,
            position: { x: 0.5, y: 0.5 },
        }],
    })
    const updateCharacter = (id: string, patch: Partial<WorkflowCharacterPrompt>) => onChange({
        ...value,
        items: value.items.map(character => (
            character.id === id ? { ...character, ...patch } : character
        )),
    })
    const removeCharacter = (id: string) => onChange({
        ...value,
        items: value.items.filter(character => character.id !== id),
    })

    return (
        <Sheet>
            <div className="flex min-w-0 items-center justify-between gap-3 border-y border-border/70 py-3">
                <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                        <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                        {t('guided.characters.title', '캐릭터 프롬프트')}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {enabledCount > 0
                            ? t('guided.characters.activeCount', '활성 캐릭터 {{count}}명', { count: enabledCount })
                            : t('guided.characters.emptyHelp', '인물이 여러 명일 때 외형을 따로 지정할 수 있어요.')}
                    </span>
                </span>
                <SheetTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" disabled={disabled} className="shrink-0">
                        {value.items.length > 0
                            ? t('guided.characters.edit', '편집')
                            : t('guided.characters.add', '추가')}
                    </Button>
                </SheetTrigger>
            </div>

            <SheetContent
                side="right"
                className="flex w-full flex-col overflow-hidden sm:max-w-xl"
                closeLabel={t('common.close', '닫기')}
                data-testid="guided-character-prompt-sheet"
            >
                <SheetHeader className="shrink-0 border-b border-border/70 pb-4">
                    <SheetTitle className="text-xl">{t('guided.characters.title', '캐릭터 프롬프트')}</SheetTitle>
                    <SheetDescription className="leading-6">
                        {t('guided.characters.description', '현재 작업에만 적용할 캐릭터의 외형과 제외 요소를 정하세요.')}
                    </SheetDescription>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {value.items.length === 0 ? (
                        <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                            <Users className="h-8 w-8 text-muted-foreground/45" aria-hidden="true" />
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                                {t('guided.characters.empty', '아직 캐릭터 프롬프트가 없어요.')}
                            </p>
                            <Button type="button" variant="outline" className="mt-4" onClick={addCharacter} disabled={disabled}>
                                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                                {t('guided.characters.addFirst', '첫 캐릭터 추가')}
                            </Button>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/70 border-b border-border/70">
                            {value.items.map((character, index) => {
                                const invalid = character.enabled && !hasPrompt(character.prompt)
                                return (
                                    <section key={character.id} className="py-5" aria-label={character.name || t('guided.characters.unnamed', '캐릭터 {{index}}', { index: index + 1 })}>
                                        <div className="flex items-center gap-2">
                                            <label className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
                                                <span className="sr-only">{t('guided.characters.name', '캐릭터 이름')}</span>
                                                <Input
                                                    value={character.name ?? ''}
                                                    onChange={event => updateCharacter(character.id, {
                                                        name: event.target.value || undefined,
                                                    })}
                                                    disabled={disabled}
                                                    placeholder={t('guided.characters.namePlaceholder', '캐릭터 이름 · 선택')}
                                                    className="h-11 text-base"
                                                />
                                            </label>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                disabled={disabled}
                                                onClick={() => updateCharacter(character.id, { enabled: !character.enabled })}
                                                aria-label={character.enabled
                                                    ? t('guided.characters.disable', '캐릭터 비활성화')
                                                    : t('guided.characters.enable', '캐릭터 활성화')}
                                            >
                                                {character.enabled
                                                    ? <Eye className="h-4 w-4 text-primary" aria-hidden="true" />
                                                    : <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                disabled={disabled}
                                                onClick={() => removeCharacter(character.id)}
                                                aria-label={t('guided.characters.remove', '캐릭터 삭제')}
                                                className="text-muted-foreground hover:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                                            </Button>
                                        </div>

                                        <label className="mt-4 block text-sm font-semibold">
                                            {t('guided.characters.positive', '외형 프롬프트')}
                                            <span className="mt-2 block h-40">
                                                <AutocompleteTextarea
                                                    value={character.prompt}
                                                    onChange={event => updateCharacter(character.id, { prompt: event.target.value })}
                                                    disabled={disabled}
                                                    placeholder={t('guided.characters.positivePlaceholder', '예: 1girl, silver hair, blue eyes')}
                                                    ariaLabel={t('guided.characters.positive', '외형 프롬프트')}
                                                    maxSuggestions={8}
                                                    className="bg-card text-base"
                                                />
                                            </span>
                                        </label>
                                        {invalid && (
                                            <p className="mt-2 text-xs leading-5 text-destructive" role="alert">
                                                {t('guided.characters.promptRequired', '활성 캐릭터에는 외형 프롬프트가 필요해요.')}
                                            </p>
                                        )}

                                        <details className="mt-4 border-t border-border/55 pt-3">
                                            <summary className="cursor-pointer text-sm font-medium">
                                                {t('guided.characters.negative', '제외할 요소 · 선택')}
                                            </summary>
                                            <Textarea
                                                value={character.negative}
                                                onChange={event => updateCharacter(character.id, { negative: event.target.value })}
                                                disabled={disabled}
                                                className="mt-3 min-h-28 bg-card text-base"
                                                placeholder={t('guided.characters.negativePlaceholder', '예: alternate costume, different hairstyle')}
                                            />
                                        </details>
                                    </section>
                                )
                            })}
                        </div>
                    )}
                </div>

                {value.items.length > 0 && (
                    <div className="shrink-0 border-t border-border/70 pt-4">
                        <Button type="button" variant="outline" className="w-full" onClick={addCharacter} disabled={disabled}>
                            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                            {t('guided.characters.addAnother', '캐릭터 추가')}
                        </Button>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    )
}
