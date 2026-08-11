import { useState, type ReactNode } from 'react'
import { Activity, ArrowLeft, ClipboardCopy, Download, KeyRound, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ApiTokenManager } from '@/components/credentials/ApiTokenDialog'
import { Button } from '@/components/ui/button'
import { runtimeCapabilities } from '@/platform/capabilities'
import { DeviceConnectionPanel } from '@/pages/DataHub'
import Settings, { type SettingsSection } from '@/pages/Settings'
import WebView from '@/pages/WebView'
import {
    copyDiagnosticEvent,
    downloadDiagnosticsExport,
} from '@/services/diagnostics/exporter'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'

export const GUIDED_ENVIRONMENT_TASK_IDS = [
    'credentials',
    'appearance',
    'storage',
    'shortcuts',
    'backup',
    'device',
    'web',
    'diagnostics',
] as const

export type GuidedEnvironmentTaskId = typeof GUIDED_ENVIRONMENT_TASK_IDS[number]

function GuidedCredentialWorkspace() {
    const { t } = useTranslation()
    const secureStorage = runtimeCapabilities.novelAiCredentialVault.supported

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6 lg:py-10" data-testid="guided-credential-workspace">
            <header className="max-w-2xl">
                <KeyRound className="h-7 w-7 text-primary" aria-hidden="true" />
                <p className="mt-5 text-sm font-semibold text-primary">
                    {t('guided.credential.formTitle')}
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                    {t('settingsPage.api.token')}
                </h1>
                <p className="mt-3 text-base leading-7 text-muted-foreground">
                    {secureStorage
                        ? t('settingsPage.api.secureStorageDescription')
                        : t('settingsPage.api.sessionStorageDescription')}
                </p>
                <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                    <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    {t('guided.credential.formHelp')}
                </p>
            </header>
            <div className="mt-8">
                <ApiTokenManager />
            </div>
        </div>
    )
}

function GuidedSettingsWorkspace({ section }: { section: Exclude<SettingsSection, 'general' | 'api'> }) {
    return <Settings guidedSection={section} />
}

function GuidedDeviceWorkspace() {
    const { t } = useTranslation()
    const [showBackup, setShowBackup] = useState(false)

    if (showBackup) {
        return (
            <div className="min-h-full">
                <div className="mx-auto w-full max-w-7xl px-3 pt-5 sm:px-5 lg:px-7">
                    <Button variant="ghost" onClick={() => setShowBackup(false)}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        {t('guided.workflows.native.device.back')}
                    </Button>
                </div>
                <Settings guidedSection="backup" />
            </div>
        )
    }

    return (
        <div className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-5 lg:px-7">
            <DeviceConnectionPanel onOpenBackup={() => setShowBackup(true)} />
        </div>
    )
}

export function GuidedDiagnosticsWorkspace() {
    const { t } = useTranslation()
    const events = useDiagnosticsStore(state => state.events)
    const selectedEventId = useDiagnosticsStore(state => state.selectedEventId)
    const selectEvent = useDiagnosticsStore(state => state.selectEvent)
    const selected = events.find(event => event.eventId === selectedEventId) ?? events[0] ?? null

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:py-10" data-testid="guided-diagnostics-workspace">
            <header className="max-w-3xl">
                <Activity className="h-7 w-7 text-primary" aria-hidden="true" />
                <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                    {t('guided.workflows.native.diagnostics.title')}
                </h1>
                <p className="mt-3 text-base leading-7 text-muted-foreground">
                    {t('guided.workflows.native.diagnostics.description')}
                </p>
            </header>

            <div className="mt-8 grid border-y border-border/60 lg:grid-cols-[minmax(14rem,0.7fr)_minmax(20rem,1.3fr)]">
                <div className="max-h-[34rem] overflow-y-auto border-b border-border/45 p-2 lg:border-b-0 lg:border-r">
                    {events.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground" role="status">
                            {t('guided.workflows.native.diagnostics.empty')}
                        </p>
                    ) : events.map(event => (
                        <button
                            key={event.eventId}
                            type="button"
                            className={`min-h-16 w-full border-t border-border/35 px-3 py-3 text-left first:border-t-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${event.eventId === selected?.eventId ? 'bg-primary/[0.06]' : 'hover:bg-muted/40'}`}
                            onClick={() => selectEvent(event.eventId)}
                            aria-current={event.eventId === selected?.eventId ? 'true' : undefined}
                        >
                            <span className="block font-mono text-sm text-primary">{event.code}</span>
                            <span className="mt-1 line-clamp-2 block text-sm leading-5 text-muted-foreground">{event.userSummary}</span>
                        </button>
                    ))}
                </div>

                <div className="min-w-0 p-4 sm:p-6">
                    {selected === null ? (
                        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
                            {t('guided.workflows.native.diagnostics.waiting')}
                        </div>
                    ) : (
                        <article>
                            <p className="break-words text-lg font-semibold">{selected.userSummary}</p>
                            <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{selected.code} · {selected.stage}</p>
                            <div className="mt-5 border-y border-border/45 py-4">
                                <p className="text-sm font-semibold">
                                    {t('guided.workflows.native.diagnostics.recommendedAction')}
                                </p>
                                <p className="mt-2 text-base leading-7 text-muted-foreground">{selected.recommendedAction}</p>
                            </div>
                            <div className="mt-5 flex flex-wrap gap-2">
                                <Button variant="outline" onClick={() => { void copyDiagnosticEvent(selected, 'summary') }}>
                                    <ClipboardCopy className="mr-2 h-4 w-4" />
                                    {t('guided.workflows.native.diagnostics.copySummary')}
                                </Button>
                                <Button variant="outline" onClick={() => { void copyDiagnosticEvent(selected, 'full') }}>
                                    <ClipboardCopy className="mr-2 h-4 w-4" />
                                    {t('guided.workflows.native.diagnostics.copyLog')}
                                </Button>
                                <Button variant="outline" onClick={() => downloadDiagnosticsExport(events)}>
                                    <Download className="mr-2 h-4 w-4" />
                                    {t('guided.workflows.native.diagnostics.exportJson')}
                                </Button>
                            </div>
                            <details className="mt-6 border-t border-border/45 pt-4">
                                <summary className="min-h-11 cursor-pointer text-sm font-medium">
                                    {t('guided.workflows.native.diagnostics.technicalDetails')}
                                </summary>
                                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-muted/35 p-3 font-mono text-xs leading-5">{selected.redactedDeveloperMessage}</pre>
                            </details>
                        </article>
                    )}
                </div>
            </div>
        </div>
    )
}

export function GuidedEnvironmentTask({ optionId }: { optionId: string }) {
    const { t } = useTranslation()
    let task: ReactNode

    switch (optionId) {
        case 'credentials':
            task = <GuidedCredentialWorkspace />
            break
        case 'appearance':
        case 'storage':
        case 'shortcuts':
        case 'backup':
            task = <GuidedSettingsWorkspace section={optionId} />
            break
        case 'device':
            task = <GuidedDeviceWorkspace />
            break
        case 'web':
            task = <WebView />
            break
        case 'diagnostics':
            task = <GuidedDiagnosticsWorkspace />
            break
        default:
            task = (
                <div className="mx-auto flex min-h-64 max-w-2xl items-center justify-center px-4 text-center text-sm text-muted-foreground" role="alert">
                    {t('guided.workflows.native.unavailable.environment')}
                </div>
            )
    }

    return (
        <div className="min-h-full min-w-0" data-guided-native-task={`environment.${optionId}`}>
            {task}
        </div>
    )
}
