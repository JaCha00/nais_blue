import { homedir } from 'node:os'
import { isAbsolute, posix, win32 } from 'node:path'

import { stableJsonStringify, type StableJsonOptions } from './stable-json'

export const REDACTION_MARKERS = {
    base64: '[REDACTED:BASE64]',
    binary: '[REDACTED:BINARY]',
    cacheKey: '[REDACTED:CACHE_KEY]',
    credential: '[REDACTED:CREDENTIAL]',
    circular: '[REDACTED:CIRCULAR]',
    novelAiToken: '[REDACTED:NOVELAI_TOKEN]',
    oauthSession: '[REDACTED:OAUTH_SESSION]',
    path: '[REDACTED:PATH]',
    remoteCredential: '[REDACTED:REMOTE_CREDENTIAL]',
    r2Credential: '[REDACTED:R2_CREDENTIAL]',
    token: '[REDACTED:TOKEN]',
} as const

export interface SnapshotRedactionOptions {
    /** Extra home directories to remove in addition to the current OS home. */
    homeDirectories?: readonly string[]
    /** Minimum length at which an unlabelled base64-looking string is removed. */
    rawBase64MinimumLength?: number
}

type RedactionMarker = (typeof REDACTION_MARKERS)[keyof typeof REDACTION_MARKERS]

function normalizedKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizedPath(path: readonly string[]): string {
    return path.map(normalizedKey).join('.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isOAuthSession(value: unknown): boolean {
    if (!isRecord(value)) return false
    const keys = new Set(Object.keys(value).map(normalizedKey))
    const hasAccessToken = keys.has('accesstoken') || keys.has('providertoken')
    const hasSessionContext = keys.has('refreshtoken')
        || keys.has('tokentype')
        || keys.has('expiresat')
        || keys.has('expiresin')
    return hasAccessToken && hasSessionContext
}

function sensitiveMarkerForKey(
    key: string,
    value: unknown,
    parentPath: readonly string[],
): RedactionMarker | undefined {
    const normalized = normalizedKey(key)
    const context = normalizedPath([...parentPath, key])

    if (
        normalized.includes('base64')
        || ['imagedata', 'imagebytes', 'sourceimage', 'maskimage'].includes(normalized)
    ) {
        return REDACTION_MARKERS.base64
    }
    if (
        normalized.includes('cachekey')
        || normalized.includes('cachesecretkey')
    ) {
        return REDACTION_MARKERS.cacheKey
    }
    const isDeepDiffJsonPath = normalized === 'path'
        && typeof value === 'string'
        && /^\$(?:\.|\[|$)/.test(value)
    if (
        !isDeepDiffJsonPath
        && (
            normalized === 'path'
            || normalized.endsWith('path')
            || normalized.includes('filepath')
            || normalized.endsWith('directory')
            || normalized === 'homedir'
        )
    ) {
        return REDACTION_MARKERS.path
    }
    if (
        normalized.includes('oauthsession')
        || normalized.includes('authsession')
        || (normalized === 'session' && isOAuthSession(value))
    ) {
        return REDACTION_MARKERS.oauthSession
    }

    const isRemoteServiceContext = context.includes('remote') || context.includes('backend')
    if (
        (isRemoteServiceContext && /(key|secret|password|token|credential|url)/.test(normalized))
        || ['anonkey', 'servicerolekey'].includes(normalized)
    ) {
        return REDACTION_MARKERS.remoteCredential
    }

    const isR2Context = parentPath.some((part) => normalizedKey(part) === 'r2')
        || normalized.startsWith('r2')
    if (
        (isR2Context && /(accesskey|secret|credential|accountid|privatekey|apitoken)/.test(normalized))
        || ['accountid', 'accesskeyid', 'secretaccesskey'].includes(normalized)
    ) {
        return REDACTION_MARKERS.r2Credential
    }

    if ((normalized.includes('novelai') || normalized.startsWith('nai')) && normalized.includes('token')) {
        return REDACTION_MARKERS.novelAiToken
    }
    if (normalized === 'token' || /^token\d+$/.test(normalized)) {
        return REDACTION_MARKERS.novelAiToken
    }
    if (normalized.includes('token') || normalized === 'authorization') {
        return REDACTION_MARKERS.token
    }
    if (
        normalized.includes('password')
        || normalized.includes('secret')
        || normalized.includes('credential')
        || normalized === 'apikey'
        || normalized === 'privatekey'
        || normalized === 'accesskeyid'
        || normalized === 'cookie'
    ) {
        return REDACTION_MARKERS.credential
    }
    return undefined
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function markerForEnvironmentName(name: string): RedactionMarker {
    const normalized = normalizedKey(name)
    if (normalized.includes('anonkey') || normalized.includes('servicerolekey')) {
        return REDACTION_MARKERS.remoteCredential
    }
    if (normalized.startsWith('r2') || normalized.includes('r2')) return REDACTION_MARKERS.r2Credential
    if (normalized.includes('nai') || normalized.includes('novelai')) return REDACTION_MARKERS.novelAiToken
    return REDACTION_MARKERS.credential
}

function looksLikeAbsolutePath(value: string): boolean {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value.startsWith('file://')
    return isAbsolute(value) || posix.isAbsolute(value) || win32.isAbsolute(value)
}

function redactString(value: string, options: SnapshotRedactionOptions): string {
    let redacted = value.replace(
        /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,\s]+)*;base64,[a-z0-9+/_=-]+(?:\r?\n[ \t]*[a-z0-9+/_=-]+)*/gi,
        REDACTION_MARKERS.base64,
    )

    redacted = redacted.replace(
        /\b(NAI_TOKEN|NOVELAI_TOKEN|(?:VITE_)?[A-Z][A-Z0-9_]*(?:ANON_KEY|SERVICE_ROLE_KEY)|(?:CLOUDFLARE_)?R2_(?:ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY|API_TOKEN))\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
        (_match, name: string, separator: string) => `${name}${separator}${markerForEnvironmentName(name)}`,
    )
    redacted = redacted.replace(
        /(["']?(?:novelai[_-]?token|nai[_-]?token|access[_-]?token|refresh[_-]?token|provider[_-]?token|token\d*)["']?\s*[:=]\s*)(["']?)([^"'\s,};&]+)\2/gi,
        (_match, prefix: string, quote: string) => {
            const marker = /(?:novelai|nai)[_-]?token/i.test(prefix)
                ? REDACTION_MARKERS.novelAiToken
                : REDACTION_MARKERS.token
            return `${prefix}${quote}${marker}${quote}`
        },
    )
    redacted = redacted.replace(
        /([?#&](?:access_token|refresh_token|provider_token|token)=)[^&#\s]+/gi,
        `$1${REDACTION_MARKERS.token}`,
    )
    redacted = redacted.replace(
        /([?&#](?:x-amz-credential|x-amz-signature|x-amz-security-token|awsaccesskeyid)=)[^&#\s]+/gi,
        `$1${REDACTION_MARKERS.r2Credential}`,
    )
    redacted = redacted.replace(
        /([?&#](?:(?:image_)?cache_key|(?:image_)?cache_secret_key)=)[^&#\s]+/gi,
        `$1${REDACTION_MARKERS.cacheKey}`,
    )
    redacted = redacted.replace(
        /(["']?(?:(?:image[_-]?)?cache[_-]?(?:secret[_-]?)?key)["']?\s*[:=]\s*)(["']?)([^"'\s,};&]+)\2/gi,
        (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTION_MARKERS.cacheKey}${quote}`,
    )
    redacted = redacted.replace(
        /(["']?(?:anon[_-]?key|service[_-]?role[_-]?key)["']?\s*[:=]\s*)(["']?)([^"'\s,};&]+)\2/gi,
        (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTION_MARKERS.remoteCredential}${quote}`,
    )
    redacted = redacted.replace(
        /(["']?(?:account[_-]?id|access[_-]?key[_-]?id|secret[_-]?access[_-]?key)["']?\s*[:=]\s*)(["']?)([^"'\s,};&]+)\2/gi,
        (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTION_MARKERS.r2Credential}${quote}`,
    )
    redacted = redacted.replace(
        /\bBearer\s+[a-z0-9._~+\/-]+=*/gi,
        `Bearer ${REDACTION_MARKERS.token}`,
    )
    redacted = redacted.replace(
        /\beyJ[a-z0-9_-]{12,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi,
        REDACTION_MARKERS.token,
    )

    const homes = [homedir(), ...(options.homeDirectories ?? [])]
        .filter((home, index, all) => home.length > 0 && all.indexOf(home) === index)
        .sort((left, right) => right.length - left.length)
    for (const home of homes) {
        const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])
        for (const variant of variants) {
            redacted = redacted.replace(
                new RegExp(escapeRegularExpression(variant), 'gi'),
                REDACTION_MARKERS.path,
            )
        }
    }

    redacted = redacted.replace(
        /\b[a-z]:[\\/](?:users|documents and settings)[\\/][^\\/\s"'<>]+(?:[\\/][^\r\n"'<>]*)?/gi,
        REDACTION_MARKERS.path,
    )
    redacted = redacted.replace(
        /\/(?:home|users)\/[^/\s"'<>]+(?:\/[^\r\n"'<>]*)?/gi,
        REDACTION_MARKERS.path,
    )
    redacted = redacted.replace(
        /\b[a-z]:[\\/][^\r\n"'<>]+/gi,
        REDACTION_MARKERS.path,
    )

    if (looksLikeAbsolutePath(redacted)) return REDACTION_MARKERS.path

    const minimumLength = options.rawBase64MinimumLength ?? 128
    const compact = redacted.trim()
    const unwrapped = compact.replace(/[\r\n\t ]+/g, '')
    if (
        unwrapped.length >= minimumLength
        && /^[a-z0-9+/_-]+={0,2}$/i.test(unwrapped)
        && (unwrapped === compact || /[\r\n]/.test(compact))
    ) {
        return REDACTION_MARKERS.base64
    }

    return redacted
}

function redactValue(
    value: unknown,
    options: SnapshotRedactionOptions,
    ancestors: Set<object>,
    path: readonly string[],
): unknown {
    if (typeof value === 'string') return redactString(value, options)
    if (value === null || typeof value !== 'object') return value
    if (value instanceof Date) return value.toISOString()
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return REDACTION_MARKERS.binary
    if (isOAuthSession(value)) return REDACTION_MARKERS.oauthSession
    if (ancestors.has(value)) return REDACTION_MARKERS.circular

    ancestors.add(value)
    try {
        if (Array.isArray(value)) {
            return value.map((item, index) => redactValue(item, options, ancestors, [...path, String(index)]))
        }

        const result: Record<string, unknown> = {}
        for (const [key, child] of Object.entries(value)) {
            const marker = sensitiveMarkerForKey(key, child, path)
            result[key] = marker ?? redactValue(child, options, ancestors, [...path, key])
        }
        return result
    } finally {
        ancestors.delete(value)
    }
}

/** Returns a detached snapshot-safe value with credentials and large payloads removed. */
export function redactSnapshot(
    value: unknown,
    options: SnapshotRedactionOptions = {},
): unknown {
    return redactValue(value, options, new Set<object>(), [])
}

/** Redacts first, then produces stable JSON suitable for checked-in fixtures. */
export function redactSnapshotJson(
    value: unknown,
    redactionOptions: SnapshotRedactionOptions = {},
    jsonOptions: StableJsonOptions = {},
): string {
    return stableJsonStringify(redactSnapshot(value, redactionOptions), jsonOptions)
}
