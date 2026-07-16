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

export type OutputCollisionPolicy = 'unique' | 'overwrite' | 'error'

export const DEFAULT_FILENAME_MAX_LENGTH = 180

const TOKEN_PATTERN = /\{([A-Za-z0-9_.]+)(?::([^{}]+))?\}/g
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const IMAGE_EXTENSION = /\.(png|webp)$/i

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
    if (value instanceof Date) return format ? formatDate(value, format) : value.toISOString()
    if (typeof value === 'number' && Number.isFinite(value) && format && /^0\d+$/.test(format)) {
        return pad(value, format.length)
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }
    if (format && value === 'datetime') return formatDate(now, format)
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
            if (path === 'datetime') return format ? formatDate(now, format) : now.toISOString()
            return formatTemplateValue(getPathValue({ ...context, datetime: now }, path), format, now)
        })
        return sanitizeFilenamePart(rendered, fallback, params.maxLength)
    } catch {
        return sanitizeFilenamePart(fallback, fallback, params.maxLength)
    }
}

export function normalizeImageExtension(extension: string): 'png' | 'webp' {
    return extension.replace(/^\./, '').toLowerCase() === 'webp' ? 'webp' : 'png'
}

export function ensureImageFileExtension(
    fileName: string | null | undefined,
    extension: string,
): string | null {
    const trimmed = fileName?.trim()
    if (!trimmed) return null
    const safeExtension = normalizeImageExtension(extension)
    const withoutImageExtension = trimmed.replace(IMAGE_EXTENSION, '')
    return `${sanitizeFilenamePart(withoutImageExtension)}.${safeExtension}`
}

export function toSidecarPath(imagePath: string): string {
    return imagePath.replace(/\.[^./\\]+$/, '.nais2.json')
}

export function toSidecarFileName(fileName: string): string {
    return toSidecarPath(fileName)
}

export function toDiagnosticSidecarPath(imagePath: string): string {
    return imagePath.replace(/\.[^./\\]+$/, '.nais2.diagnostic.json')
}

/**
 * Artifact distribution uses a separate, non-generation sidecar.  Keep its
 * name derived from the final image so OutputWriter can commit it atomically
 * with the image and any legacy metadata sidecars.
 */
export function toArtifactSidecarPath(imagePath: string): string {
    return imagePath.replace(/\.[^./\\]+$/, '.nais2.artifact.json')
}

export function splitFileName(fileName: string): { stem: string; extension: string } {
    const match = /^(.*?)(\.[^.]*)$/.exec(fileName)
    return match === null
        ? { stem: fileName, extension: '' }
        : { stem: match[1], extension: match[2] }
}

export function withDuplicateSuffix(fileName: string, duplicateIndex: number): string {
    if (duplicateIndex <= 0) return fileName
    const { stem, extension } = splitFileName(fileName)
    return `${stem}-${duplicateIndex + 1}${extension}`
}

export async function resolveCollisionFileName(
    requestedFileName: string,
    policy: OutputCollisionPolicy,
    exists: (candidate: string) => boolean | Promise<boolean>,
): Promise<string> {
    if (!await exists(requestedFileName)) return requestedFileName
    if (policy === 'overwrite') return requestedFileName
    if (policy === 'error') throw new Error(`Output already exists: ${requestedFileName}`)

    for (let duplicateIndex = 1; duplicateIndex < 10_000; duplicateIndex += 1) {
        const candidate = withDuplicateSuffix(requestedFileName, duplicateIndex)
        if (!await exists(candidate)) return candidate
    }
    throw new Error(`Unable to allocate a unique output name for ${requestedFileName}`)
}
