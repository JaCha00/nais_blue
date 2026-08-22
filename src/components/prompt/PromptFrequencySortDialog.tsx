import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownWideNarrow, Loader2, RotateCcw, TriangleAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
    collectPromptFrequencySortTokens,
    sortPromptByFrequency,
    type PromptFrequencySortResult,
} from '@/lib/prompt-frequency-sort'
import { lookupDanbooruTagFrequencies } from '@/services/danbooru-tag-verifier'

interface PromptFrequencySortDialogProps {
    open: boolean
    source: string
    onOpenChange: (open: boolean) => void
    onApply: (sorted: string) => void
}

interface SortPreview extends PromptFrequencySortResult {
    sourceLabel: string
    asOf: string | null
    fallbackCount: number
}

/**
 * Runs the shared Danbooru lookup without mutating the prompt, then exposes a
 * before/after gate. PromptEditorSurface remains the owner of applying and
 * undoing the accepted edit, so cancelling this dialog is always lossless.
 */
export function PromptFrequencySortDialog({
    open,
    source,
    onOpenChange,
    onApply,
}: PromptFrequencySortDialogProps) {
    const { t } = useTranslation()
    const [preview, setPreview] = useState<SortPreview | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return

        let cancelled = false
        const run = async () => {
            setPreview(null)
            setError(null)
            setIsLoading(false)
            const tokens = collectPromptFrequencySortTokens(source)
            if (tokens.length < 2) {
                setError(t(
                    'promptFrequencySort.notEnoughTags',
                    '정렬하려면 쉼표로 구분된 태그가 두 개 이상 필요합니다.',
                ))
                return
            }

            setIsLoading(true)
            try {
                const lookup = await lookupDanbooruTagFrequencies(tokens)
                if (cancelled) return
                setPreview({
                    ...sortPromptByFrequency(source, lookup.frequencies),
                    sourceLabel: lookup.source,
                    asOf: lookup.asOf,
                    fallbackCount: lookup.fallbackCount,
                })
            } catch (lookupError) {
                if (!cancelled) {
                    setError(lookupError instanceof Error ? lookupError.message : String(lookupError))
                }
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }

        void run()
        return () => {
            cancelled = true
        }
    }, [open, source, t])

    const applyPreview = () => {
        if (!preview?.changed) return
        onApply(preview.text)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-2rem)] min-h-0 w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowDownWideNarrow className="h-5 w-5 text-primary" />
                        {t('promptFrequencySort.title', 'Danbooru 빈도 정렬')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'promptFrequencySort.description',
                            '정식 태그를 게시글 수가 적은 순서부터 안정 정렬합니다. 게시글 수는 NAI 학습량이 아닌 재현 강도 참고값입니다.',
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {isLoading && (
                        <div
                            role="status"
                            aria-live="polite"
                            className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
                        >
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t('promptFrequencySort.loading', 'Danbooru 태그 빈도를 확인하는 중입니다.')}
                        </div>
                    )}

                    {error && !isLoading && (
                        <div
                            role="alert"
                            className="flex gap-2 rounded-control border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                        >
                            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {preview && !isLoading && (
                        <>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline">
                                    {t('promptFrequencySort.sortableCount', '조회 {{count}}개', { count: preview.sortableCount })}
                                </Badge>
                                <Badge variant="outline">
                                    {t('promptFrequencySort.movedCount', '이동 {{count}}개', { count: preview.movedCount })}
                                </Badge>
                                {preview.unresolvedCount > 0 && (
                                    <Badge variant="outline" className="text-warning">
                                        {t('promptFrequencySort.unresolvedCount', '미등록·실패 {{count}}개', { count: preview.unresolvedCount })}
                                    </Badge>
                                )}
                                <span className="ml-auto break-all text-right">
                                    {preview.sourceLabel}
                                    {preview.asOf ? ` · ${formatLookupTime(preview.asOf)}` : ''}
                                </span>
                            </div>

                            {preview.fallbackCount > 0 && (
                                <p className="rounded-control bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                                    {t(
                                        'promptFrequencySort.fallback',
                                        '실조회하지 못한 {{count}}개 태그는 번들 스냅샷으로 보완했습니다.',
                                        { count: preview.fallbackCount },
                                    )}
                                </p>
                            )}

                            {preview.diagnostics.length > 0 && (
                                <div className="rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                                    {preview.diagnostics.map((diagnostic, index) => (
                                        <p key={`${diagnostic}-${index}`}>{diagnostic}</p>
                                    ))}
                                </div>
                            )}

                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="space-y-1.5 text-sm font-medium">
                                    {t('promptFrequencySort.original', '원래 순서')}
                                    <Textarea
                                        value={source}
                                        readOnly
                                        className="mt-1.5 h-52 resize-none font-mono text-xs leading-5"
                                    />
                                </label>
                                <label className="space-y-1.5 text-sm font-medium">
                                    {t('promptFrequencySort.sorted', '정렬 순서')}
                                    <Textarea
                                        value={preview.text}
                                        readOnly
                                        className="mt-1.5 h-52 resize-none font-mono text-xs leading-5"
                                    />
                                </label>
                            </div>

                            {!preview.changed && (
                                <div className="flex items-center gap-2 rounded-control bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                                    <RotateCcw className="h-4 w-4" />
                                    {t('promptFrequencySort.alreadySorted', '이미 이 기준으로 정렬되어 있습니다.')}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:space-x-0">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t('common.cancel', '취소')}
                    </Button>
                    <Button type="button" onClick={applyPreview} disabled={!preview?.changed || isLoading}>
                        <ArrowDownWideNarrow className="mr-1 h-4 w-4" />
                        {t('promptFrequencySort.apply', '정렬 적용')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function formatLookupTime(value: string): string {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}
