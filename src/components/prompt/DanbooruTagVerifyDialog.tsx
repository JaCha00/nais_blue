import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    AlertTriangle,
    CheckCircle2,
    Circle,
    Loader2,
    RefreshCw,
    ShieldCheck,
    XCircle,
} from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
    verifyPromptTagsWithDanbooru,
    type DanbooruSuggestion,
    type DanbooruTagResult,
    type DanbooruTagStatus,
} from '@/services/danbooru-tag-verifier'

interface DanbooruTagVerifyDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    prompt: string
    onApply: (prompt: string) => void
}

type Summary = Record<DanbooruTagStatus, number>

const INITIAL_SUMMARY: Summary = {
    OK: 0,
    LOW: 0,
    GHOST: 0,
    ERROR: 0,
    SKIPPED: 0,
}

const STATUS_ORDER: DanbooruTagStatus[] = ['OK', 'LOW', 'GHOST', 'ERROR']

export function DanbooruTagVerifyDialog({
    open,
    onOpenChange,
    prompt,
    onApply,
}: DanbooruTagVerifyDialogProps) {
    const { t } = useTranslation()
    const [editedPrompt, setEditedPrompt] = useState(prompt)
    const [results, setResults] = useState<DanbooruTagResult[]>([])
    const [isVerifying, setIsVerifying] = useState(false)
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return

        setEditedPrompt(prompt)
        setResults([])
        setError(null)
        setProgress(0)

        if (prompt.trim()) {
            void runVerification(prompt)
        }
    }, [open, prompt])

    const summary = useMemo(() => {
        return results.reduce<Summary>((counts, result) => {
            counts[result.status] += 1
            return counts
        }, { ...INITIAL_SUMMARY })
    }, [results])

    const visibleResults = useMemo(() => {
        return results.filter((result) => result.status !== 'SKIPPED')
    }, [results])

    const runVerification = async (sourcePrompt = editedPrompt) => {
        if (!sourcePrompt.trim()) {
            setResults([])
            setError(null)
            setProgress(0)
            return
        }

        setIsVerifying(true)
        setError(null)
        setProgress(8)

        const progressTimer = window.setInterval(() => {
            setProgress((current) => Math.min(current + 7, 86))
        }, 500)

        try {
            const response = await verifyPromptTagsWithDanbooru(sourcePrompt)
            setResults(response.results)
            setProgress(100)
        } catch (verifyError) {
            setResults([])
            setError(getErrorMessage(verifyError))
            setProgress(100)
        } finally {
            window.clearInterval(progressTimer)
            setIsVerifying(false)
        }
    }

    const applySuggestion = (result: DanbooruTagResult, suggestion: DanbooruSuggestion) => {
        setEditedPrompt((current) => replacePromptToken(current, result.raw, suggestion.name))
    }

    const handleApply = () => {
        onApply(editedPrompt)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-2rem)] min-h-0 w-[calc(100vw-2rem)] flex-col gap-4 overflow-hidden p-4 sm:max-w-3xl sm:p-6">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                        {t('danbooruVerify.title', 'Danbooru 태그 실검증')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('danbooruVerify.description', '로컬 Python sidecar가 Danbooru post count를 확인하고 빈 태그에는 대체 후보를 제안합니다.')}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                <span>
                                    {isVerifying
                                        ? t('danbooruVerify.verifying', '검증 중')
                                        : results.length > 0
                                            ? t('danbooruVerify.complete', '검증 완료')
                                            : t('danbooruVerify.waiting', '대기 중')}
                                </span>
                                <span>{progress}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {STATUS_ORDER.map((status) => (
                                <Badge
                                    key={status}
                                    variant="outline"
                                    className={cn('gap-1 border-border/60 bg-muted/20', getStatusTextClass(status))}
                                >
                                    {getStatusIcon(status)}
                                    {status} {summary[status]}
                                </Badge>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
                        <div className="min-h-0 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-sm font-medium">
                                    {t('danbooruVerify.results', '검증 결과')}
                                </h3>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void runVerification()}
                                    disabled={isVerifying || !editedPrompt.trim()}
                                    className="h-7 px-2"
                                >
                                    {isVerifying ? (
                                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                    )}
                                    {t('danbooruVerify.retry', '다시 검증')}
                                </Button>
                            </div>

                            <ScrollArea className="h-72 rounded-lg border border-border/60 bg-card/40 md:h-80">
                                <div className="space-y-2 p-2">
                                    {isVerifying && visibleResults.length === 0 ? (
                                        <div className="flex h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            {t('danbooruVerify.loading', 'Danbooru 응답을 기다리는 중')}
                                        </div>
                                    ) : error ? (
                                        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                                            {error}
                                        </div>
                                    ) : visibleResults.length === 0 ? (
                                        <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
                                            {t('danbooruVerify.empty', '검증할 태그가 없습니다.')}
                                        </div>
                                    ) : (
                                        visibleResults.map((result, index) => (
                                            <ResultRow
                                                key={`${result.raw}-${index}`}
                                                result={result}
                                                onSelectSuggestion={applySuggestion}
                                            />
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        <div className="min-h-0 space-y-2">
                            <h3 className="text-sm font-medium">
                                {t('danbooruVerify.preview', '반영 프롬프트')}
                            </h3>
                            <Textarea
                                value={editedPrompt}
                                onChange={(event) => setEditedPrompt(event.target.value)}
                                className="h-40 resize-none font-mono text-xs leading-5 md:h-80"
                                placeholder={t('danbooruVerify.previewPlaceholder', '검증할 프롬프트')}
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:space-x-0">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t('common.cancel', '취소')}
                    </Button>
                    <Button type="button" onClick={handleApply} disabled={!editedPrompt.trim() || isVerifying}>
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        {t('danbooruVerify.apply', '변경사항 적용')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function ResultRow({
    result,
    onSelectSuggestion,
}: {
    result: DanbooruTagResult
    onSelectSuggestion: (result: DanbooruTagResult, suggestion: DanbooruSuggestion) => void
}) {
    return (
        <div className={cn('rounded-lg border p-2', getStatusContainerClass(result.status))}>
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn('gap-1 bg-background/60', getStatusTextClass(result.status))}>
                    {getStatusIcon(result.status)}
                    {result.status}
                </Badge>
                <span className="font-mono text-xs text-foreground">{result.raw}</span>
                {result.normalized && result.normalized !== result.raw && (
                    <span className="font-mono text-xs text-muted-foreground">{result.normalized}</span>
                )}
                {typeof result.postCount === 'number' && (
                    <span className="ml-auto text-xs text-muted-foreground">
                        {result.postCount.toLocaleString()} posts
                    </span>
                )}
            </div>

            {result.status === 'GHOST' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {result.suggestions.length > 0 ? (
                        result.suggestions.map((suggestion) => (
                            <Button
                                key={`${result.raw}-${suggestion.name}`}
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-auto min-h-7 gap-1 px-2 py-1 text-xs whitespace-normal"
                                onClick={() => onSelectSuggestion(result, suggestion)}
                            >
                                <span className="font-mono">{suggestion.name}</span>
                                <span className="text-muted-foreground">
                                    {suggestion.postCount.toLocaleString()}
                                </span>
                            </Button>
                        ))
                    ) : (
                        <span className="text-xs text-muted-foreground">No suggestions</span>
                    )}
                </div>
            )}

            {result.status === 'ERROR' && result.error && (
                <p className="mt-2 text-xs text-destructive">{result.error}</p>
            )}
        </div>
    )
}

function getStatusIcon(status: DanbooruTagStatus) {
    switch (status) {
        case 'OK':
            return <CheckCircle2 className="h-3.5 w-3.5" />
        case 'LOW':
            return <AlertTriangle className="h-3.5 w-3.5" />
        case 'GHOST':
            return <XCircle className="h-3.5 w-3.5" />
        case 'ERROR':
            return <AlertTriangle className="h-3.5 w-3.5" />
        case 'SKIPPED':
            return <Circle className="h-3.5 w-3.5" />
    }
}

function getStatusTextClass(status: DanbooruTagStatus): string {
    switch (status) {
        case 'OK':
            return 'text-green-500'
        case 'LOW':
            return 'text-yellow-500'
        case 'GHOST':
            return 'text-red-500'
        case 'ERROR':
            return 'text-destructive'
        case 'SKIPPED':
            return 'text-muted-foreground'
    }
}

function getStatusContainerClass(status: DanbooruTagStatus): string {
    switch (status) {
        case 'OK':
            return 'border-green-500/40 bg-green-500/10'
        case 'LOW':
            return 'border-yellow-500/40 bg-yellow-500/10'
        case 'GHOST':
            return 'border-red-500/40 bg-red-500/10'
        case 'ERROR':
            return 'border-destructive/40 bg-destructive/10'
        case 'SKIPPED':
            return 'border-border/60 bg-muted/20 opacity-60'
    }
}

function replacePromptToken(prompt: string, rawTag: string, replacement: string): string {
    const escaped = escapeRegExp(rawTag.trim())
    if (!escaped) return prompt

    const tokenPattern = new RegExp(`(^|[,;\\n])(\\s*)${escaped}(\\s*)(?=,|;|\\n|$)`, 'g')
    const replaced = prompt.replace(tokenPattern, (_match, separator: string, leading: string, trailing: string) => {
        return `${separator}${leading}${replacement}${trailing}`
    })

    return replaced === prompt ? prompt.replace(rawTag, replacement) : replaced
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
