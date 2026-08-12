import { useMemo, useState } from 'react'
import { FolderCog, HardDrive, UploadCloud } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
    DEFAULT_GENERATION_FOLDER_ID,
    resolveGenerationFolder,
    type GenerationFolderSelection,
    type GenerationFolder,
} from '@/domain/generation-folders'
import { useDefaultR2Readiness } from '@/hooks/useDefaultR2Readiness'
import { useSettingsStore } from '@/stores/settings-store'
import { GenerationFolderManagerDialog } from './GenerationFolderManagerDialog'

function orderedFolders(folders: readonly GenerationFolder[]): Array<{ folder: GenerationFolder; depth: number }> {
    const result: Array<{ folder: GenerationFolder; depth: number }> = []
    const append = (parentId: string | null, depth: number) => {
        folders.filter(folder => folder.parentId === parentId).forEach(folder => {
            result.push({ folder, depth })
            append(folder.id, depth + 1)
        })
    }
    append(null, 0)
    return result
}

export function GenerationFolderPicker({
    value,
    disabled = false,
    allowManual = false,
    onChange,
}: {
    value: string | null | undefined
    disabled?: boolean
    allowManual?: boolean
    onChange(selection: GenerationFolderSelection | null): void
}) {
    const { t } = useTranslation()
    const folders = useSettingsStore(state => state.generationFolders)
    const savePath = useSettingsStore(state => state.savePath)
    const useAbsolutePath = useSettingsStore(state => state.useAbsolutePath)
    const r2State = useDefaultR2Readiness()
    const [managerOpen, setManagerOpen] = useState(false)
    const rows = useMemo(() => orderedFolders(folders), [folders])
    const resolved = resolveGenerationFolder(folders, value, {
        directory: savePath,
        useAbsolutePath,
        r2Bucket: r2State.profile?.bucket,
        r2Prefix: r2State.profile?.prefix,
    })

    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <select
                    value={value ?? ''}
                    disabled={disabled}
                    onChange={event => {
                        const id = event.target.value
                        if (!id) return onChange(null)
                        const folder = resolveGenerationFolder(folders, id, {
                            directory: savePath,
                            useAbsolutePath,
                            r2Bucket: r2State.profile?.bucket,
                            r2Prefix: r2State.profile?.prefix,
                        })
                        if (folder) onChange({ folder, r2Ready: r2State.status === 'ready' })
                    }}
                    className="min-h-11 min-w-0 flex-1 border-x-0 border-y border-input bg-background px-3 text-sm"
                    aria-label={t('generationFolders.pickerLabel', '이미지 생성 폴더')}
                >
                    {allowManual && <option value="">{t('generationFolders.manualPath', '직접 입력 경로 사용')}</option>}
                    {rows.map(row => (
                        <option key={row.folder.id} value={row.folder.id}>
                            {'— '.repeat(row.depth)}{row.folder.id === DEFAULT_GENERATION_FOLDER_ID && row.folder.name === '기본 출력'
                                ? t('generationFolders.defaultName', '기본 출력')
                                : row.folder.name}
                        </option>
                    ))}
                </select>
                <Button type="button" variant="outline" size="icon" aria-label={t('generationFolders.manage', '생성 폴더 관리')} onClick={() => setManagerOpen(true)} disabled={disabled}>
                    <FolderCog className="h-4 w-4" />
                </Button>
            </div>
            {resolved && (
                <div className="grid gap-1 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
                    <span className="flex min-w-0 items-start gap-1.5"><HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="truncate" title={resolved.directory}>{resolved.directory}</span></span>
                    <span className={`flex min-w-0 items-start gap-1.5 ${resolved.r2.autoUpload && r2State.status !== 'ready' ? 'opacity-55' : ''}`}>
                        <UploadCloud className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {resolved.r2.autoUpload
                            ? r2State.status === 'ready'
                                ? <span className="truncate" title={`${resolved.r2.bucket}/${resolved.r2.prefix}`}>{resolved.r2.bucket}/{resolved.r2.prefix}</span>
                                : <span>{t('generationFolders.r2NeedsSetup', 'R2 설정 필요')}</span>
                            : <span>{t('generationFolders.noAutoUpload', '자동 업로드 안 함')}</span>}
                    </span>
                </div>
            )}
            <GenerationFolderManagerDialog
                open={managerOpen}
                r2State={r2State}
                onOpenChange={nextOpen => {
                    setManagerOpen(nextOpen)
                    if (!nextOpen) {
                        if (resolved) onChange({ folder: resolved, r2Ready: r2State.status === 'ready' })
                        else if (value) onChange(null)
                    }
                }}
            />
        </div>
    )
}
