import type { ResolvedGenerationFolder } from '@/domain/generation-folders'
import {
    assertMetadataStripped,
    extractImageMetadataSegments,
    scanImageMetadata,
    type OrganizerImageFormat,
} from '@/domain/organizer/metadata-sanitizer'
import type { OrganizerSourceImageFormat } from '@/domain/organizer/types'
import { DEFAULT_R2_PROFILE_ID } from '@/domain/r2/types'
import { sha256Bytes } from '@/lib/binary-digest'
import { eradicateImageMetadata } from '@/lib/image-metadata-purge'
import { parseNAIMetadata } from '@/lib/metadata-parser'
import { imageDataUrlFromBytes } from '@/lib/image-data-url'
import { toSidecarFileName } from '@/services/output/filename-policy'
import { getRuntimeOutputWriter, type OutputWriteResult } from '@/services/output/output-writer'
import {
    CanvasOrganizerImageTranscoder,
    type OrganizerImageTranscoder,
} from '@/services/organizer/image-transcoder'
import {
    releaseLocalImageToR2,
    type GeneratedR2ReleaseResult,
} from '@/services/r2/generated-release'
import { getRuntimeR2UploadRepository } from '@/services/r2/runtime'

export type LibraryImageFormatChoice = 'keep' | 'png' | 'webp'

export interface LibraryImageSource {
    readonly name: string
    readonly bytes: Uint8Array
}

export interface LibraryImageWorkflowRequest {
    readonly source: LibraryImageSource
    readonly destination: ResolvedGenerationFolder
    readonly format: LibraryImageFormatChoice
    readonly stripMetadata: boolean
    readonly autoUpload: boolean
    readonly r2ProfileId?: string
}

export interface LibraryImageWorkflowResult {
    readonly operationId: string
    readonly output: OutputWriteResult
    readonly format: 'png' | 'webp'
    readonly width: number
    readonly height: number
    readonly sidecarPath: string | null
    readonly r2: GeneratedR2ReleaseResult | null
}

interface LibraryImageWorkflowDependencies {
    readonly transcoder: OrganizerImageTranscoder
    readonly now: () => Date
}

const DEFAULT_DEPENDENCIES: LibraryImageWorkflowDependencies = {
    transcoder: new CanvasOrganizerImageTranscoder(),
    now: () => new Date(),
}

function sourceFormat(scanFormat: OrganizerImageFormat): OrganizerSourceImageFormat {
    if (scanFormat === 'png' || scanFormat === 'webp' || scanFormat === 'jpeg') return scanFormat
    throw new TypeError('지원하지 않는 이미지 형식입니다. PNG, WebP 또는 JPEG를 선택해 주세요.')
}

export function resolveLibraryTargetFormat(
    source: OrganizerSourceImageFormat,
    choice: LibraryImageFormatChoice,
): 'png' | 'webp' {
    if (choice !== 'keep') return choice
    return source === 'webp' ? 'webp' : 'png'
}

function sourceStem(fileName: string): string {
    const name = fileName.replace(/^.*[\\/]/u, '').replace(/\.[^.]+$/u, '').trim()
    return name || 'image'
}

export function libraryOutputFileName(
    sourceName: string,
    source: OrganizerSourceImageFormat,
    target: 'png' | 'webp',
    stripMetadata: boolean,
): string {
    const suffix = stripMetadata && source === target ? '-clean' : ''
    return `${sourceStem(sourceName)}${suffix}.${target}`
}

async function prepareImage(
    request: LibraryImageWorkflowRequest,
    source: OrganizerSourceImageFormat,
    target: 'png' | 'webp',
    dependencies: LibraryImageWorkflowDependencies,
): Promise<Uint8Array> {
    if (request.stripMetadata) {
        const sanitized = await eradicateImageMetadata(
            imageDataUrlFromBytes(request.source.bytes, request.source.name),
            target,
        )
        assertMetadataStripped(sanitized.bytes)
        return sanitized.bytes
    }
    if (source === target) return new Uint8Array(request.source.bytes)
    return dependencies.transcoder.transcode({
        sourceBytes: request.source.bytes,
        sourceFormat: source,
        targetFormat: target,
        webpLossless: false,
        quality: 0.99,
        alphaPolicy: 'preserve',
        matteColor: '#ffffff',
    })
}

async function auditSidecar(input: {
    readonly operationId: string
    readonly request: LibraryImageWorkflowRequest
    readonly source: OrganizerSourceImageFormat
    readonly target: 'png' | 'webp'
    readonly outputBytes: Uint8Array
    readonly createdAt: string
}): Promise<Uint8Array> {
    const sourceChecksum = await sha256Bytes(input.request.source.bytes)
    const outputChecksum = await sha256Bytes(input.outputBytes)
    const extractedNaiMetadata = await parseNAIMetadata(input.request.source.bytes).catch(() => null)
    return new TextEncoder().encode(JSON.stringify({
        format: 'nai-blue-library-image-release',
        version: 1,
        operationId: input.operationId,
        createdAt: input.createdAt,
        source: {
            fileName: input.request.source.name,
            format: input.source,
            byteSize: input.request.source.bytes.byteLength,
            contentChecksum: sourceChecksum,
            container: scanImageMetadata(input.request.source.bytes),
            containerSegments: extractImageMetadataSegments(input.request.source.bytes),
            metadata: extractedNaiMetadata,
        },
        result: {
            format: input.target,
            byteSize: input.outputBytes.byteLength,
            contentChecksum: outputChecksum,
            metadataStripped: input.request.stripMetadata,
        },
    }, null, 2))
}

/** Creates a verified copy. The source file is never renamed, overwritten, or deleted. */
export async function runLibraryImageWorkflow(
    request: LibraryImageWorkflowRequest,
    dependencies: LibraryImageWorkflowDependencies = DEFAULT_DEPENDENCIES,
): Promise<LibraryImageWorkflowResult> {
    let effectiveRequest = request
    if (request.autoUpload && !request.stripMetadata) {
        const profile = await getRuntimeR2UploadRepository()
            .getProfile(request.r2ProfileId ?? DEFAULT_R2_PROFILE_ID)
            .catch(() => null)
        if (profile !== null && profile.publicMode !== 'private') {
            effectiveRequest = { ...request, stripMetadata: true }
        }
    }
    const scan = scanImageMetadata(request.source.bytes)
    const source = sourceFormat(scan.format)
    const target = resolveLibraryTargetFormat(source, request.format)
    const operationId = crypto.randomUUID()
    const createdAt = dependencies.now().toISOString()
    const outputBytes = await prepareImage(effectiveRequest, source, target, dependencies)
    const outputScan = scanImageMetadata(outputBytes)
    if (outputScan.format !== target) throw new Error('변환된 이미지 형식을 확인하지 못했습니다.')

    const requiresSidecar = effectiveRequest.stripMetadata || source !== target || request.autoUpload
    const sidecarBytes = requiresSidecar
        ? await auditSidecar({ operationId, request: effectiveRequest, source, target, outputBytes, createdAt })
        : undefined
    const decoded = await dependencies.transcoder.decode(outputBytes, target)
    const outcome = await getRuntimeOutputWriter().write({
        transactionId: `library-${operationId}`,
        destination: {
            directory: request.destination.directory,
            useAbsolutePath: request.destination.useAbsolutePath,
            workflowDefaultDirectory: 'NAI_Blue_Library',
            fileName: libraryOutputFileName(request.source.name, source, target, effectiveRequest.stripMetadata),
            extension: target,
            collisionPolicy: 'unique',
        },
        imageBytes: outputBytes,
        imageDataUrl: imageDataUrlFromBytes(outputBytes, `image.${target}`),
        ...(sidecarBytes === undefined ? {} : { metadataSidecarBytes: sidecarBytes }),
        includeFinalImageFacts: true,
        canCommit: () => true,
        commitWorkflow: () => undefined,
    })
    if (outcome.status !== 'committed' || outcome.result.finalImage === undefined) {
        throw new Error('이미지 저장이 완료되지 않았습니다.')
    }

    let r2: GeneratedR2ReleaseResult | null = null
    if (request.autoUpload) {
        r2 = await releaseLocalImageToR2({
            profileId: request.r2ProfileId ?? DEFAULT_R2_PROFILE_ID,
            sourceId: `library:${operationId}`,
            image: {
                localPath: outcome.result.file.displayPath,
                fileName: outcome.result.fileName,
                contentSha256: outcome.result.finalImage.contentChecksum,
                contentType: `image/${target}`,
                size: outcome.result.finalImage.byteSize,
            },
            ...(sidecarBytes === undefined || outcome.result.sidecarPath === undefined
                ? {}
                : {
                    sidecar: {
                        localPath: outcome.result.sidecarPath,
                        fileName: toSidecarFileName(outcome.result.fileName),
                        contentSha256: await sha256Bytes(sidecarBytes),
                        contentType: 'application/json',
                        size: sidecarBytes.byteLength,
                    },
                }),
            bucket: request.destination.r2.bucket,
            prefix: request.destination.r2.prefix,
        }).catch<GeneratedR2ReleaseResult>(() => ({ status: 'pending-or-failed', failed: 1, pending: 0 }))
    }

    return {
        operationId,
        output: outcome.result,
        format: target,
        width: decoded.width,
        height: decoded.height,
        sidecarPath: outcome.result.sidecarPath ?? null,
        r2,
    }
}
