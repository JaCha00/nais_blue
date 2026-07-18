import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import { ChevronRight, ListTodo } from 'lucide-react'

import type { QueueActivitySummary } from '@/domain/queue/types'
import { cn } from '@/lib/utils'
import { getRuntimeQueueRepository } from '@/services/queue/indexeddb-queue-repository'
import { useLayoutStore } from '@/stores/layout-store'

const QUEUE_ACTIVITY_REFRESH_MS = 5_000

const EMPTY_QUEUE_ACTIVITY_SUMMARY: QueueActivitySummary = Object.freeze({
    processing: 0,
    waiting: 0,
    needsAttention: 0,
})

type QueueActivityTone = 'attention' | 'processing' | 'waiting' | 'idle'

interface QueueActivityIndicator {
    tone: QueueActivityTone
    count: number
}

export function getQueueActivityIndicator(summary: QueueActivitySummary): QueueActivityIndicator {
    if (summary.needsAttention > 0) return { tone: 'attention', count: summary.needsAttention }
    if (summary.processing > 0) return { tone: 'processing', count: summary.processing }
    if (summary.waiting > 0) return { tone: 'waiting', count: summary.waiting }
    return { tone: 'idle', count: 0 }
}

export function QueueActivityLink() {
    const { t } = useTranslation()
    const repository = useMemo(() => getRuntimeQueueRepository(), [])
    const closeSupportSheet = useLayoutStore(state => state.closeSupportSheet)
    const refreshId = useRef(0)
    const [summary, setSummary] = useState<QueueActivitySummary>(EMPTY_QUEUE_ACTIVITY_SUMMARY)
    const indicator = getQueueActivityIndicator(summary)
    const total = summary.processing + summary.waiting + summary.needsAttention

    const refresh = useCallback(async () => {
        const requestId = ++refreshId.current
        try {
            const nextSummary = await repository.getActivitySummary()
            if (requestId === refreshId.current) setSummary(nextSummary)
        } catch {
            // IndexedDB is the durable source for this indicator, but a transient read
            // failure must not remove the common Queue route or replace its last known state.
        }
    }, [repository])

    useEffect(() => {
        const refreshWhenVisible = () => {
            if (document.visibilityState !== 'visible') return
            void refresh()
        }

        refreshWhenVisible()
        document.addEventListener('visibilitychange', refreshWhenVisible)
        const interval = window.setInterval(refreshWhenVisible, QUEUE_ACTIVITY_REFRESH_MS)
        return () => {
            refreshId.current += 1
            window.clearInterval(interval)
            document.removeEventListener('visibilitychange', refreshWhenVisible)
        }
    }, [refresh])

    const labels: Record<QueueActivityTone, string> = {
        attention: t('queue.activity.attention', 'Needs attention'),
        processing: t('queue.activity.processing', 'In progress'),
        waiting: t('queue.activity.waiting', 'Waiting'),
        idle: t('queue.activity.idle', 'No active jobs'),
    }
    const summaryLabel = t(
        'queue.activity.summary',
        '{{processing}} in progress · {{waiting}} waiting · {{attention}} need attention',
        {
            processing: summary.processing,
            waiting: summary.waiting,
            attention: summary.needsAttention,
        },
    )
    const accessibleLabel = t('queue.activity.open', 'Open Queue Center · {{summary}}', { summary: summaryLabel })
    const headline = indicator.count === 0
        ? t('queue.activity.idle', 'No active jobs')
        : t('queue.activity.indicator', '{{label}} {{count}}', {
            label: labels[indicator.tone],
            count: indicator.count,
        })

    return (
        <section className="shrink-0 px-5 pb-3" aria-label={t('queue.activity.reservedJobs', '예약 작업')}>
            <NavLink
                to="/queue"
                onClick={closeSupportSheet}
                data-testid="history-queue-activity"
                aria-label={accessibleLabel}
                className={({ isActive }) => cn(
                    'group block min-h-11 rounded-panel bg-canvas p-3 text-foreground transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                    isActive
                        ? 'ring-1 ring-primary/40'
                        : 'hover:bg-accent',
                )}
            >
                <div className="flex items-center gap-2">
                    <ListTodo className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{t('queue.activity.reservedJobs', '예약 작업')}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{headline}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2" aria-live="polite">
                    {([
                        ['processing', summary.processing, t('queue.activity.processing', '진행 중')],
                        ['waiting', summary.waiting, t('queue.activity.waiting', '대기')],
                        ['attention', summary.needsAttention, t('queue.activity.attention', '확인 필요')],
                    ] as const).map(([key, count, label]) => (
                        <div key={key} className="min-w-0 rounded-control bg-card px-2 py-1.5 text-center">
                            <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
                            <dd className={cn(
                                'mt-0.5 font-mono text-sm font-semibold',
                                key === 'attention' && count > 0 && 'text-destructive',
                                key === 'processing' && count > 0 && 'text-primary',
                            )}>
                                {count}
                            </dd>
                        </div>
                    ))}
                </dl>

                <p className="mt-2 text-[10px] text-muted-foreground">
                    {total === 0
                        ? t('queue.activity.scheduleHint', '작업을 예약하면 여기에 표시됩니다.')
                        : t('queue.activity.openDetails', '상세 현황과 제어는 큐 센터에서 확인')}
                </p>
            </NavLink>
        </section>
    )
}
