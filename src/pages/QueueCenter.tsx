import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Activity,
    AlertCircle,
    EllipsisVertical,
    Pause,
    Play,
    RotateCcw,
    SkipForward,
    XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type {
    GenerationBatch,
    GenerationBatchSummary,
    GenerationJobProjection,
    GenerationJobState,
    QueueFailurePolicy,
} from '@/domain/queue/types'
import { isTerminalJobState } from '@/domain/queue/state-machine'
import { calculateFixedVirtualRange } from '@/lib/virtualization/fixed-range'
import { cn } from '@/lib/utils'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { getRuntimeQueueRepository } from '@/services/queue/indexeddb-queue-repository'
import { getRuntimeDurableQueueCoordinator } from '@/services/queue/runtime'
import { enqueueCurrentSceneQueue } from '@/services/queue/scene-queue-adapter'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'
import { useQueueStore } from '@/stores/queue-store'
import { useSceneStore } from '@/stores/scene-store'

const QUEUE_ROW_HEIGHT = 96
const QUEUE_OVERSCAN = 5
const STATUS_FILTERS: readonly ('all' | GenerationJobState)[] = [
    'all', 'queued', 'leased', 'running', 'succeeded', 'failed',
    'cancelled', 'skipped', 'blocked', 'recovering',
]

function emptySummary(batchId: string): GenerationBatchSummary {
    return {
        batchId,
        total: 0,
        completed: 0,
        progressCurrent: 0,
        progressTotal: 0,
        states: {
            queued: 0, leased: 0, running: 0, succeeded: 0, failed: 0,
            cancelled: 0, skipped: 0, blocked: 0, recovering: 0,
        },
        recentCompletedAt: [],
    }
}

export function calculateQueueRate(summary: GenerationBatchSummary, nowMs: number): {
    throughput: number
    eta: number | null
} {
    const timestamps = summary.recentCompletedAt
        .map(value => Date.parse(value))
        .filter(value => Number.isFinite(value) && value <= nowMs)
    if (timestamps.length === 0) return { throughput: 0, eta: null }
    const oldest = Math.min(...timestamps)
    const windowMinutes = Math.max(1 / 60, Math.min(60, (nowMs - oldest) / 60_000))
    const throughput = Math.min(10_000, timestamps.length / windowMinutes)
    const remaining = Math.max(0, summary.total - summary.completed)
    const eta = throughput <= 0 ? null : Math.min(86_400, Math.ceil((remaining / throughput) * 60))
    return { throughput, eta }
}

function formatEta(seconds: number | null): string {
    if (seconds === null) return '—'
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3_600) return `${Math.ceil(seconds / 60)}m`
    return `${Math.ceil(seconds / 3_600)}h`
}

function retryIdentity(batchId: string): string {
    const safeBatch = batchId.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 96)
    return `retry-${safeBatch}`
}

export default function QueueCenter() {
    const { t } = useTranslation()
    const repository = useMemo(() => getRuntimeQueueRepository(), [])
    const coordinator = useMemo(() => getRuntimeDurableQueueCoordinator(), [])
    const executionAuthority = useQueueStore(state => state.executionAuthority)
    const selectedBatchId = useQueueStore(state => state.selectedBatchId)
    const setExecutionAuthority = useQueueStore(state => state.setExecutionAuthority)
    const setSelectedBatchId = useQueueStore(state => state.setSelectedBatchId)
    const legacyQueueCount = useSceneStore(state => {
        const activePreset = state.presets.find(preset => preset.id === state.activePresetId)
        return activePreset?.scenes.reduce((total, scene) => total + scene.queueCount, 0) ?? 0
    })
    const diagnostics = useDiagnosticsStore(state => state.events)
    const openDrawer = useDiagnosticsStore(state => state.openDrawer)
    const viewportRef = useRef<HTMLDivElement>(null)
    const refreshId = useRef(0)
    const [batches, setBatches] = useState<GenerationBatch[]>([])
    const [jobs, setJobs] = useState<GenerationJobProjection[]>([])
    const [summary, setSummary] = useState<GenerationBatchSummary | null>(null)
    const [statusFilter, setStatusFilter] = useState<'all' | GenerationJobState>('all')
    const [scrollTop, setScrollTop] = useState(0)
    const [viewportHeight, setViewportHeight] = useState(560)
    const [focusedIndex, setFocusedIndex] = useState(0)
    const [busy, setBusy] = useState(false)
    const [conversionOpen, setConversionOpen] = useState(false)

    const selectedBatch = batches.find(batch => batch.id === selectedBatchId) ?? null

    const refresh = useCallback(async () => {
        const requestId = ++refreshId.current
        try {
            const nextBatches = await repository.listBatches()
            if (requestId !== refreshId.current) return
            setBatches(nextBatches)
            const batchId = selectedBatchId !== null && nextBatches.some(batch => batch.id === selectedBatchId)
                ? selectedBatchId
                : nextBatches[0]?.id ?? null
            if (batchId !== selectedBatchId) setSelectedBatchId(batchId)
            if (batchId === null) {
                setJobs([])
                setSummary(null)
                return
            }
            const projections: GenerationJobProjection[] = []
            let cursor: string | null = null
            do {
                const page = await repository.listJobProjections({ batchId, cursor, limit: 500 })
                projections.push(...page.items)
                cursor = page.nextCursor
            } while (cursor !== null)
            const nextSummary = await repository.getBatchSummary(batchId)
            if (requestId !== refreshId.current) return
            setJobs(projections)
            setSummary(nextSummary)
        } catch (error) {
            reportDiagnostic(error, { operation: 'queue-center.refresh', stage: 'read', category: 'persistence' })
        }
    }, [repository, selectedBatchId, setSelectedBatchId])

    useEffect(() => {
        void refresh()
        const interval = window.setInterval(() => void refresh(), 1_000)
        return () => window.clearInterval(interval)
    }, [refresh])

    useEffect(() => {
        const viewport = viewportRef.current
        if (viewport === null) return
        const update = () => setViewportHeight(viewport.clientHeight || 560)
        update()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
        observer?.observe(viewport)
        return () => observer?.disconnect()
    }, [])

    const filteredJobs = useMemo(() => (
        statusFilter === 'all' ? jobs : jobs.filter(job => job.state === statusFilter)
    ), [jobs, statusFilter])
    useEffect(() => {
        setFocusedIndex(current => Math.max(0, Math.min(current, filteredJobs.length - 1)))
        const viewport = viewportRef.current
        if (viewport !== null) {
            const maximum = Math.max(0, filteredJobs.length * QUEUE_ROW_HEIGHT - viewport.clientHeight)
            if (viewport.scrollTop > maximum) viewport.scrollTo({ top: maximum, behavior: 'auto' })
        }
    }, [filteredJobs.length])
    const windowRange = useMemo(() => calculateFixedVirtualRange({
        itemCount: filteredJobs.length,
        scrollTop,
        viewportHeight,
        rowHeight: QUEUE_ROW_HEIGHT,
        overscan: QUEUE_OVERSCAN,
    }), [filteredJobs.length, scrollTop, viewportHeight])
    const rate = calculateQueueRate(summary ?? emptySummary(selectedBatchId ?? ''), Date.now())

    const runAction = async (action: () => Promise<unknown>) => {
        setBusy(true)
        try {
            await action()
            await refresh()
        } catch (error) {
            reportDiagnostic(error, { operation: 'queue-center.action', stage: 'mutate', category: 'persistence' })
        } finally {
            setBusy(false)
        }
    }

    const retryFailed = async () => {
        if (selectedBatch === null || !jobs.some(job => job.state === 'failed')) return
        const identity = retryIdentity(selectedBatch.id)
        await runAction(() => repository.retryFailedJobs({
            sourceBatchId: selectedBatch.id,
            targetBatch: {
                id: identity,
                workflow: selectedBatch.workflow,
                createdAt: new Date().toISOString(),
                failurePolicy: selectedBatch.failurePolicy,
                origin: 'retry',
                idempotencyKey: identity,
            },
        }))
    }

    const convertLegacyQueue = async () => {
        await runAction(async () => {
            const result = await enqueueCurrentSceneQueue()
            if (result !== null) setSelectedBatchId(result.batch.id)
        })
    }

    const focusRow = (index: number) => {
        const bounded = Math.max(0, Math.min(filteredJobs.length - 1, index))
        setFocusedIndex(bounded)
        viewportRef.current?.scrollTo({ top: bounded * QUEUE_ROW_HEIGHT, behavior: 'auto' })
        window.setTimeout(() => {
            viewportRef.current?.querySelector<HTMLElement>(`[data-queue-index="${bounded}"]`)?.focus()
        }, 0)
    }

    const handleRowKey = (event: React.KeyboardEvent, index: number) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            focusRow(index + 1)
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            focusRow(index - 1)
        } else if (event.key === 'Home') {
            event.preventDefault()
            focusRow(0)
        } else if (event.key === 'End') {
            event.preventDefault()
            focusRow(filteredJobs.length - 1)
        }
    }

    const showDiagnostic = (job: GenerationJobProjection) => {
        const eventId = job.lastDiagnosticEventId
        const isRecent = eventId !== null && diagnostics.some(event => event.eventId === eventId)
        openDrawer(isRecent ? eventId : undefined)
    }

    const visibleSummary = summary ?? emptySummary(selectedBatchId ?? '')
    const progressPercent = visibleSummary.total === 0
        ? 0
        : Math.round((visibleSummary.progressCurrent / Math.max(1, visibleSummary.progressTotal)) * 100)
    const failureCount = visibleSummary.states.failed + visibleSummary.states.blocked

    return (
        <main
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            data-testid="queue-center-ready"
        >
            <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold">{t('queue.title', 'Queue Center')}</h1>
                        <p className="text-xs text-muted-foreground">
                            {executionAuthority === 'durable' ? 'Durable execution' : 'Legacy rollback execution'}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-muted-foreground">
                            <span className="sr-only">Execution authority</span>
                            <select
                                value={executionAuthority}
                                onChange={event => setExecutionAuthority(event.target.value as 'durable' | 'legacy')}
                                className="min-h-11 rounded-control border border-input bg-canvas px-3 text-sm text-foreground"
                                aria-label="Execution authority"
                            >
                                <option value="durable">Durable</option>
                                <option value="legacy">Legacy rollback</option>
                            </select>
                        </label>
                        <select
                            value={selectedBatchId ?? ''}
                            onChange={event => setSelectedBatchId(event.target.value || null)}
                            className="min-h-11 max-w-56 rounded-control border border-input bg-canvas px-3 text-sm"
                            aria-label="Queue batch"
                        >
                            {batches.length === 0 && <option value="">No batches</option>}
                            {batches.map(batch => <option key={batch.id} value={batch.id}>{batch.id}</option>)}
                        </select>
                        <select
                            value={selectedBatch?.failurePolicy ?? 'continue'}
                            disabled={selectedBatch === null || busy}
                            onChange={event => {
                                if (selectedBatch === null) return
                                void runAction(() => repository.setBatchControl({
                                    batchId: selectedBatch.id,
                                    state: selectedBatch.state,
                                    now: new Date().toISOString(),
                                    reason: selectedBatch.pauseReason,
                                    failurePolicy: event.target.value as QueueFailurePolicy,
                                }))
                            }}
                            className="min-h-11 rounded-control border border-input bg-canvas px-3 text-sm"
                            aria-label="Failure policy"
                        >
                            <option value="continue">continue</option>
                            <option value="pause-on-fatal">pause-on-fatal</option>
                            <option value="stop-on-first-error">stop-on-first-error</option>
                        </select>
                        <Button
                            variant="outline"
                            disabled={selectedBatch === null || busy}
                            onClick={() => {
                                if (selectedBatch === null) return
                                void runAction(() => repository.setBatchControl({
                                    batchId: selectedBatch.id,
                                    state: selectedBatch.state === 'active' ? 'paused' : 'active',
                                    now: new Date().toISOString(),
                                    reason: selectedBatch.state === 'active' ? 'user' : null,
                                }))
                            }}
                        >
                            {selectedBatch?.state === 'active'
                                ? <><Pause className="mr-2 h-4 w-4" />Pause</>
                                : <><Play className="mr-2 h-4 w-4" />Resume</>}
                        </Button>
                        <Button variant="outline" disabled={selectedBatch === null || busy} onClick={() => void retryFailed()}>
                            <RotateCcw className="mr-2 h-4 w-4" />Retry failed
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={selectedBatch === null || busy}
                            onClick={() => selectedBatch && void runAction(() => coordinator.cancelBatch(selectedBatch.id))}
                        >
                            <XCircle className="mr-2 h-4 w-4" />Cancel all
                        </Button>
                    </div>
                </div>
            </header>

            {legacyQueueCount > 0 && (
                <section
                    className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-3 py-2 sm:px-5"
                    data-testid="legacy-queue-migration"
                    aria-label="Legacy queue migration"
                >
                    <div className="min-w-0 text-xs">
                        <p className="font-medium">
                            {t('queue.legacyPending', '{{count}} legacy Scene items are pending.', {
                                count: legacyQueueCount,
                            })}
                        </p>
                        <p className="text-muted-foreground">
                            {t('queue.legacyRetained', 'Conversion snapshots current parameters and keeps the legacy counts for rollback.')}
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConversionOpen(true)}
                        className="min-h-11"
                    >
                        {t('queue.convertLegacy', 'Convert to durable jobs')}
                    </Button>
                </section>
            )}

            <section className="shrink-0 border-b border-border px-3 py-3 sm:px-5" aria-label="Queue summary">
                <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs sm:grid-cols-6 lg:grid-cols-10">
                    {(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'blocked'] as const).map(state => (
                        <div key={state} className="min-w-0">
                            <dt className="truncate text-muted-foreground">{state}</dt>
                            <dd className="font-mono text-sm font-semibold">{visibleSummary.states[state]}</dd>
                        </div>
                    ))}
                    <div><dt className="text-muted-foreground">Progress</dt><dd className="font-mono text-sm">{progressPercent}%</dd></div>
                    <div><dt className="text-muted-foreground">throughput</dt><dd className="font-mono text-sm">{rate.throughput.toFixed(1)}/m</dd></div>
                    <div><dt className="text-muted-foreground">eta</dt><dd className="font-mono text-sm">{formatEta(rate.eta)}</dd></div>
                </dl>
                <div
                    className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Total queue progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent}
                >
                    <div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
                </div>
                {failureCount > 0 && (
                    <Button
                        variant="ghost"
                        className="mt-2 min-h-11 px-2 text-destructive"
                        onClick={() => openDrawer()}
                    >
                        <AlertCircle className="mr-2 h-4 w-4" />
                        {t('queue.failureSummary', '{{count}} failed or blocked · Open diagnostics', {
                            count: failureCount,
                        })}
                    </Button>
                )}
            </section>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-5">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <select
                    value={statusFilter}
                    onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}
                    className="min-h-11 rounded-control border border-input bg-canvas px-3 text-sm"
                    aria-label="Filter queue status"
                >
                    {STATUS_FILTERS.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">{filteredJobs.length.toLocaleString()} jobs</span>
            </div>

            <div
                ref={viewportRef}
                className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
                onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
                role="list"
                aria-label="Generation jobs"
            >
                {filteredJobs.length === 0 ? (
                    <div className="flex min-h-48 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                        No jobs in this view.
                    </div>
                ) : (
                    <div className="relative w-full" style={{ height: filteredJobs.length * QUEUE_ROW_HEIGHT }}>
                        {filteredJobs.slice(windowRange.start, windowRange.end).map((job, offset) => {
                            const index = windowRange.start + offset
                            const percent = job.progress.total <= 0
                                ? 0
                                : Math.min(100, Math.round((job.progress.current / job.progress.total) * 100))
                            return (
                                <div
                                    key={job.id}
                                    role="listitem"
                                    aria-setsize={filteredJobs.length}
                                    aria-posinset={index + 1}
                                    tabIndex={focusedIndex === index ? 0 : -1}
                                    data-queue-index={index}
                                    onFocus={() => setFocusedIndex(index)}
                                    onKeyDown={event => handleRowKey(event, index)}
                                    className="absolute left-0 flex min-h-11 w-full items-center gap-3 border-b border-border bg-card px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                                    style={{
                                        height: QUEUE_ROW_HEIGHT,
                                        transform: `translateY(${index * QUEUE_ROW_HEIGHT}px)`,
                                    }}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className={cn(
                                                'shrink-0 text-xs font-semibold uppercase',
                                                job.state === 'failed' ? 'text-destructive'
                                                    : job.state === 'succeeded' ? 'text-success'
                                                        : job.state === 'blocked' ? 'text-warning' : 'text-info',
                                            )}>{job.state}</span>
                                            <span className="truncate font-mono text-xs" title={job.id}>{job.id}</span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                                            <span>{job.workflow}{job.sceneId ? ` · ${job.sceneId}` : ''}</span>
                                            <span>attempt {job.attemptCount}/{job.maxAttempts}</span>
                                            <span>{job.progress.stage} · {percent}%</span>
                                        </div>
                                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-label={`Item progress ${percent}%`}>
                                            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                                        </div>
                                    </div>
                                    {job.lastDiagnosticEventId !== null && (
                                        <Button variant="ghost" size="icon" aria-label="Open job diagnostic" onClick={() => showDiagnostic(job)}>
                                            <AlertCircle className="h-4 w-4" />
                                        </Button>
                                    )}
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" aria-label="Job actions">
                                                <EllipsisVertical className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                                className="min-h-11"
                                                disabled={isTerminalJobState(job.state)}
                                                onSelect={() => void runAction(() => coordinator.cancelJob(job.id))}
                                            >
                                                <XCircle className="mr-2 h-4 w-4" />Cancel
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="min-h-11"
                                                disabled={job.state !== 'queued' && job.state !== 'blocked'}
                                                onSelect={() => void runAction(() => repository.skipJob({
                                                    jobId: job.id,
                                                    now: new Date().toISOString(),
                                                    expectedVersion: job.version,
                                                }))}
                                            >
                                                <SkipForward className="mr-2 h-4 w-4" />Skip
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="min-h-11" disabled={job.lastDiagnosticEventId === null} onSelect={() => showDiagnostic(job)}>
                                                <AlertCircle className="mr-2 h-4 w-4" />Diagnostic
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
            <ConfirmDialog
                open={conversionOpen}
                onOpenChange={setConversionOpen}
                title={t('queue.convertLegacyTitle', 'Convert legacy Scene queue?')}
                description={t(
                    'queue.convertLegacyDescription',
                    'Current parameters and required resources will be snapshotted into durable jobs. Existing queue counts will remain available for rollback.',
                )}
                confirmText={t('queue.convertLegacyConfirm', 'Convert')}
                cancelText={t('common.cancel', 'Cancel')}
                onConfirm={convertLegacyQueue}
            />
        </main>
    )
}
