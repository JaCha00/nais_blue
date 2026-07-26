import { parseMetadataFromFile, type NAIMetadata } from '@/lib/metadata-parser'

export const MAX_METADATA_BATCH_FILES = 500
export const MAX_METADATA_FILE_BYTES = 50 * 1024 * 1024

export type MetadataBatchStatus = 'found' | 'empty' | 'failed'

export interface SafeImageMetadata {
    prompt: string
    negativePrompt: string
    promptParts?: {
        base: string
        additional: string
        detail: string
        negative?: string
        inpainting?: string
        workflow?: string
    }
    characterPrompts: Array<{
        prompt: string
        centers: Array<{ x: number; y: number }>
    }>
    negativeCharacterPrompts: Array<{
        prompt: string
        centers: Array<{ x: number; y: number }>
    }>
    model?: string
    steps?: number
    cfgScale?: number
    cfgRescale?: number
    seed?: number
    sampler?: string
    scheduler?: string
    smea?: boolean
    smeaDyn?: boolean
    variety?: boolean
    qualityToggle?: boolean
    ucPreset?: number
    width?: number
    height?: number
    source?: 'text_chunk' | 'stealth_alpha'
    metadataVersion?: 1 | 2
    hasVibeTransfer: boolean
    hasCharacterReference: boolean
    vibeTransferInfo: Array<{ strength: number; informationExtracted: number }>
    characterReferenceInfo: Array<{ strength: number; informationExtracted: number }>
}

export interface MetadataBatchItem {
    id: string
    index: number
    fileName: string
    mimeType: string
    sizeBytes: number
    lastModified: number
    status: MetadataBatchStatus
    metadata: SafeImageMetadata | null
    error: string | null
}

export interface MetadataBatchProgress {
    completed: number
    total: number
    currentFileName: string
}

export interface ReadMetadataBatchOptions {
    signal?: AbortSignal
    onProgress?: (progress: MetadataBatchProgress) => void
    /** Test seams and future native scanners can replace the current browser parser. */
    parse?: (file: File) => Promise<NAIMetadata | null>
    yieldToUi?: () => Promise<void>
}

/**
 * Depends only on the event-loop timer and is shared by sequential batch reads.
 * Timers continue while the window is obscured, unlike animation frames, so a
 * long metadata scan remains cancellable and keeps making progress in background.
 */
export function yieldToMetadataEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function abortError(): Error {
    const error = new Error('Metadata reading was cancelled.')
    error.name = 'AbortError'
    return error
}

function assertBatchInput(files: readonly File[]): void {
    if (files.length > MAX_METADATA_BATCH_FILES) {
        throw new RangeError(`Select at most ${MAX_METADATA_BATCH_FILES} files at once.`)
    }
}

function supportedFile(file: File): boolean {
    const name = file.name.toLowerCase()
    return file.type === 'image/png'
        || file.type === 'image/webp'
        || file.type === 'image/jpeg'
        || name.endsWith('.png')
        || name.endsWith('.webp')
        || name.endsWith('.jpg')
        || name.endsWith('.jpeg')
        || name.endsWith('.nais-blue.json')
        || name.endsWith('.nais2.json')
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function boundedText(value: unknown, maxLength = 1_048_576): string {
    if (typeof value !== 'string') return ''
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}

/**
 * Projects parser output into a local, export-safe record. The parser may carry
 * raw chunks and encoded vibe bytes; this boundary deliberately keeps prompts
 * and generation parameters while excluding image/base64/debug payloads.
 */
export function projectSafeImageMetadata(metadata: NAIMetadata): SafeImageMetadata {
    const v4Prompt = metadata.v4_prompt?.caption
    const v4Negative = metadata.v4_negative_prompt?.caption
    const prompt = boundedText(v4Prompt?.base_caption ?? metadata.prompt ?? metadata.promptParts?.base)
    const negativePrompt = boundedText(
        v4Negative?.base_caption ?? metadata.negativePrompt ?? metadata.promptParts?.negative,
    )

    return {
        prompt,
        negativePrompt,
        ...(metadata.promptParts === undefined ? {} : {
            promptParts: {
                base: boundedText(metadata.promptParts.base),
                additional: boundedText(metadata.promptParts.additional),
                detail: boundedText(metadata.promptParts.detail),
                ...(metadata.promptParts.negative === undefined
                    ? {} : { negative: boundedText(metadata.promptParts.negative) }),
                ...(metadata.promptParts.inpainting === undefined
                    ? {} : { inpainting: boundedText(metadata.promptParts.inpainting) }),
                ...(metadata.promptParts.workflow === undefined
                    ? {} : { workflow: boundedText(metadata.promptParts.workflow) }),
            },
        }),
        characterPrompts: (v4Prompt?.char_captions ?? []).map(entry => ({
            prompt: boundedText(entry.char_caption),
            centers: entry.centers.map(center => ({ x: center.x, y: center.y })),
        })),
        negativeCharacterPrompts: (v4Negative?.char_captions ?? []).map(entry => ({
            prompt: boundedText(entry.char_caption),
            centers: entry.centers.map(center => ({ x: center.x, y: center.y })),
        })),
        ...(metadata.model === undefined ? {} : { model: boundedText(metadata.model, 256) }),
        ...(metadata.steps === undefined ? {} : { steps: metadata.steps }),
        ...(metadata.cfgScale === undefined ? {} : { cfgScale: metadata.cfgScale }),
        ...(metadata.cfgRescale === undefined ? {} : { cfgRescale: metadata.cfgRescale }),
        ...(metadata.seed === undefined ? {} : { seed: metadata.seed }),
        ...(metadata.sampler === undefined ? {} : { sampler: boundedText(metadata.sampler, 128) }),
        ...(metadata.scheduler === undefined ? {} : { scheduler: boundedText(metadata.scheduler, 128) }),
        ...(metadata.smea === undefined ? {} : { smea: metadata.smea }),
        ...(metadata.smeaDyn === undefined ? {} : { smeaDyn: metadata.smeaDyn }),
        ...(metadata.variety === undefined ? {} : { variety: metadata.variety }),
        ...(metadata.qualityToggle === undefined ? {} : { qualityToggle: metadata.qualityToggle }),
        ...(metadata.ucPreset === undefined ? {} : { ucPreset: metadata.ucPreset }),
        ...(metadata.width === undefined ? {} : { width: metadata.width }),
        ...(metadata.height === undefined ? {} : { height: metadata.height }),
        ...(metadata.source === undefined ? {} : { source: metadata.source }),
        ...(metadata.metadataVersion === undefined ? {} : { metadataVersion: metadata.metadataVersion }),
        hasVibeTransfer: metadata.hasVibeTransfer === true,
        hasCharacterReference: metadata.hasCharacterReference === true,
        vibeTransferInfo: (metadata.vibeTransferInfo ?? []).map(entry => ({ ...entry })),
        characterReferenceInfo: (metadata.characterReferenceInfo ?? []).map(entry => ({ ...entry })),
    }
}

function fileId(file: File, index: number): string {
    return `${index}:${file.name}:${file.size}:${file.lastModified}`
}

function failedItem(file: File, index: number, error: unknown): MetadataBatchItem {
    return {
        id: fileId(file, index),
        index,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        lastModified: file.lastModified,
        status: 'failed',
        metadata: null,
        error: message(error),
    }
}

/**
 * Reads files sequentially so a large selection does not hold several decoded
 * images at once. Progress and cooperative yielding connect the parser to the
 * Data Hub without making the parsing service depend on React.
 */
export async function readMetadataBatch(
    files: readonly File[],
    options: ReadMetadataBatchOptions = {},
): Promise<MetadataBatchItem[]> {
    assertBatchInput(files)
    const parse = options.parse ?? parseMetadataFromFile
    const yieldToUi = options.yieldToUi ?? yieldToMetadataEventLoop
    const items: MetadataBatchItem[] = []

    for (const [index, file] of files.entries()) {
        if (options.signal?.aborted) throw abortError()
        let item: MetadataBatchItem
        try {
            if (!supportedFile(file)) throw new TypeError('PNG, WebP, JPEG 또는 NAIS sidecar JSON만 지원합니다.')
            if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_METADATA_FILE_BYTES) {
                throw new RangeError('파일 크기는 0바이트보다 크고 50MB 이하여야 합니다.')
            }
            const parsed = await parse(file)
            item = {
                id: fileId(file, index),
                index,
                fileName: file.name,
                mimeType: file.type || 'application/octet-stream',
                sizeBytes: file.size,
                lastModified: file.lastModified,
                status: parsed === null ? 'empty' : 'found',
                metadata: parsed === null ? null : projectSafeImageMetadata(parsed),
                error: null,
            }
        } catch (error) {
            item = failedItem(file, index, error)
        }
        items.push(item)
        options.onProgress?.({
            completed: index + 1,
            total: files.length,
            currentFileName: file.name,
        })
        await yieldToUi()
    }

    return items
}

export function metadataBatchSummary(items: readonly MetadataBatchItem[]): Record<MetadataBatchStatus, number> {
    return items.reduce<Record<MetadataBatchStatus, number>>((summary, item) => {
        summary[item.status] += 1
        return summary
    }, { found: 0, empty: 0, failed: 0 })
}

export function serializeMetadataBatchJson(items: readonly MetadataBatchItem[], generatedAt = new Date().toISOString()): string {
    return JSON.stringify({
        schemaVersion: 1,
        generatedAt,
        summary: metadataBatchSummary(items),
        items,
    }, null, 2)
}

function csvCell(value: unknown): string {
    const plain = value === undefined || value === null ? '' : String(value)
    // Spreadsheet apps can execute formula-like text even when it is quoted;
    // prefixing user-controlled prompt/file cells keeps CSV export inert.
    const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(plain) ? `'${plain}` : plain
    return `"${text.replace(/"/g, '""')}"`
}

export function serializeMetadataBatchCsv(items: readonly MetadataBatchItem[]): string {
    const columns = [
        'fileName', 'status', 'error', 'prompt', 'negativePrompt', 'model', 'steps',
        'cfgScale', 'cfgRescale', 'seed', 'sampler', 'scheduler', 'width', 'height',
        'hasVibeTransfer', 'hasCharacterReference',
    ] as const
    const rows = items.map(item => {
        const metadata = item.metadata
        const values: Record<typeof columns[number], unknown> = {
            fileName: item.fileName,
            status: item.status,
            error: item.error,
            prompt: metadata?.prompt,
            negativePrompt: metadata?.negativePrompt,
            model: metadata?.model,
            steps: metadata?.steps,
            cfgScale: metadata?.cfgScale,
            cfgRescale: metadata?.cfgRescale,
            seed: metadata?.seed,
            sampler: metadata?.sampler,
            scheduler: metadata?.scheduler,
            width: metadata?.width,
            height: metadata?.height,
            hasVibeTransfer: metadata?.hasVibeTransfer,
            hasCharacterReference: metadata?.hasCharacterReference,
        }
        return columns.map(column => csvCell(values[column])).join(',')
    })
    return `\uFEFF${columns.map(csvCell).join(',')}\r\n${rows.join('\r\n')}`
}
