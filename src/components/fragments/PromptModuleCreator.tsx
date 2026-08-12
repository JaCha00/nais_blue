import { useEffect, useState } from 'react'
import { FolderPlus, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
    FragmentSequenceMutationLockedError,
    getFragmentCanonicalPath,
    normalizeFragmentPath,
    useFragmentStore,
} from '@/stores/fragment-store'

export interface PromptModuleCreatorProps {
    sourceText?: string
    suggestedName?: string
    triggerLabel?: string
    disabled?: boolean
    open?: boolean
    onOpenChange?(open: boolean): void
    hideTrigger?: boolean
    onCreated?(canonicalPath: string): void
}

export function promptModuleLines(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
}

export function promptModuleSourceLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function safeSuggestedName(value: string | undefined): string {
    const candidate = (value ?? '')
        .replace(/\.(?:nai-blue|nais2)\.json$/i, '')
        .replace(/\.[^.]+$/, '')
        .replace(/[\\/<>*]/g, '-')
        .trim()
    return candidate || `module_${new Date().toISOString().slice(0, 10)}`
}

export function PromptModuleCreator({
    sourceText = '',
    suggestedName,
    triggerLabel,
    disabled = false,
    open: controlledOpen,
    onOpenChange,
    hideTrigger = false,
    onCreated,
}: PromptModuleCreatorProps) {
    const { t } = useTranslation()
    const addFile = useFragmentStore(state => state.addFile)
    const [internalOpen, setInternalOpen] = useState(false)
    const [name, setName] = useState('')
    const [folder, setFolder] = useState('')
    const [content, setContent] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const open = controlledOpen ?? internalOpen
    const handleOpenChange = (nextOpen: boolean) => {
        setInternalOpen(nextOpen)
        onOpenChange?.(nextOpen)
    }

    useEffect(() => {
        if (!open) return
        setName(safeSuggestedName(suggestedName))
        setFolder('')
        setContent(promptModuleSourceLine(sourceText))
        setError(null)
    }, [open, sourceText, suggestedName])

    const save = async () => {
        const normalizedName = name.trim()
        const normalizedFolder = normalizeFragmentPath(folder)
        const lines = promptModuleLines(content)
        if (!normalizedName || /[\\/<>*]/.test(normalizedName)) {
            setError(t('guided.promptModules.create.invalidName', '이름에는 /, \\, <, >, * 문자를 사용할 수 없어요.'))
            return
        }
        if (lines.length === 0) {
            setError(t('guided.promptModules.create.emptyContent', '한 줄 이상의 프롬프트를 입력해 주세요.'))
            return
        }
        const path = normalizeFragmentPath(normalizedFolder ? `${normalizedFolder}/${normalizedName}` : normalizedName)
        const duplicate = useFragmentStore.getState().files.some(file => (
            getFragmentCanonicalPath(file).toLocaleLowerCase() === path.toLocaleLowerCase()
        ))
        if (duplicate) {
            setError(t('guided.promptModules.create.duplicate', '같은 폴더에 같은 이름의 모듈이 이미 있어요.'))
            return
        }

        setSaving(true)
        setError(null)
        try {
            const created = await addFile(normalizedName, normalizedFolder, lines)
            onCreated?.(getFragmentCanonicalPath(created))
            handleOpenChange(false)
        } catch (saveError) {
            setError(saveError instanceof FragmentSequenceMutationLockedError
                ? t('guided.promptModules.edit.locked', '순차 모듈을 사용하는 작업이 끝난 뒤 다시 편집해 주세요.')
                : t('guided.promptModules.create.failed', '모듈을 저장하지 못했어요. 다시 시도해 주세요.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {!hideTrigger && (
                <DialogTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" disabled={disabled} className="gap-2 rounded-none border-b border-border/70 px-1 text-sm text-muted-foreground hover:border-primary hover:bg-primary/[0.045] hover:text-foreground">
                        <FolderPlus className="h-4 w-4" aria-hidden="true" />
                        {triggerLabel ?? t('guided.promptModules.create.trigger', '새 모듈 만들기')}
                    </Button>
                </DialogTrigger>
            )}
            <DialogContent className="max-w-xl p-4 sm:p-6">
                <DialogHeader className="pr-10 text-left">
                    <DialogTitle className="text-xl">{t('guided.promptModules.create.title', '프롬프트 모듈 만들기')}</DialogTitle>
                    <DialogDescription className="text-base leading-6">
                        {t('guided.promptModules.create.description', '한 줄이 하나의 후보예요. 여러 줄을 적으면 무작위 또는 순차 생성에서 한 줄씩 사용합니다.')}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 border-y border-border/70 py-5 sm:grid-cols-2">
                    <label className="text-sm font-semibold">
                        {t('guided.promptModules.create.folder', '폴더 · 선택')}
                        <Input value={folder} onChange={event => setFolder(event.target.value)} className="mt-2 text-base" placeholder={t('guided.promptModules.create.folderPlaceholder', '예: characters/hair')} />
                    </label>
                    <label className="text-sm font-semibold">
                        {t('guided.promptModules.create.name', '모듈 이름')}
                        <Input value={name} onChange={event => setName(event.target.value)} className="mt-2 text-base" placeholder={t('guided.promptModules.create.namePlaceholder', '예: hair_colors')} />
                    </label>
                    <label className="text-sm font-semibold sm:col-span-2">
                        {t('guided.promptModules.create.lines', '후보 프롬프트 · 한 줄에 하나')}
                        <Textarea value={content} onChange={event => setContent(event.target.value)} className="mt-2 min-h-40 text-base leading-6" placeholder={t('guided.promptModules.create.linesPlaceholder', 'silver hair\nblue hair\npink hair')} />
                    </label>
                </div>
                {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>{t('guided.promptModules.create.cancel', '취소')}</Button>
                    <Button type="button" onClick={() => void save()} disabled={saving}>
                        {saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {t('guided.promptModules.create.save', '모듈 저장')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
