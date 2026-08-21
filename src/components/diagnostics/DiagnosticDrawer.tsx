import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCopy, Download, LifeBuoy, ListTree } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
    copyDiagnosticEvent,
    downloadDiagnosticsExport,
} from '@/services/diagnostics/exporter'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'
import { CompositionAuthorityPanel } from './CompositionAuthorityPanel'
import { getDiagnosticDrawerTriggerProps } from './drawer-contract'
import { openProductGuidance } from '@/services/guidance/diagnostic-guides'

function elapsed(event: { elapsedMs?: number }): string {
    return event.elapsedMs === undefined ? '-' : `${Math.max(0, Math.round(event.elapsedMs / 1000))}s`
}

export function DiagnosticDrawer() {
    const { t } = useTranslation()
    const events = useDiagnosticsStore(state => state.events)
    const selectedEventId = useDiagnosticsStore(state => state.selectedEventId)
    const drawerOpen = useDiagnosticsStore(state => state.drawerOpen)
    const openDrawer = useDiagnosticsStore(state => state.openDrawer)
    const closeDrawer = useDiagnosticsStore(state => state.closeDrawer)
    const selectEvent = useDiagnosticsStore(state => state.selectEvent)
    const [detailsExpanded, setDetailsExpanded] = useState(false)
    const selectedEvent = events.find(event => event.eventId === selectedEventId) ?? events[0]
    const open = () => openDrawer(selectedEvent?.eventId)

    return (
        <>
            <button
                {...getDiagnosticDrawerTriggerProps(open)}
                aria-haspopup="dialog"
                className="h-11 w-11 shrink-0 rounded-control border border-border text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-auto sm:px-3"
                aria-label={t('diagnosticDrawer.open')}
            >
                <ListTree className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t('diagnosticDrawer.shortLabel')}</span>
            </button>
            <Dialog open={drawerOpen} onOpenChange={openValue => (openValue ? open() : closeDrawer())}>
                <DialogContent className="max-h-[85dvh] max-w-4xl overflow-y-auto p-0">
                    <DialogHeader className="border-b border-border p-4 pr-14">
                        <DialogTitle>{t('diagnosticDrawer.title')}</DialogTitle>
                        <DialogDescription>{t('diagnosticDrawer.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="border-b border-border p-4">
                        <CompositionAuthorityPanel />
                    </div>
                    <div className="grid min-h-[320px] md:grid-cols-[220px_minmax(0,1fr)]">
                        <div className="overflow-y-auto border-b border-border p-2 md:border-b-0 md:border-r">
                            {events.length === 0 ? (
                                <p className="p-2 text-sm text-muted-foreground">{t('diagnosticDrawer.empty')}</p>
                            ) : events.map(event => (
                                <button
                                    key={event.eventId}
                                    type="button"
                                    className={`min-h-11 w-full rounded-control p-2 text-left text-xs focus:outline-none focus:ring-2 focus:ring-ring ${event.eventId === selectedEvent?.eventId ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
                                    onClick={() => {
                                        selectEvent(event.eventId)
                                        setDetailsExpanded(false)
                                    }}
                                >
                                    <div className="font-mono">{event.code}</div>
                                    <div className="mt-1 line-clamp-2 text-muted-foreground">{event.userSummary}</div>
                                </button>
                            ))}
                        </div>
                        {selectedEvent && (
                            <div className="min-w-0 overflow-y-auto p-4">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <p className="font-medium">{selectedEvent.userSummary}</p>
                                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                            {selectedEvent.code} · {selectedEvent.stage} · {elapsed(selectedEvent)}
                                        </p>
                                    </div>
                                    <span className="rounded-control bg-muted px-2 py-1 text-xs">{selectedEvent.category}</span>
                                </div>
                                <p className="mt-3 text-sm text-muted-foreground">
                                    {t('diagnosticDrawer.recommendedAction')}: {selectedEvent.recommendedAction}
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" onClick={() => { void copyDiagnosticEvent(selectedEvent, 'summary') }}>
                                        <ClipboardCopy className="mr-1.5 h-4 w-4" />{t('diagnosticDrawer.copySummary')}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => { void copyDiagnosticEvent(selectedEvent, 'full') }}>
                                        <ClipboardCopy className="mr-1.5 h-4 w-4" />{t('diagnosticDrawer.copyRedactedLog')}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => downloadDiagnosticsExport(events)}>
                                        <Download className="mr-1.5 h-4 w-4" />{t('diagnosticDrawer.exportJson')}
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => setDetailsExpanded(expanded => !expanded)}>
                                        {detailsExpanded
                                            ? t('diagnosticDrawer.collapseDetails')
                                            : t('diagnosticDrawer.expandDetails')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            closeDrawer()
                                            window.setTimeout(() => openProductGuidance(selectedEvent.code), 0)
                                        }}
                                        aria-describedby={`diagnostic-code-${selectedEvent.eventId}`}
                                    >
                                        <LifeBuoy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                                        {t('productGuidance.openDiagnosticGuide')}
                                    </Button>
                                </div>
                                <span id={`diagnostic-code-${selectedEvent.eventId}`} className="sr-only">{selectedEvent.code}</span>
                                {detailsExpanded && (
                                    <div className="mt-4 space-y-4 border-t border-border pt-4 text-xs">
                                        <section>
                                            <h3 className="font-medium">{t('diagnosticDrawer.timeline')}</h3>
                                            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all text-muted-foreground">
                                                <dt>{t('diagnosticDrawer.occurredAt')}</dt><dd>{selectedEvent.occurredAt}</dd>
                                                <dt>{t('diagnosticDrawer.operation')}</dt><dd>{selectedEvent.operation}</dd>
                                                <dt>{t('diagnosticDrawer.retry')}</dt><dd>{selectedEvent.retryAttempt ?? 0}/{selectedEvent.maxAttempts ?? '-'}</dd>
                                            </dl>
                                        </section>
                                        <section>
                                            <h3 className="font-medium">{t('diagnosticDrawer.cause')}</h3>
                                            <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-control bg-muted p-3 font-mono text-[11px]">{selectedEvent.redactedDeveloperMessage}</pre>
                                            {selectedEvent.redactedCauseChain.map((cause, index) => (
                                                <pre key={`${cause.name}-${index}`} className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-control bg-muted p-3 font-mono text-[11px]">{cause.name}: {cause.message}{cause.stack ? `\n${cause.stack}` : ''}</pre>
                                            ))}
                                        </section>
                                        <section>
                                            <h3 className="font-medium">{t('diagnosticDrawer.recentActivity')}</h3>
                                            <ul className="mt-2 space-y-1 text-muted-foreground">
                                                {selectedEvent.recentBreadcrumbs.map(breadcrumb => (
                                                    <li key={`${breadcrumb.occurredAt}-${breadcrumb.operation}-${breadcrumb.stage}`} className="break-all">
                                                        {breadcrumb.occurredAt} · {breadcrumb.operation} / {breadcrumb.stage}{breadcrumb.message ? ` · ${breadcrumb.message}` : ''}
                                                    </li>
                                                ))}
                                            </ul>
                                        </section>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
