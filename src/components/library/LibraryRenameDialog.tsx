
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
    renderLibraryRenameStem,
    type LibraryRenameItem,
} from '@/services/library/library-file-renamer'

interface LibraryRenameDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    items: readonly LibraryRenameItem[]
    onConfirm: (template: string) => boolean | Promise<boolean>
}

export function LibraryRenameDialog({
    open,
    onOpenChange,
    items,
    onConfirm,
}: LibraryRenameDialogProps) {
    const { t } = useTranslation()
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    const batch = items.length > 1

    useEffect(() => {
        if (!open) return
        setName(batch ? '{name}_{index:000}' : items[0]?.name ?? '')
        setBusy(false)
    }, [batch, items, open])

    const handleConfirm = async () => {
        if (!name.trim() || busy) return
        setBusy(true)
        try {
            if (await onConfirm(name.trim())) onOpenChange(false)
        } finally {
            setBusy(false)
        }
    }

    const preview = items.slice(0, 4).map((item, index) => ({
        id: item.id,
        before: item.name,
        after: renderLibraryRenameStem(name, item, index, items.length),
    }))

    return (
        <Dialog open={open} onOpenChange={nextOpen => !busy && onOpenChange(nextOpen)}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {batch
                            ? t('library.rename.batchTitle', '{{count}}개 파일 이름 변경', { count: items.length })
                            : t('actions.rename', '이름 변경')}
                    </DialogTitle>
                    <DialogDescription>
                        {batch
                            ? t('library.rename.batchDesc', '규칙을 확인한 뒤 선택한 이미지에 순서대로 적용합니다.')
                            : t('library.rename.singleDesc', '실제 이미지 파일과 연결된 sidecar 이름도 함께 변경합니다.')}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                    <label className="grid gap-2 text-sm font-medium">
                        {batch ? t('library.rename.patternLabel', '이름 규칙') : t('library.rename.nameLabel', '새 파일 이름')}
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleConfirm()
                            }}
                            disabled={busy}
                            autoComplete="off"
                            autoFocus
                        />
                    </label>
                    {batch && (
                        <p className="font-mono text-xs leading-5 text-muted-foreground">
                            {t('library.rename.tokens', '사용 가능: {name}, {index}, {index:000}, {datetime:YYYYMMDD}')}
                        </p>
                    )}
                    <div className="rounded-panel border border-border/70 bg-muted/30 p-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">{t('library.rename.preview', '미리보기')}</p>
                        <div className="grid gap-1.5 text-xs">
                            {preview.map(item => (
                                <div key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                                    <span className="truncate text-muted-foreground" title={item.before}>{item.before}</span>
                                    <span aria-hidden="true">→</span>
                                    <span className="truncate font-medium" title={item.after}>{item.after}</span>
                                </div>
                            ))}
                            {items.length > preview.length && (
                                <p className="pt-1 text-muted-foreground">+{items.length - preview.length}</p>
                            )}
                        </div>
                    </div>
                    <div className="space-y-1 text-xs leading-5 text-muted-foreground">
                        <p>{t('library.rename.extensionKept', '파일 확장자는 유지되며, 중복 이름에는 -2가 자동으로 붙습니다.')}</p>
                        <p>{t('library.rename.r2Unchanged', '이미 업로드된 R2 파일 이름은 바뀌지 않습니다.')}</p>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                        {t('common.cancel', '취소')}
                    </Button>
                    <Button disabled={busy || !name.trim()} onClick={() => void handleConfirm()}>
                        {busy ? t('common.processing', '처리 중') : t('library.rename.apply', '이름 변경')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
