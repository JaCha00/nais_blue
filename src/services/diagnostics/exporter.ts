import { invoke, isTauri } from '@tauri-apps/api/core'
import type { DiagnosticEvent } from '@/domain/diagnostics/types'
import { redactDiagnosticText, redactDiagnosticValue } from './redactor'

const NATIVE_LOG_BREADCRUMB_LIMIT = 6
const textEncoder = new TextEncoder()

function safeEvent(event: DiagnosticEvent): DiagnosticEvent {
    return redactDiagnosticValue(event) as DiagnosticEvent
}

/**
 * The Rust logger accepts a 16 KiB event and depends on frontend redaction.
 * This projection removes stack repetition and byte-bounds every text field so
 * UI diagnostics stay detailed while the durable log remains reliably writable.
 */
export function createNativeDiagnosticLogEvent(event: DiagnosticEvent): DiagnosticEvent {
    const safe = safeEvent(event)
    const text = (value: string, maxBytes: number): string => {
        const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ')
        if (textEncoder.encode(normalized).byteLength <= maxBytes) return normalized
        const suffix = '…'
        let low = 0
        let high = normalized.length
        while (low < high) {
            const midpoint = Math.ceil((low + high) / 2)
            const candidate = `${normalized.slice(0, midpoint).replace(/[\uD800-\uDBFF]$/, '')}${suffix}`
            if (textEncoder.encode(candidate).byteLength <= maxBytes) low = midpoint
            else high = midpoint - 1
        }
        return `${normalized.slice(0, low).replace(/[\uD800-\uDBFF]$/, '')}${suffix}`
    }
    const optionalText = (value: string | undefined, maxBytes = 128): string | undefined => (
        value === undefined ? undefined : text(value, maxBytes)
    )

    return {
        schemaVersion: safe.schemaVersion,
        eventId: text(safe.eventId, 128),
        occurredAt: text(safe.occurredAt, 64),
        appVersion: text(safe.appVersion, 32),
        platform: text(safe.platform, 128),
        architecture: text(safe.architecture, 384),
        severity: safe.severity,
        code: text(safe.code, 128),
        category: safe.category,
        operation: text(safe.operation, 128),
        stage: text(safe.stage, 128),
        ...(optionalText(safe.correlationId) === undefined ? {} : { correlationId: optionalText(safe.correlationId) }),
        ...(optionalText(safe.userActionId) === undefined ? {} : { userActionId: optionalText(safe.userActionId) }),
        ...(optionalText(safe.jobId) === undefined ? {} : { jobId: optionalText(safe.jobId) }),
        ...(optionalText(safe.sceneId) === undefined ? {} : { sceneId: optionalText(safe.sceneId) }),
        ...(optionalText(safe.attemptId) === undefined ? {} : { attemptId: optionalText(safe.attemptId) }),
        ...(safe.httpStatus === undefined ? {} : { httpStatus: safe.httpStatus }),
        ...(optionalText(safe.providerRequestId) === undefined
            ? {}
            : { providerRequestId: optionalText(safe.providerRequestId) }),
        ...(optionalText(safe.startedAt, 64) === undefined ? {} : { startedAt: optionalText(safe.startedAt, 64) }),
        ...(safe.elapsedMs === undefined ? {} : { elapsedMs: safe.elapsedMs }),
        ...(optionalText(safe.lastProgressAt, 64) === undefined
            ? {}
            : { lastProgressAt: optionalText(safe.lastProgressAt, 64) }),
        ...(safe.retryAttempt === undefined ? {} : { retryAttempt: safe.retryAttempt }),
        ...(safe.maxAttempts === undefined ? {} : { maxAttempts: safe.maxAttempts }),
        cancelled: safe.cancelled,
        timeout: safe.timeout,
        stalled: safe.stalled,
        recoverable: safe.recoverable,
        userSummary: text(safe.userSummary, 384),
        recommendedAction: text(safe.recommendedAction, 384),
        ...(safe.prompt === undefined ? {} : { prompt: { ...safe.prompt } }),
        redactedDeveloperMessage: text(safe.redactedDeveloperMessage, 1_024),
        redactedCauseChain: safe.redactedCauseChain.slice(0, 4).map(cause => ({
            name: text(cause.name, 64),
            message: text(cause.message, 384),
        })),
        recentBreadcrumbs: safe.recentBreadcrumbs.slice(-NATIVE_LOG_BREADCRUMB_LIMIT).map(breadcrumb => ({
            occurredAt: text(breadcrumb.occurredAt, 64),
            operation: text(breadcrumb.operation, 64),
            stage: text(breadcrumb.stage, 64),
            ...(breadcrumb.message === undefined ? {} : { message: text(breadcrumb.message, 192) }),
        })),
    }
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
        format: 'nai-blue-diagnostics',
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
    link.download = 'nai-blue-diagnostics.json'
    link.click()
    URL.revokeObjectURL(href)
}

/** Production file logging accepts only the redacted structured event projection. */
export function persistDiagnosticEvent(event: DiagnosticEvent): void {
    if (!isTauri()) return
    void invoke('record_diagnostic_event', { event: createNativeDiagnosticLogEvent(event) }).catch(() => undefined)
}
