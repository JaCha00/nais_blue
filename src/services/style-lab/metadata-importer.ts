import type { JsonValue } from '@/domain/composition/types'
import type { StylePreviewAsset } from '@/domain/style-lab'
import { createStylePreviewAsset } from '@/domain/style-lab'
import type { StyleLabRepository } from '@/application/style-lab/style-lab-repository'
import {
    extractArtistTagsFromText,
    normalizePromptTag,
    type WeightedPromptTag,
} from '@/lib/style-lab'
import { parseMetadataFromFile, type NAIMetadata } from '@/lib/metadata-parser'
import type { StyleLabVault } from './style-lab-vault'

const MAX_IMPORT_BYTES = 50 * 1024 * 1024

export interface StyleImportFile {
    name: string
    type: string
    size: number
    arrayBuffer(): Promise<ArrayBuffer>
}

export interface StyleImportDraft {
    id: string
    fileName: string
    mimeType: 'image/png' | 'image/webp'
    sha256: string
    bytes: Uint8Array
    tags: WeightedPromptTag[]
    includedTagKeys: string[]
    rawMetadata: JsonValue | null
    normalizedMetadata: JsonValue | null
    duplicateAssetIds: string[]
}

function jsonCopy(value: unknown): JsonValue | null {
    if (value === undefined || value === null) return null
    return JSON.parse(JSON.stringify(value)) as JsonValue
}

function normalizedMetadata(metadata: NAIMetadata | null): JsonValue | null {
    if (metadata === null) return null
    return jsonCopy({
        prompt: metadata.v4_prompt?.caption?.base_caption ?? metadata.prompt ?? '',
        negativePrompt: metadata.negativePrompt ?? '',
        model: metadata.model ?? null,
        sampler: metadata.sampler ?? null,
        seed: metadata.seed ?? null,
        steps: metadata.steps ?? null,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
    })
}

function metadataTags(metadata: NAIMetadata | null): WeightedPromptTag[] {
    if (metadata === null) return []
    const prompts = [
        metadata.v4_prompt?.caption?.base_caption,
        metadata.prompt,
        metadata.promptParts?.base,
        metadata.promptParts?.additional,
        metadata.promptParts?.detail,
    ].filter((value): value is string => Boolean(value?.trim()))
    const unique = new Map<string, WeightedPromptTag>()
    for (const rawTag of extractArtistTagsFromText(prompts.join(', '))) {
        const tag = normalizePromptTag(rawTag)
        if (tag.tag) unique.set(`${tag.kind}:${tag.tag.toLowerCase()}`, tag)
    }
    return [...unique.values()]
}

/** Creates one independent draft per image; bytes stay ephemeral until review commits them. */
export async function prepareStyleImportDrafts(input: {
    files: readonly StyleImportFile[]
    repository: StyleLabRepository
}): Promise<StyleImportDraft[]> {
    const drafts: StyleImportDraft[] = []
    for (const [index, file] of input.files.entries()) {
        const mimeType = file.type === 'image/webp' ? 'image/webp' : file.type === 'image/png' ? 'image/png' : null
        if (mimeType === null) throw new TypeError(`Unsupported Style-Lab import type: ${file.type || file.name}`)
        if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
            throw new RangeError(`Style-Lab import size is invalid: ${file.name}`)
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (bytes.byteLength !== file.size) throw new Error(`Style-Lab import size changed while reading: ${file.name}`)
        const { hashQueueResourceBytes } = await import('@/services/queue/queue-resource-materializer')
        const sha256 = await hashQueueResourceBytes(bytes)
        const metadata = await parseMetadataFromFile(file as File)
        const tags = metadataTags(metadata)
        drafts.push({
            id: `style-import:${sha256}:${index}`,
            fileName: file.name,
            mimeType,
            sha256,
            bytes,
            tags,
            includedTagKeys: tags.map(tag => `${tag.kind}:${tag.tag.toLowerCase()}`),
            rawMetadata: jsonCopy(metadata),
            normalizedMetadata: normalizedMetadata(metadata),
            duplicateAssetIds: (await input.repository.findPreviewAssetsBySha256(sha256)).map(asset => asset.id),
        })
    }
    return drafts
}

export interface CommitStyleImportResult {
    imported: StylePreviewAsset[]
    skipped: string[]
}

/** Vault commit precedes the immutable Repository link; imported images remain source-only. */
export async function commitStyleImportDrafts(input: {
    drafts: readonly StyleImportDraft[]
    repository: StyleLabRepository
    vault: StyleLabVault
    resolveCombination(tags: WeightedPromptTag[], draft: StyleImportDraft): string | null
    now?: () => number
}): Promise<CommitStyleImportResult> {
    const imported: StylePreviewAsset[] = []
    const skipped: string[] = []
    const committedHashes = new Set<string>()
    for (const draft of input.drafts) {
        if (draft.duplicateAssetIds.length > 0 || committedHashes.has(draft.sha256)) {
            skipped.push(draft.fileName)
            continue
        }
        const selected = draft.tags.filter(tag => draft.includedTagKeys.includes(`${tag.kind}:${tag.tag.toLowerCase()}`))
        if (selected.length === 0) {
            skipped.push(draft.fileName)
            continue
        }
        const comboId = input.resolveCombination(selected, draft)
        if (comboId === null) {
            skipped.push(draft.fileName)
            continue
        }
        const record = await input.vault.putOriginal(draft.bytes, draft.mimeType)
        if (record.sha256 !== draft.sha256) {
            throw new Error(`Style-Lab import bytes changed after review: ${draft.fileName}`)
        }
        const asset = createStylePreviewAsset({
            comboId,
            sha256: record.sha256,
            mimeType: record.mimeType,
            byteSize: record.byteSize,
            source: 'imported',
            vaultRef: record.vaultRef,
            contextId: null,
            seed: null,
            verificationState: 'source-only',
            rawMetadata: draft.rawMetadata,
            normalizedMetadata: draft.normalizedMetadata,
            createdAt: input.now?.() ?? Date.now(),
        })
        await input.repository.putPreviewAsset(asset)
        imported.push(asset)
        committedHashes.add(draft.sha256)
    }
    return { imported, skipped }
}
