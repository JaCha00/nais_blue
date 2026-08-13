import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { GenerationFolderPicker } from '@/components/generation-folders/GenerationFolderPicker'
import { Input } from '@/components/ui/input'
import type { SingleImageOutputSettings } from '@/domain/workflow/single-image-draft'
import { outputPatchFromGenerationFolder } from './generation-folder-selection'

export function GuidedOutputDestinationStep({
    value,
    disabled,
    onChange,
}: {
    value: SingleImageOutputSettings
    disabled: boolean
    onChange(patch: Partial<SingleImageOutputSettings>): void
}) {
    const { t } = useTranslation()
    const directoryId = useId()
    const formatId = useId()
    const [directory, setDirectory] = useState(value.directory)

    useEffect(() => setDirectory(value.directory), [value.directory])

    const commitDirectory = () => {
        const next = directory.trim()
        if (next.length === 0) {
            setDirectory(value.directory)
            return
        }
        if (next !== value.directory) onChange({ directory: next })
    }

    return (
        <div className="divide-y divide-border/70 border-y border-border/70">
            <section className="py-5" aria-labelledby={`${directoryId}-heading`}>
                <h2 id={`${directoryId}-heading`} className="text-sm font-semibold">
                    {t('guided.output.folderTitle', '저장 폴더')}
                </h2>
                <p className="mt-1 max-w-[58ch] text-xs leading-5 text-muted-foreground">
                    {t('guided.output.folderHelp', '폴더별 저장 위치와 R2 대상을 함께 불러옵니다. 필요하면 이번 작업에서 다른 폴더를 고르세요.')}
                </p>
                <div className="mt-4">
                    <GenerationFolderPicker
                        value={value.generationFolderId}
                        disabled={disabled}
                        allowManual
                        onChange={selection => onChange(outputPatchFromGenerationFolder(
                            selection,
                            value.metadataMode,
                        ))}
                    />
                </div>
                {value.generationFolderId == null && (
                    <label className="mt-4 grid gap-1.5 text-xs font-medium" htmlFor={directoryId}>
                        {t('guided.output.manualPath', '직접 입력 저장 경로')}
                        <Input
                            id={directoryId}
                            value={directory}
                            disabled={disabled}
                            onChange={event => setDirectory(event.target.value)}
                            onBlur={commitDirectory}
                            onKeyDown={event => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                            }}
                        />
                    </label>
                )}
            </section>

            <label className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center" htmlFor={formatId}>
                <span>
                    <span className="block text-sm font-semibold">
                        {t('guided.output.formatTitle', '이미지 형식')}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {t('guided.output.formatHelp', 'PNG는 호환성이 좋고, WebP는 파일 크기를 줄이기 좋아요.')}
                    </span>
                </span>
                <select
                    id={formatId}
                    value={value.imageFormat}
                    disabled={disabled}
                    onChange={event => onChange({
                        imageFormat: event.target.value as SingleImageOutputSettings['imageFormat'],
                    })}
                    className="min-h-11 w-full border-x-0 border-y border-input bg-background px-3 text-sm focus:border-primary focus:outline-none"
                >
                    <option value="png">PNG</option>
                    <option value="webp">WebP</option>
                </select>
            </label>
        </div>
    )
}
