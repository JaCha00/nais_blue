import { useEffect } from 'react'
import { toast } from '@/components/ui/use-toast'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'

const shownEventIds = new Set<string>()

export function DiagnosticToastBridge() {
    const latestEvent = useDiagnosticsStore(state => state.events[0])

    useEffect(() => {
        if (!latestEvent
            || latestEvent.severity === 'info'
            || latestEvent.operation === 'startup'
            || latestEvent.operation.startsWith('startup.')
            || shownEventIds.has(latestEvent.eventId)) return
        shownEventIds.add(latestEvent.eventId)
        toast({
            title: latestEvent.userSummary,
            description: `${latestEvent.code} · ${latestEvent.stage}${latestEvent.elapsedMs === undefined ? '' : ` · ${Math.round(latestEvent.elapsedMs / 1000)}s`} · ${latestEvent.recommendedAction}`,
            variant: latestEvent.severity === 'warning' ? 'default' : 'destructive',
        })
    }, [latestEvent])

    return null
}
