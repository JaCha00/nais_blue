export interface FilenameTemplateContext {
    [key: string]: unknown
}

export interface RenderFilenameTemplateParams {
    template?: string | null
    context?: FilenameTemplateContext
    now?: Date
    fallback?: string
    maxLength?: number
}

export const DEFAULT_FILENAME_MAX_LENGTH = 180

const TOKEN_PATTERN = /\{([A-Za-z0-9_.]+)(?::([^{}]+))?\}/g
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function pad(value: number, length: number): string {
    return String(value).padStart(length, '0')
}

export function createFallbackFilename(now: Date = new Date()): string {
    return `NAIS_${now.getTime()}`
}

function formatDate(date: Date, format: string): string {
    const replacements: Record<string, string> = {
        YYYY: String(date.getFullYear()),
        YY: String(date.getFullYear()).slice(-2),
        MM: pad(date.getMonth() + 1, 2),
        DD: pad(date.getDate(), 2),
        HH: pad(date.getHours(), 2),
        mm: pad(date.getMinutes(), 2),
        ss: pad(date.getSeconds(), 2),
        SSS: pad(date.getMilliseconds(), 3),
    }

    return format.replace(/YYYY|YY|MM|DD|HH|mm|ss|SSS/g, token => replacements[token] ?? token)
}

function getPathValue(source: FilenameTemplateContext, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (current === null || typeof current !== 'object') return undefined
        return (current as Record<string, unknown>)[segment]
    }, source)
}

function formatTemplateValue(value: unknown, format: string | undefined, now: Date): string {
    if (value === undefined || value === null) return ''

    if (value instanceof Date) {
        return format ? formatDate(value, format) : value.toISOString()
    }

    if (typeof value === 'number' && Number.isFinite(value) && format && /^0\d+$/.test(format)) {
        return pad(value, format.length)
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }

    if (format && value === 'datetime') {
        return formatDate(now, format)
    }

    return ''
}

export function sanitizeFilenamePart(
    value: string,
    fallback = createFallbackFilename(),
    maxLength = DEFAULT_FILENAME_MAX_LENGTH,
): string {
    const safeFallback = fallback.replace(INVALID_FILENAME_CHARS, '_').trim()
    const normalized = value
        .replace(INVALID_FILENAME_CHARS, '_')
        .replace(/\s+/g, ' ')
        .replace(/_+/g, '_')
        .trim()
        .replace(/^[. ]+|[. ]+$/g, '')

    const sanitized = normalized
        .slice(0, Math.max(1, maxLength))
        .replace(/^[. ]+|[. ]+$/g, '')

    if (!sanitized || WINDOWS_RESERVED_NAME.test(sanitized)) {
        return safeFallback || createFallbackFilename()
    }

    return sanitized
}

export function renderFilenameTemplate(params: RenderFilenameTemplateParams = {}): string {
    const now = params.now ?? new Date()
    const fallback = params.fallback ?? createFallbackFilename(now)
    const template = typeof params.template === 'string' && params.template.trim() ? params.template : fallback
    const context = params.context ?? {}

    try {
        const rendered = template.replace(TOKEN_PATTERN, (_match: string, path: string, format?: string) => {
            if (path === 'datetime') {
                return format ? formatDate(now, format) : now.toISOString()
            }

            const value = getPathValue({ ...context, seed: context.seed, datetime: now }, path)
            return formatTemplateValue(value, format, now)
        })

        return sanitizeFilenamePart(rendered, fallback, params.maxLength)
    } catch {
        return sanitizeFilenamePart(fallback, fallback, params.maxLength)
    }
}
