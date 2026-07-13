/**
 * Inject/read NAIS2-specific metadata into PNG tEXt chunks.
 *
 * NAI does not echo qualityToggle/ucPreset into the image Comment JSON,
 * so we embed them ourselves (keyword: "nais2-params", value: base64 of JSON)
 * to guarantee round-trip when re-importing our own images.
 *
 * Format matches the approach used by SDStudio.
 */

import type { CompositionPlanHash } from '@/domain/composition/canonical-serialize'
import type { RandomTraceEntry } from '@/domain/composition/types'

export interface Nais2PromptParts {
    base: string
    additional: string
    detail: string
    negative?: string
    inpainting?: string
    workflow?: string
}

export interface Nais2CharacterMetadata {
    stableId: string
    prompt: string
    negative: string
    enabled: boolean
    positions: Array<{ x: number, y: number }>
}

/**
 * Intentionally closed/allowlisted. Output policies can contain platform or
 * remote credentials, so the metadata schema must never grow by spreading the
 * policy object or accepting an `extensions` bag.
 */
export interface Nais2OutputPolicySummary {
    imageFormat: 'png' | 'webp'
    metadataMode: 'embedded' | 'sidecar-only' | 'strip-and-sidecar'
    destinationKind?: 'default' | 'custom' | 'download' | 'library'
    writesSidecar?: boolean
    writesThumbnail?: boolean
    filenameTemplateId?: string
    collisionPolicy?: 'unique' | 'overwrite' | 'error'
}

export interface Nais2ResolvedParams {
    model: string
    width: number
    height: number
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smeaDyn: boolean
    variety: boolean
    seed: number
    qualityToggle?: boolean
    ucPreset?: number
    sourceMode: 'text-to-image' | 'image-to-image' | 'inpaint'
    strength?: number
    noise?: number
    characterPositionEnabled?: boolean
}

interface Nais2ParamsCommon {
    qualityToggle?: boolean
    ucPreset?: number
    promptParts?: Nais2PromptParts
    assetModulePlan?: Record<string, unknown>
    compositionMode?: 'legacy' | 'shadow' | 'v2'
    compositionPlanHash?: CompositionPlanHash
    compositionPlanId?: string
    compositionRecipeId?: string
    compositionProvenanceSummary?: {
        sourceCount: number
        promptContributionCount: number
        randomSelectionCount: number
    }
    compositionRandomTrace?: RandomTraceEntry[]
}

/** Read-compatible contract for images/sidecars emitted before Metadata v2. */
export interface Nais2ParamsV1 extends Nais2ParamsCommon {
    version?: 1
    /** @deprecated v2 persists only redactedPayloadHash; diagnostics use a separate opt-in sidecar. */
    sentPayloadSummary?: string
    [k: string]: unknown
}

export interface Nais2ParamsV2 extends Nais2ParamsCommon {
    version: 2
    engineVersion: string
    sourceRevision: number | null
    recipeId: string | null
    planHash: CompositionPlanHash | null
    promptParts: Nais2PromptParts
    characters: Nais2CharacterMetadata[]
    resolvedParams: Nais2ResolvedParams
    randomTrace: RandomTraceEntry[]
    compactProvenance: {
        sourceCount: number
        promptContributionCount: number
        randomSelectionCount: number
    }
    redactedPayloadHash: string | null
    outputPolicySummary: Nais2OutputPolicySummary
}

export type Nais2Params = Nais2ParamsV1 | Nais2ParamsV2

const NAIS2_KEYWORD = 'nais2-params'
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const WEBP_RIFF_SIGNATURE = [82, 73, 70, 70] // "RIFF"
const WEBP_FORMAT_SIGNATURE = [87, 69, 66, 80] // "WEBP"

// CRC32 (IEEE polynomial) — same table PNG spec uses.
const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
        t[n] = c >>> 0
    }
    return t
})()

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

function bytesToBase64(bytes: Uint8Array): string {
    let s = ''
    const chunk = 32768
    for (let i = 0; i < bytes.length; i += chunk) {
        s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))))
    }
    return btoa(s)
}

function isPng(bytes: Uint8Array): boolean {
    if (bytes.length < 8) return false
    for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false
    return true
}

function isWebP(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false
    for (let i = 0; i < 4; i++) if (bytes[i] !== WEBP_RIFF_SIGNATURE[i]) return false
    for (let i = 0; i < 4; i++) if (bytes[i + 8] !== WEBP_FORMAT_SIGNATURE[i]) return false
    return true
}

function withNais2Version(params: Nais2Params): Nais2Params {
    return params.version === 2 ? params : { version: 1, ...params }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function isPromptParts(value: unknown): value is Nais2PromptParts {
    if (!isRecord(value)) return false
    const allowedKeys = new Set(['base', 'additional', 'detail', 'negative', 'inpainting', 'workflow'])
    return Object.keys(value).every(key => allowedKeys.has(key))
        && typeof value.base === 'string'
        && typeof value.additional === 'string'
        && typeof value.detail === 'string'
        && (value.negative === undefined || typeof value.negative === 'string')
        && (value.inpainting === undefined || typeof value.inpainting === 'string')
        && (value.workflow === undefined || typeof value.workflow === 'string')
}

function isPlanHash(value: unknown): value is CompositionPlanHash {
    return isRecord(value)
        && value.version === 'composition-plan-hash-v2'
        && value.algorithm === 'sha256-utf8-v1'
        && value.canonicalization === 'composition-canonical-json-v1'
        && typeof value.digest === 'string'
        && /^[0-9a-f]{64}$/i.test(value.digest)
}

function isCharacter(value: unknown): value is Nais2CharacterMetadata {
    if (!isRecord(value) || typeof value.stableId !== 'string' || value.stableId.length === 0) return false
    if (Object.keys(value).some(key => !['stableId', 'prompt', 'negative', 'enabled', 'positions'].includes(key))) return false
    if (typeof value.prompt !== 'string' || typeof value.negative !== 'string' || typeof value.enabled !== 'boolean') return false
    return Array.isArray(value.positions) && value.positions.every(position => (
        isRecord(position)
        && Object.keys(position).every(key => key === 'x' || key === 'y')
        && isFiniteNumber(position.x)
        && isFiniteNumber(position.y)
        && position.x >= 0
        && position.x <= 1
        && position.y >= 0
        && position.y <= 1
    ))
}

function isResolvedParams(value: unknown): value is Nais2ResolvedParams {
    if (!isRecord(value)) return false
    const allowedKeys = new Set([
        'model', 'width', 'height', 'steps', 'cfgScale', 'cfgRescale', 'sampler', 'scheduler',
        'smea', 'smeaDyn', 'variety', 'seed', 'qualityToggle', 'ucPreset', 'sourceMode',
        'strength', 'noise', 'characterPositionEnabled',
    ])
    return Object.keys(value).every(key => allowedKeys.has(key))
        && typeof value.model === 'string'
        && isFiniteNumber(value.width)
        && value.width > 0
        && isFiniteNumber(value.height)
        && value.height > 0
        && isFiniteNumber(value.steps)
        && value.steps > 0
        && isFiniteNumber(value.cfgScale)
        && isFiniteNumber(value.cfgRescale)
        && typeof value.sampler === 'string'
        && typeof value.scheduler === 'string'
        && typeof value.smea === 'boolean'
        && typeof value.smeaDyn === 'boolean'
        && typeof value.variety === 'boolean'
        && isFiniteNumber(value.seed)
        && ['text-to-image', 'image-to-image', 'inpaint'].includes(String(value.sourceMode))
        && (value.qualityToggle === undefined || typeof value.qualityToggle === 'boolean')
        && (value.ucPreset === undefined || isFiniteNumber(value.ucPreset))
        && (value.strength === undefined || isFiniteNumber(value.strength))
        && (value.noise === undefined || isFiniteNumber(value.noise))
        && (value.characterPositionEnabled === undefined || typeof value.characterPositionEnabled === 'boolean')
}

function isRandomTrace(value: unknown): value is RandomTraceEntry[] {
    return Array.isArray(value) && value.every(entry => (
        isRecord(entry)
        && typeof entry.ruleId === 'string'
        && typeof entry.streamKey === 'string'
        && Number.isInteger(entry.drawIndex)
        && isFiniteNumber(entry.seed)
        && Object.prototype.hasOwnProperty.call(entry, 'result')
    ))
}

function isProvenanceSummary(value: unknown): value is Nais2ParamsV2['compactProvenance'] {
    return isRecord(value)
        && Object.keys(value).every(key => [
            'sourceCount', 'promptContributionCount', 'randomSelectionCount',
        ].includes(key))
        && Number.isInteger(value.sourceCount)
        && Number(value.sourceCount) >= 0
        && Number.isInteger(value.promptContributionCount)
        && Number(value.promptContributionCount) >= 0
        && Number.isInteger(value.randomSelectionCount)
        && Number(value.randomSelectionCount) >= 0
}

function isOutputPolicySummary(value: unknown): value is Nais2OutputPolicySummary {
    if (!isRecord(value)) return false
    const allowedKeys = new Set([
        'imageFormat',
        'metadataMode',
        'destinationKind',
        'writesSidecar',
        'writesThumbnail',
        'filenameTemplateId',
        'collisionPolicy',
    ])
    if (Object.keys(value).some(key => !allowedKeys.has(key))) return false
    return (value.imageFormat === 'png' || value.imageFormat === 'webp')
        && ['embedded', 'sidecar-only', 'strip-and-sidecar'].includes(String(value.metadataMode))
        && (value.destinationKind === undefined
            || ['default', 'custom', 'download', 'library'].includes(String(value.destinationKind)))
        && (value.writesSidecar === undefined || typeof value.writesSidecar === 'boolean')
        && (value.writesThumbnail === undefined || typeof value.writesThumbnail === 'boolean')
        && (value.filenameTemplateId === undefined || typeof value.filenameTemplateId === 'string')
        && (value.collisionPolicy === undefined
            || ['unique', 'overwrite', 'error'].includes(String(value.collisionPolicy)))
}

function isNais2ParamsV2(value: Record<string, unknown>): boolean {
    const allowedKeys = new Set([
        'version',
        'engineVersion',
        'sourceRevision',
        'recipeId',
        'planHash',
        'promptParts',
        'characters',
        'resolvedParams',
        'randomTrace',
        'compactProvenance',
        'redactedPayloadHash',
        'outputPolicySummary',
        'qualityToggle',
        'ucPreset',
        'assetModulePlan',
        'compositionMode',
        'compositionPlanHash',
        'compositionPlanId',
        'compositionRecipeId',
        'compositionProvenanceSummary',
        'compositionRandomTrace',
    ])
    return Object.keys(value).every(key => allowedKeys.has(key))
        && value.version === 2
        && typeof value.engineVersion === 'string'
        && (value.sourceRevision === null || (Number.isInteger(value.sourceRevision) && Number(value.sourceRevision) >= 0))
        && (value.recipeId === null || typeof value.recipeId === 'string')
        && (value.planHash === null || isPlanHash(value.planHash))
        && isPromptParts(value.promptParts)
        && Array.isArray(value.characters)
        && value.characters.every(isCharacter)
        && new Set(value.characters.map(character => (character as Nais2CharacterMetadata).stableId)).size === value.characters.length
        && isResolvedParams(value.resolvedParams)
        && isRandomTrace(value.randomTrace)
        && isProvenanceSummary(value.compactProvenance)
        && (value.redactedPayloadHash === null || /^sha256:[0-9a-f]{64}$/i.test(String(value.redactedPayloadHash)))
        && isOutputPolicySummary(value.outputPolicySummary)
        && (value.qualityToggle === undefined || typeof value.qualityToggle === 'boolean')
        && (value.ucPreset === undefined || isFiniteNumber(value.ucPreset))
        && (value.assetModulePlan === undefined || isRecord(value.assetModulePlan))
        && (value.compositionMode === undefined || ['legacy', 'shadow', 'v2'].includes(String(value.compositionMode)))
        && (value.compositionPlanHash === undefined || isPlanHash(value.compositionPlanHash))
        && (value.compositionPlanId === undefined || typeof value.compositionPlanId === 'string')
        && (value.compositionRecipeId === undefined || typeof value.compositionRecipeId === 'string')
        && (value.compositionProvenanceSummary === undefined || isProvenanceSummary(value.compositionProvenanceSummary))
        && (value.compositionRandomTrace === undefined || isRandomTrace(value.compositionRandomTrace))
}

function isNais2ParamsV1(value: Record<string, unknown>): value is Nais2ParamsV1 {
    if (value.version !== undefined && value.version !== 1) return false
    if (value.qualityToggle !== undefined && typeof value.qualityToggle !== 'boolean') return false
    if (value.ucPreset !== undefined && !isFiniteNumber(value.ucPreset)) return false
    if (value.sentPayloadSummary !== undefined && typeof value.sentPayloadSummary !== 'string') return false
    return value.promptParts === undefined || isPromptParts(value.promptParts)
}

/** Strictly validates v2 while accepting the known legacy v1 shape. */
export function parseNais2Params(value: unknown): Nais2Params | null {
    if (!isRecord(value)) return null
    if (value.version === 2) return isNais2ParamsV2(value) ? value as unknown as Nais2ParamsV2 : null
    return isNais2ParamsV1(value) ? value : null
}

function buildTextChunk(keyword: string, value: string): Uint8Array {
    // tEXt data = keyword (Latin-1) + \0 + value (Latin-1).
    // We wrap value in base64 so non-ASCII JSON stays Latin-1 safe.
    const keywordBytes = new TextEncoder().encode(keyword)
    const valueBytes = new TextEncoder().encode(value)
    const data = new Uint8Array(keywordBytes.length + 1 + valueBytes.length)
    data.set(keywordBytes, 0)
    data[keywordBytes.length] = 0
    data.set(valueBytes, keywordBytes.length + 1)

    const chunk = new Uint8Array(4 + 4 + data.length + 4)
    const dv = new DataView(chunk.buffer)
    dv.setUint32(0, data.length, false)
    chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74  // "tEXt"
    chunk.set(data, 8)
    // CRC covers type + data.
    const crc = crc32(chunk.subarray(4, 8 + data.length))
    dv.setUint32(8 + data.length, crc, false)
    return chunk
}

/**
 * Embed NAIS2-specific params into a PNG (base64 in, base64 out).
 * Inserts a "nais2-params" tEXt chunk immediately after IHDR. If the input is
 * not a valid PNG the original base64 is returned unchanged.
 */
export function embedNais2Params(pngBase64: string, params: Nais2Params): string {
    const bytes = base64ToBytes(pngBase64)
    // PNG tEXt chunks do not exist in WebP. WebP metadata is persisted by
    // callers as a sibling .nais2.json sidecar instead of mutating the image.
    if (isWebP(bytes)) return pngBase64
    if (!isPng(bytes)) return pngBase64

    // Find end of IHDR to know where to splice. IHDR always follows the 8-byte
    // signature: [len(4) "IHDR"(4) data(13) crc(4)] = 25 bytes → ends at 33.
    const ihdrEnd = 8 + 4 + 4 + 13 + 4
    if (bytes.length < ihdrEnd) return pngBase64

    // If an existing nais2-params chunk is present (rare but possible on
    // re-save), strip it before inserting the new one.
    const stripped = stripNais2Chunk(bytes)

    const value = bytesToBase64(new TextEncoder().encode(JSON.stringify(withNais2Version(params))))
    const newChunk = buildTextChunk(NAIS2_KEYWORD, value)

    const out = new Uint8Array(stripped.length + newChunk.length)
    out.set(stripped.subarray(0, ihdrEnd), 0)
    out.set(newChunk, ihdrEnd)
    out.set(stripped.subarray(ihdrEnd), ihdrEnd + newChunk.length)
    return bytesToBase64(out)
}

/**
 * Encode NAIS2 params for a WebP sidecar stored next to the image file.
 * The sidecar mirrors the PNG tEXt payload so importers can restore NAIS2 UI
 * state even when the image format cannot carry our PNG-only metadata chunk.
 */
export function encodeNais2Sidecar(params: Nais2Params): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(withNais2Version(params), null, 2))
}

/** Parse either a legacy or v2 sibling `.nais2.json` sidecar. */
export function readNais2Sidecar(sidecar: Uint8Array | string): Nais2Params | null {
    try {
        const json = typeof sidecar === 'string'
            ? sidecar
            : new TextDecoder('utf-8', { fatal: true }).decode(sidecar)
        return parseNais2Params(JSON.parse(json))
    } catch {
        return null
    }
}

/**
 * Read NAIS2 params (returns null if no nais2-params chunk or decode fails).
 * Accepts PNG bytes (not base64).
 */
export function readNais2Params(bytes: Uint8Array): Nais2Params | null {
    if (!isPng(bytes)) return null

    let off = 8
    while (off + 12 <= bytes.length) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const len = dv.getUint32(off, false)
        if (len > bytes.length - off - 12) return null
        const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])

        if (type === 'tEXt') {
            const data = bytes.subarray(off + 8, off + 8 + len)
            const nullIdx = data.indexOf(0)
            if (nullIdx > 0) {
                const keyword = new TextDecoder('latin1').decode(data.subarray(0, nullIdx))
                if (keyword === NAIS2_KEYWORD) {
                    try {
                        const b64 = new TextDecoder('latin1').decode(data.subarray(nullIdx + 1))
                        const jsonStr = new TextDecoder('utf-8').decode(base64ToBytes(b64))
                        return parseNais2Params(JSON.parse(jsonStr))
                    } catch { return null }
                }
            }
        }

        if (type === 'IEND') break
        off += 12 + len
    }
    return null
}

// Strip any existing nais2-params tEXt chunk so callers can cleanly re-embed.
function stripNais2Chunk(bytes: Uint8Array): Uint8Array {
    if (!isPng(bytes)) return bytes
    const keep: Array<Uint8Array> = [bytes.subarray(0, 8)]
    let off = 8
    while (off + 12 <= bytes.length) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const len = dv.getUint32(off, false)
        const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
        const total = 12 + len
        let drop = false
        if (type === 'tEXt') {
            const data = bytes.subarray(off + 8, off + 8 + len)
            const nullIdx = data.indexOf(0)
            if (nullIdx > 0) {
                const keyword = new TextDecoder('latin1').decode(data.subarray(0, nullIdx))
                if (keyword === NAIS2_KEYWORD) drop = true
            }
        }
        if (!drop) keep.push(bytes.subarray(off, off + total))
        if (type === 'IEND') { off += total; break }
        off += total
    }
    if (off < bytes.length) keep.push(bytes.subarray(off))  // trailer safety
    const total = keep.reduce((n, a) => n + a.length, 0)
    const out = new Uint8Array(total)
    let p = 0
    for (const part of keep) { out.set(part, p); p += part.length }
    return out
}
