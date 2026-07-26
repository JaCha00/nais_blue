import type { JsonValue } from '@/domain/composition/types'
import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'

export const STYLE_PREVIEW_ASSET_SCHEMA_VERSION = 1 as const

export type StylePreviewAssetSource = 'generated' | 'imported'
export type StylePreviewVerificationState = 'unverified' | 'source-only' | 'context-verified'

export interface StylePreviewAsset {
    schemaVersion: typeof STYLE_PREVIEW_ASSET_SCHEMA_VERSION
    id: string
    comboId: string
    sha256: string
    mimeType: 'image/png' | 'image/webp'
    byteSize: number
    source: StylePreviewAssetSource
    vaultRef: string
    thumbnail?: string
    contextId: string | null
    seed: number | null
    verificationState: StylePreviewVerificationState
    rawMetadata: JsonValue | null
    normalizedMetadata: JsonValue | null
    createdAt: number
}

export interface CreateStylePreviewAssetInput extends Omit<StylePreviewAsset, 'schemaVersion' | 'id'> {
    id?: string
}

/** Preview assets are immutable links; replacement creates another 1:N record. */
export function createStylePreviewAsset(input: CreateStylePreviewAssetInput): StylePreviewAsset {
    if (!input.comboId.trim()) throw new TypeError('Preview asset comboId must not be empty')
    if (!/^sha256:[a-f0-9]{64}$/i.test(input.sha256)) throw new TypeError('Preview asset SHA-256 is invalid')
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
        throw new TypeError('Preview asset byteSize must be a non-negative integer')
    }
    if (!input.vaultRef.trim()) throw new TypeError('Preview asset vaultRef must not be empty')
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
        throw new TypeError('Preview asset createdAt must be a non-negative integer')
    }
    if (input.verificationState === 'context-verified' && (!input.contextId || input.seed === null)) {
        throw new TypeError('Context-verified assets require contextId and seed')
    }
    const id = input.id?.trim() || `style-asset:${hashCanonicalValue({
        comboId: input.comboId,
        sha256: input.sha256.toLowerCase(),
        contextId: input.contextId,
        seed: input.seed,
    })}`
    return Object.freeze({
        ...input,
        schemaVersion: STYLE_PREVIEW_ASSET_SCHEMA_VERSION,
        id,
        comboId: input.comboId.trim(),
        sha256: input.sha256.toLowerCase(),
        vaultRef: input.vaultRef.trim(),
    })
}

export function isStylePreviewAsset(value: unknown): value is StylePreviewAsset {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const asset = value as Partial<StylePreviewAsset>
    return asset.schemaVersion === STYLE_PREVIEW_ASSET_SCHEMA_VERSION
        && typeof asset.id === 'string'
        && asset.id.length > 0
        && typeof asset.comboId === 'string'
        && asset.comboId.length > 0
        && typeof asset.sha256 === 'string'
        && /^sha256:[a-f0-9]{64}$/i.test(asset.sha256)
        && (asset.mimeType === 'image/png' || asset.mimeType === 'image/webp')
        && Number.isSafeInteger(asset.byteSize)
        && (asset.byteSize as number) >= 0
        && (asset.source === 'generated' || asset.source === 'imported')
        && typeof asset.vaultRef === 'string'
        && asset.vaultRef.length > 0
        && (asset.thumbnail === undefined || typeof asset.thumbnail === 'string')
        && (asset.contextId === null || typeof asset.contextId === 'string')
        && (asset.seed === null || Number.isSafeInteger(asset.seed))
        && (asset.verificationState === 'unverified'
            || asset.verificationState === 'source-only'
            || asset.verificationState === 'context-verified')
        && Number.isSafeInteger(asset.createdAt)
        && (asset.createdAt as number) >= 0
}
