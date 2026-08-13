const STYLE_RECORD_SCHEMA = 'nai-style-record/v1'
const MAX_STYLE_CATALOG_RECORDS = 10_000
const MAX_STYLE_RECORD_CHARACTERS = 1_000_000

export interface NaiStyleCatalogCharacter {
    readonly prompt: string
    readonly negative: string
    readonly position: { readonly x: number; readonly y: number }
}

export interface NaiStyleCatalogItem {
    readonly id: string
    readonly title: string
    readonly positive: string
    readonly negative: string
    readonly characters: readonly NaiStyleCatalogCharacter[]
}

export interface NaiStyleCatalog {
    readonly sourceName: string
    readonly items: readonly NaiStyleCatalogItem[]
}

export interface NaiStyleCatalogModuleParts {
    readonly base: string
    readonly negative: string
    readonly character?: string
    readonly 'character-negative'?: string
}

export interface NaiStyleCatalogParseProgress {
    readonly bytesRead: number
    readonly totalBytes: number
    readonly recordsRead: number
}

interface JsonRecord {
    readonly [key: string]: unknown
}

function record(value: unknown): JsonRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : null
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function coordinate(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 0.9
        ? value
        : 0.5
}

function styleCharacter(value: unknown, useCoordinates: boolean): NaiStyleCatalogCharacter | null {
    const source = record(value)
    if (source === null) return null
    const prompt = text(source.prompt)
    const negative = text(source.negative)
    if (!prompt && !negative) return null
    const centers = Array.isArray(source.centers) ? source.centers : []
    const center = record(centers[0])
    return {
        prompt,
        negative,
        position: useCoordinates && center !== null
            ? { x: coordinate(center.x), y: coordinate(center.y) }
            : { x: 0.5, y: 0.5 },
    }
}

function styleItem(value: unknown, index: number): NaiStyleCatalogItem {
    const source = record(value)
    if (source === null || source.schema !== STYLE_RECORD_SCHEMA) {
        throw new TypeError(`Invalid NAI style record at index ${index}`)
    }
    const id = text(source.id)
    const title = text(source.title) || `Style ${index + 1}`
    const positive = text(source.base)
    const negative = text(source.negative)
    if (!id || id.length > 200 || title.length > 500 || (!positive && !negative)) {
        throw new TypeError(`Invalid NAI style record at index ${index}`)
    }

    const params = record(source.params)
    const positionMode = text(params?.position_mode).toLocaleLowerCase()
    // NAI's AI Pick coordinates cannot be reproduced by this private client.
    // Explicit AI mode therefore becomes the neutral center; supplied centers
    // from coordinate or older unspecified records remain usable.
    const useCoordinates = positionMode !== 'ai'
    const characters = (Array.isArray(source.characters) ? source.characters : [])
        .map(character => styleCharacter(character, useCoordinates))
        .filter((character): character is NaiStyleCatalogCharacter => character !== null)

    return { id, title, positive, negative, characters }
}

/**
 * Reads a top-level array one object at a time. Object boundaries are based on
 * JSON string/escape/depth state, never on a field-name text marker.
 */
export async function parseNaiStyleCatalogFile(
    file: File,
    onProgress?: (progress: NaiStyleCatalogParseProgress) => void,
): Promise<NaiStyleCatalog | null> {
    const reader = file.stream().getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const items: NaiStyleCatalogItem[] = []
    let buffer = ''
    let depth = 0
    let inString = false
    let escaped = false
    let state: 'array-start' | 'value-or-end' | 'value' | 'comma-or-end' | 'done' = 'array-start'
    let allowEnd = true
    let recognized = false
    let completed = false
    let bytesRead = 0
    let lastProgressBytes = 0

    const stopAsNonCatalog = async (): Promise<null> => {
        await reader.cancel().catch(() => undefined)
        return null
    }

    const completeValue = (): boolean => {
        let parsed: unknown
        try {
            parsed = JSON.parse(buffer) as unknown
        } catch {
            throw new TypeError(`Invalid NAI style record at index ${items.length}`)
        }
        buffer = ''
        const source = record(parsed)
        if (!recognized && source?.schema !== STYLE_RECORD_SCHEMA) return false
        recognized = true
        if (items.length >= MAX_STYLE_CATALOG_RECORDS) {
            throw new RangeError(`NAI style catalog exceeds ${MAX_STYLE_CATALOG_RECORDS} records`)
        }
        items.push(styleItem(parsed, items.length))
        state = 'comma-or-end'
        return true
    }

    const consume = async (chunk: string): Promise<boolean> => {
        for (const character of chunk) {
            if (state === 'done') {
                if (!/\s/u.test(character)) throw new TypeError('Unexpected content after NAI style catalog')
                continue
            }
            if (state === 'array-start') {
                if (/\s/u.test(character) || character === '\uFEFF') continue
                if (character !== '[') return false
                state = 'value-or-end'
                continue
            }
            if (state === 'value-or-end') {
                if (/\s/u.test(character)) continue
                if (character === ']' && allowEnd) {
                    state = 'done'
                    completed = true
                    continue
                }
                if (character !== '{') {
                    if (recognized) throw new TypeError('Invalid value in NAI style catalog')
                    return false
                }
                buffer = character
                depth = 1
                inString = false
                escaped = false
                state = 'value'
                continue
            }
            if (state === 'comma-or-end') {
                if (/\s/u.test(character)) continue
                if (character === ',') {
                    allowEnd = false
                    state = 'value-or-end'
                    continue
                }
                if (character === ']') {
                    state = 'done'
                    completed = true
                    continue
                }
                throw new TypeError('Invalid separator in NAI style catalog')
            }

            buffer += character
            if (buffer.length > MAX_STYLE_RECORD_CHARACTERS) {
                throw new RangeError(`NAI style record exceeds ${MAX_STYLE_RECORD_CHARACTERS} characters`)
            }
            if (inString) {
                if (escaped) escaped = false
                else if (character === '\\') escaped = true
                else if (character === '"') inString = false
                continue
            }
            if (character === '"') inString = true
            else if (character === '{' || character === '[') depth += 1
            else if (character === '}' || character === ']') depth -= 1
            if (depth < 0) throw new TypeError('Invalid nesting in NAI style catalog')
            if (depth === 0 && !completeValue()) return false
        }
        return true
    }

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bytesRead += value.byteLength
            if (!await consume(decoder.decode(value, { stream: true }))) return stopAsNonCatalog()
            if (recognized && onProgress && (bytesRead - lastProgressBytes >= 256 * 1024 || bytesRead === file.size)) {
                lastProgressBytes = bytesRead
                onProgress({ bytesRead, totalBytes: file.size, recordsRead: items.length })
            }
        }
        if (!await consume(decoder.decode())) return stopAsNonCatalog()
    } finally {
        reader.releaseLock()
    }

    if (!completed) {
        if (!recognized) return null
        throw new TypeError('Incomplete NAI style catalog')
    }
    if (recognized) onProgress?.({ bytesRead, totalBytes: file.size, recordsRead: items.length })
    return recognized ? { sourceName: file.name, items } : null
}

export function naiStyleCatalogModuleName(item: NaiStyleCatalogItem): string {
    const fallback = item.id.replace(/[^a-z0-9_-]/giu, '').slice(-8) || 'imported'
    const suffix = ` · ${fallback}`
    return `${item.title.slice(0, Math.max(1, 120 - suffix.length)).trim()}${suffix}`
}

/** Positions stay job-local. Multiple external character captions are retained
 * as separate paragraphs inside the module's singular character part. */
export function naiStyleCatalogModuleParts(item: NaiStyleCatalogItem): NaiStyleCatalogModuleParts {
    const character = item.characters.map(value => value.prompt).filter(Boolean).join('\n\n')
    const characterNegative = item.characters.map(value => value.negative).filter(Boolean).join('\n\n')
    return {
        base: item.positive,
        negative: item.negative,
        ...(character ? { character } : {}),
        ...(characterNegative ? { 'character-negative': characterNegative } : {}),
    }
}
