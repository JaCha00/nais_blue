import { invoke, isTauri } from '@tauri-apps/api/core'
import type { DiagnosticEvent } from '@/domain/diagnostics/types'
import { redactDiagnosticText, redactDiagnosticValue } from './redactor'

function safeEvent(event: DiagnosticEvent): DiagnosticEvent {
    return redactDiagnosticValue(event) as DiagnosticEvent
}

export function formatDiagnosticSummary(event: DiagnosticEvent): string {
    const safe = safeEvent(event)
    return [
        `${safe.severity.toUpperCase()} ${safe.code}`,
        safe.userSummary,
        `operation=${safe.operation}`,
        `stage=${safe.stage}`,
        ...(safe.elapsedMs === undefined ? [] : [`elapsedMs=${safe.elapsedMs}`]),
        `action=${safe.recommendedAction}`,
    ].join('\n')
}

export function formatDiagnosticFull(event: DiagnosticEvent): string {
    return JSON.stringify(safeEvent(event), null, 2)
}

export function createDiagnosticsExportJson(events: readonly DiagnosticEvent[]): string {
    return JSON.stringify({
        format: 'nais2-diagnostics',
        version: 1,
        exportedAt: new Date().toISOString(),
        events: events.map(safeEvent),
    }, null, 2)
}

export async function copyDiagnosticEvent(
    event: DiagnosticEvent,
    mode: 'summary' | 'full',
    clipboard: Pick<Clipboard, 'writeText'> = navigator.clipboard,
): Promise<string> {
    const text = redactDiagnosticText(mode === 'summary' ? formatDiagnosticSummary(event) : formatDiagnosticFull(event))
    await clipboard.writeText(text)
    return text
}

export function downloadDiagnosticsExport(events: readonly DiagnosticEvent[]): void {
    const body = createDiagnosticsExportJson(events)
    if (typeof document === 'undefined') return
    const blob = new Blob([body], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = 'nais2-diagnostics.json'
    link.click()
    URL.revokeObjectURL(href)
}

/** Production file logging accepts only the redacted structured event projection. */
export function persistDiagnosticEvent(event: DiagnosticEvent): void {
    if (!isTauri()) return
    void invoke('record_diagnostic_event', { event: safeEvent(event) }).catch(() => undefined)
}
