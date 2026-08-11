import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { promptModuleLines } from '@/components/fragments/PromptModuleCreator'
import {
    FragmentSequenceMutationLockedError,
    getFragmentCanonicalPath,
    useFragmentStore,
    type FragmentFileMeta,
} from '@/stores/fragment-store'

interface PromptModuleContentEditorProps {
    file: FragmentFileMeta | null
    open: boolean
    onOpenChange(open: boolean): void
    onSaved?(lines: readonly string[]): void
}

export function PromptModuleContentEditor({
    file,
    open,
    onOpenChange,
    onSaved,
}: PromptModuleContentEditorProps) {
    const { t } = useTranslation()
    const loadFileContent = useFragmentStore(state => state.loadFileContent)
    const updateFile = useFragmentStore(state => state.updateFile)
    const [content, setContent] = useState('')
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open || file === null) return
        let active = true
        setLoading(true)
        setError(null)
        void loadFileContent(file.id).then(lines => {
            if (active) setContent(lines.join('\n'))
        }).catch(() => {
            if (active) setError(t('guided.promptModules.edit.loadFailed', '모듈 내용을 불러오지 못했어요.'))
        }).finally(() => {
            if (active) setLoading(false)
        })
        return () => { active = false }
    }, [file, loadFileContent, open, t])

    const save = async () => {
        if (file === null) return
        const lines = promptModuleLines(content)
        if (lines.length === 0) {
            setError(t('guided.promptModules.create.emptyContent', '한 줄 이상의 프롬프트를 입력해 주세요.'))
            return
        }
        setSaving(true)
        setError(null)
        try {
            await updateFile(file.id, { content: lines })
            onSaved?.(lines)
            onOpenChange(false)
        } catch (saveError) {
            setError(saveError instanceof FragmentSequenceMutationLockedError
                ? t('guided.promptModules.edit.locked', '순차 모듈을 사용하는 작업이 끝난 뒤 다시 편집해 주세요.')
                : t('guided.promptModules.edit.failed', '모듈을 저장하지 못했어요. 다시 시도해 주세요.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl p-4 sm:p-6">
                <DialogHeader className="pr-10 text-left">
                    <DialogTitle className="text-xl">{t('guided.promptModules.edit.title', '프롬프트 모듈 편집')}</DialogTitle>
                    <DialogDescription className="break-words text-base leading-6 [overflow-wrap:anywhere]">
                        {file === null ? '' : getFragmentCanonicalPath(file)}
                    </DialogDescription>
                </DialogHeader>
                <div className="border-y border-border/70 py-5">
                    <label className="text-sm font-semibold">
                        {t('guided.promptModules.create.lines', '후보 프롬프트 · 한 줄에 하나')}
                        <Textarea
                            value={content}
                            onChange={event => setContent(event.target.value)}
                            disabled={loading || saving}
                            className="mt-2 min-h-64 text-base leading-6"
                            placeholder={t('guided.promptModules.create.linesPlaceholder', 'silver hair\nblue hair\npink hair')}
                        />
                    </label>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                    {t('guided.promptModules.edit.sharedNotice', '이 변경은 이 모듈을 다음에 사용하는 다른 작업에도 적용됩니다.')}
                </p>
                {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        {t('guided.promptModules.create.cancel', '취소')}
                    </Button>
                    <Button type="button" onClick={() => void save()} disabled={loading || saving || file === null}>
                        {(loading || saving) && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {t('guided.promptModules.edit.save', '변경 저장')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
