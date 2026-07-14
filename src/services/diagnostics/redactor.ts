import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { DiagnosticCause, DiagnosticPromptSummary } from '@/domain/diagnostics/types'

export const DIAGNOSTIC_REDACTION_MARKERS = {
    authorization: '[REDACTED:AUTHORIZATION]',
    binary: '[REDACTED:BINARY]',
    cookie: '[REDACTED:COOKIE]',
    credential: '[REDACTED:CREDENTIAL]',
    image: '[REDACTED:IMAGE]',
    path: '[REDACTED:PATH]',
    presignedUrl: '[REDACTED:PRESIGNED_URL]',
    prompt: '[REDACTED:PROMPT]',
    providerResponse: '[REDACTED:PROVIDER_RESPONSE]',
    token: '[REDACTED:TOKEN]',
} as const

const MAX_STRING_LENGTH = 2_048
const MAX_PROVIDER_RESPONSE_LENGTH = 512
const MAX_DEPTH = 6
const MAX_ARRAY_ITEMS = 40

function normalizedKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function trimBounded(value: string, limit = MAX_STRING_LENGTH): string {
    return value.length <= limit ? value : `${value.slice(0, limit)}…[truncated]`
}

function replaceUrlQueries(value: string): string {
    return value.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
        const trailing = candidate.match(/[),.;]+$/)?.[0] ?? ''
        const urlText = trailing ? candidate.slice(0, -trailing.length) : candidate
        try {
            const url = new URL(urlText)
            const sensitiveQuery = [...url.searchParams.keys()].some(key => (
                /(?:token|signature|credential|security|session|cookie|authorization|awsaccesskeyid)/i.test(key)
            ))
            if (!sensitiveQuery) return candidate
            return `${url.origin}${url.pathname}?${DIAGNOSTIC_REDACTION_MARKERS.presignedUrl}${trailing}`
        } catch {
            return candidate
        }
    })
}

/** Applies the same text redaction used for errors, stacks, clipboard, and export. */
export function redactDiagnosticText(value: string): string {
    let redacted = value
        .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[^,\s]+)*;base64,[a-z0-9+/_=-]+/gi, DIAGNOSTIC_REDACTION_MARKERS.image)
        .replace(/\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer\s+)?[^\s,;]+/gi, `Authorization: ${DIAGNOSTIC_REDACTION_MARKERS.authorization}`)
        .replace(/\bbearer\s+[a-z0-9._~+\/-]+=*/gi, `Bearer ${DIAGNOSTIC_REDACTION_MARKERS.token}`)
        .replace(/\b(?:set-)?cookie\s*:\s*[^\r\n]+/gi, `Cookie: ${DIAGNOSTIC_REDACTION_MARKERS.cookie}`)
        .replace(/([?&#](?:access_token|refresh_token|provider_token|token|session|cookie|x-amz-credential|x-amz-signature|x-amz-security-token|awsaccesskeyid)=)[^&#\s]+/gi, `$1${DIAGNOSTIC_REDACTION_MARKERS.token}`)
        .replace(/(["']?(?:novelai[_-]?token|nai[_-]?token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|credential|authorization)["']?\s*[:=]\s*)(["']?)([^"'\s,};&]+)\2/gi, (_match, prefix: string, quote: string) => `${prefix}${quote}${DIAGNOSTIC_REDACTION_MARKERS.credential}${quote}`)
        .replace(/\b(?:negative[_ -]?prompt|prompt)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^;\r\n]+)/gi, `prompt=${DIAGNOSTIC_REDACTION_MARKERS.prompt}`)

    redacted = replaceUrlQueries(redacted)
    redacted = redacted
        .replace(/\b[a-z]:\\users\\[^\\\r\n"'<>]+(?:\\[^\r\n"'<>]*)?/gi, DIAGNOSTIC_REDACTION_MARKERS.path)
        .replace(/\b[a-z]:\\(?:users\\[^\\\r\n"'<>]+\\)?appdata\\[^\r\n"'<>]*/gi, DIAGNOSTIC_REDACTION_MARKERS.path)
        .replace(/\/(?:home|users)\/[^/\s"'<>]+(?:\/[^\r\n"'<>]*)?/gi, DIAGNOSTIC_REDACTION_MARKERS.path)
        .replace(/file:\/\/\/[^\s"'<>]+/gi, DIAGNOSTIC_REDACTION_MARKERS.path)

    const compact = redacted.trim().replace(/[\r\n\t ]+/g, '')
    if (compact.length >= 128 && /^[a-z0-9+/_-]+={0,2}$/i.test(compact)) {
        return DIAGNOSTIC_REDACTION_MARKERS.binary
    }
    return trimBounded(redacted)
}

export function summarizePrompt(prompt: string): DiagnosticPromptSummary {
    const chars = prompt.length
    return {
        hash: `sha256:${sha256Utf8(prompt)}`,
        chars,
        ...(chars === 0 ? {} : { estimatedTokens: Math.ceil(chars / 4) }),
    }
}

function markerForKey(key: string): string | undefined {
    const normalized = normalizedKey(key)
    if (normalized.includes('prompt')) return DIAGNOSTIC_REDACTION_MARKERS.prompt
    if (/(?:image|base64|binary|bytes|blob|dataurl|mask)/.test(normalized)) return DIAGNOSTIC_REDACTION_MARKERS.image
    if (/(?:authorization|token|secret|password|credential|apikey|accesskey|privatekey|cookie|session)/.test(normalized)) {
        return DIAGNOSTIC_REDACTION_MARKERS.credential
    }
    if (/(?:path|directory|homedir|appdata|localappdata)/.test(normalized)) return DIAGNOSTIC_REDACTION_MARKERS.path
    return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function redactValue(value: unknown, depth: number, seen: Set<object>): unknown {
    if (typeof value === 'string') return redactDiagnosticText(value)
    if (value === null || typeof value !== 'object') return value
    if (value instanceof Date) return value.toISOString()
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return DIAGNOSTIC_REDACTION_MARKERS.binary
    if (depth >= MAX_DEPTH) return '[REDACTED:MAX_DEPTH]'
    if (seen.has(value)) return '[REDACTED:CIRCULAR]'

    seen.add(value)
    try {
        if (Array.isArray(value)) {
            return value.slice(0, MAX_ARRAY_ITEMS).map(item => redactValue(item, depth + 1, seen))
        }
        if (value instanceof Error) {
            return {
                name: value.name,
                message: redactDiagnosticText(value.message),
                ...(value.stack ? { stack: redactDiagnosticText(value.stack) } : {}),
                ...((value as Error & { cause?: unknown }).cause === undefined
                    ? {}
                    : { cause: redactValue((value as Error & { cause?: unknown }).cause, depth + 1, seen) }),
            }
        }
        const record: Record<string, unknown> = {}
        for (const [key, child] of Object.entries(value)) {
            const marker = markerForKey(key)
            record[key] = marker === DIAGNOSTIC_REDACTION_MARKERS.prompt && typeof child === 'string'
                ? summarizePrompt(child)
                : marker ?? redactValue(child, depth + 1, seen)
        }
        return record
    } finally {
        seen.delete(value)
    }
}

/** Returns a detached, bounded diagnostic-safe copy of an arbitrary value. */
export function redactDiagnosticValue(value: unknown): unknown {
    return redactValue(value, 0, new Set<object>())
}

/** Provider bodies are only retained as a bounded allowlist projection. */
export function redactProviderResponseBody(value: string): string {
    try {
        const parsed = JSON.parse(value) as unknown
        if (!isRecord(parsed)) return DIAGNOSTIC_REDACTION_MARKERS.providerResponse
        const allowed = ['code', 'error', 'message', 'detail', 'request_id', 'requestId']
        const projection: Record<string, unknown> = {}
        for (const key of allowed) {
            if (key in parsed) projection[key] = redactDiagnosticValue(parsed[key])
        }
        const serialized = JSON.stringify(projection)
        return serialized === '{}' ? DIAGNOSTIC_REDACTION_MARKERS.providerResponse : trimBounded(serialized, MAX_PROVIDER_RESPONSE_LENGTH)
    } catch {
        return DIAGNOSTIC_REDACTION_MARKERS.providerResponse
    }
}

export function redactedCauseChain(error: unknown, maxDepth = 4): DiagnosticCause[] {
    const causes: DiagnosticCause[] = []
    let current = error
    for (let depth = 0; depth < maxDepth && current instanceof Error; depth += 1) {
        causes.push({
            name: current.name || 'Error',
            message: redactDiagnosticText(current.message),
            ...(current.stack ? { stack: redactDiagnosticText(current.stack) } : {}),
        })
        current = (current as Error & { cause?: unknown }).cause
    }
    return causes
}
