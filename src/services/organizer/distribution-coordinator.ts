import { sha256Bytes } from '@/lib/binary-digest'
import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import {
    assertMetadataStripped,
    scanImageMetadata,
    stripImageMetadata,
    verifyDecodedDistribution,
    type DecodedOrganizerImage,
} from '@/domain/organizer/metadata-sanitizer'
import {
    ORGANIZER_SANITIZATION_POLICY_VERSION,
    type ArtifactPortableFileRef,
    type ArtifactRecord,
    type ArtifactRemoteObjectRef,
    type ArtifactSidecarReference,
    type DistributionPolicy,
    type DistributionVariant,
    type OrganizerDistributionFormat,
    type OrganizerSourceImageFormat,
} from '@/domain/organizer/types'
import { childOutputRef, type OutputPlatformAdapter } from '@/services/output/platform-adapter'
import { OutputWriter, type OutputWriteResult } from '@/services/output/output-writer'
import { ensureImageFileExtension, renderFilenameTemplate, splitFileName, toArtifactSidecarPath } from '@/services/output/filename-policy'
import type { NativeR2ScannedArtifact, R2ProfileV2, UploadJob } from '@/domain/r2/types'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { CanvasOrganizerImageTranscoder, dataUrlForOrganizerImage, type OrganizerImageTranscoder } from './image-transcoder'
import { ArtifactRepositoryError, IndexedDBArtifactRepository } from './artifact-repository'

export interface OrganizerR2FollowUpRuntime {
    getProfile(profileId: string): Promise<R2ProfileV2 | null>
    enqueue(profile: R2ProfileV2, artifact: NativeR2ScannedArtifact): Promise<readonly UploadJob[]>
}

export interface ArtifactDistributionCoordinatorOptions {
    readonly repository: IndexedDBArtifactRepository
    readonly platform: OutputPlatformAdapter
    readonly outputWriter?: OutputWriter
    readonly transcoder?: OrganizerImageTranscoder
    readonly r2?: OrganizerR2FollowUpRuntime
    readonly now?: () => Date
    readonly createVariantId?: () => string
}

export interface DistributionRunResult {
    readonly artifactId: string
    readonly variantId: string
    readonly status: DistributionVariant['status']
}

export interface FailedDistributionRunSummary {
    readonly distributionRuns: readonly DistributionRunResult[]
    readonly remoteRetryCount: number
}

export class ArtifactDistributionError extends Error {
    constructor(
        readonly code:
            | 'E_ORGANIZER_SOURCE_CHECKSUM'
            | 'E_ORGANIZER_VARIANT_NOT_RETRYABLE'
            | 'E_ORGANIZER_R2_PROFILE'
            | 'E_ORGANIZER_R2_KEY'
            | 'E_ORGANIZER_OUTPUT_CHECKSUM',
        message: string,
    ) {
        super(message)
        this.name = 'ArtifactDistributionError'
    }
}

function asOutputFormat(format: OrganizerSourceImageFormat): OrganizerDistributionFormat | null {
    return format === 'png' || format === 'webp' ? format : null
}

function sourceMimeType(format: OrganizerSourceImageFormat | OrganizerDistributionFormat): string {
    return format === 'jpeg' ? 'image/jpeg' : `image/${format}`
}

function safeFailure(error: unknown, code: string, now: string): NonNullable<DistributionVariant['failure']> {
    const diagnostic = reportDiagnostic(error, {
        operation: 'organizer.distribution',
        stage: code,
        category: 'image_processing',
    })
    return { code, summary: diagnostic.userSummary, occurredAt: now }
}

function cleanRemoteSegment(value: string): string {
    const segment = value.trim()
    if (!segment || segment === '.' || segment === '..' || /[\\\0]/.test(segment)) {
        throw new ArtifactDistributionError('E_ORGANIZER_R2_KEY', 'R2 distribution key contains an unsafe path segment.')
    }
    return segment
}

function remoteKey(...parts: string[]): string {
    const segments = parts.flatMap(part => part.split('/').filter(Boolean).map(cleanRemoteSegment))
    if (segments.length === 0) throw new ArtifactDistributionError('E_ORGANIZER_R2_KEY', 'R2 distribution key is empty.')
    return segments.join('/')
}

function artifactTransactionId(artifactId: string, variantId: string): string {
    return `organizer-${sha256Utf8(`${artifactId}\u001f${variantId}`).slice(0, 48)}`
}

function sourceFormatFromScan(bytes: Uint8Array): OrganizerSourceImageFormat {
    const format = scanImageMetadata(bytes).format
    if (format === 'png' || format === 'webp' || format === 'jpeg') return format
    throw new ArtifactDistributionError('E_ORGANIZER_SOURCE_CHECKSUM', 'Artifact source is not a supported image format.')
}

function distributionFileName(record: ArtifactRecord, variantId: string, policy: DistributionPolicy): string {
    const originalName = splitFileName(record.original.file.fileName).stem
    const rendered = renderFilenameTemplate({
        template: policy.filenameTemplate,
        fallback: originalName || record.artifactId,
        context: {
            artifactId: record.artifactId,
            sourceJobId: record.sourceJobId ?? '',
            sourceSceneId: record.sourceSceneId ?? '',
            originalName,
            original: { name: originalName, format: record.original.format },
            distribution: { variantId },
        },
    })
    return ensureImageFileExtension(rendered, policy.format) ?? `${record.artifactId}.${policy.format}`
}

function sidecarBytes(record: ArtifactRecord, variant: DistributionVariant, checksum: string): Uint8Array {
    const payload = {
        format: 'nais2-artifact-distribution',
        version: 1,
        artifactId: record.artifactId,
        sourceJobId: record.sourceJobId,
        sourceSceneId: record.sourceSceneId,
        original: {
            format: record.original.format,
            contentChecksum: record.contentChecksum,
        },
        distribution: {
            variantId: variant.variantId,
            format: variant.format,
            contentChecksum: checksum,
            sanitizationPolicyVersion: variant.sanitizationPolicyVersion,
            metadataPolicy: variant.policy.metadataPolicy,
            alphaPolicy: variant.policy.alphaPolicy,
        },
    }
    return new TextEncoder().encode(JSON.stringify(payload, null, 2))
}

function completedSidecar(
    variant: DistributionVariant,
    output: OutputWriteResult,
    digest: string,
): ArtifactSidecarReference {
    if (output.artifactSidecarPath === undefined) {
        throw new ArtifactDistributionError('E_ORGANIZER_OUTPUT_CHECKSUM', 'OutputWriter did not commit the artifact sidecar.')
    }
    return {
        file: { directory: variant.policy.destination, fileName: toArtifactSidecarPath(output.fileName) },
        digest,
    }
}

function asFailedRemote(
    artifactId: string,
    variantId: string,
    profileId: string,
    key: string,
    failure: NonNullable<DistributionVariant['failure']>,
): ArtifactRemoteObjectRef {
    return {
        profileId,
        uploadJobId: null,
        artifactId,
        variantId,
        remoteKey: key,
        state: 'failed',
        updatedAt: failure.occurredAt,
        failure,
    }
}

export class ArtifactDistributionCoordinator {
    private readonly outputWriter: OutputWriter
    private readonly transcoder: OrganizerImageTranscoder
    private readonly now: () => Date
    private readonly createVariantId: () => string
    private readonly cancelled = new Set<string>()

    constructor(private readonly options: ArtifactDistributionCoordinatorOptions) {
        this.outputWriter = options.outputWriter ?? new OutputWriter(options.platform)
        this.transcoder = options.transcoder ?? new CanvasOrganizerImageTranscoder()
        this.now = options.now ?? (() => new Date())
        this.createVariantId = options.createVariantId ?? (() => `distribution-${crypto.randomUUID()}`)
    }

    async createAndRun(artifactId: string, policy: DistributionPolicy): Promise<DistributionRunResult> {
        const record = await this.requireArtifact(artifactId)
        const createdAt = this.now().toISOString()
        const variantId = this.createVariantId()
        const variant: DistributionVariant = {
            variantId,
            status: 'pending',
            file: null,
            requestedFileName: distributionFileName(record, variantId, policy),
            format: policy.format,
            contentChecksum: null,
            size: null,
            sidecar: null,
            policy: structuredClone(policy),
            sanitizationPolicyVersion: ORGANIZER_SANITIZATION_POLICY_VERSION,
            createdAt,
            updatedAt: createdAt,
            failure: null,
        }
        await this.options.repository.addDistribution(artifactId, variant, createdAt)
        return this.runExisting(artifactId, variantId)
    }

    cancel(artifactId: string, variantId: string): void {
        this.cancelled.add(`${artifactId}\u001f${variantId}`)
    }

    async runExisting(artifactId: string, variantId: string): Promise<DistributionRunResult> {
        const key = `${artifactId}\u001f${variantId}`
        this.cancelled.delete(key)
        let running: ArtifactRecord | null = null
        try {
            const initial = await this.requireArtifact(artifactId)
            const variant = initial.distributionVariants.find(candidate => candidate.variantId === variantId)
            if (variant === undefined || !['pending', 'failed', 'cancelled'].includes(variant.status)) {
                throw new ArtifactDistributionError('E_ORGANIZER_VARIANT_NOT_RETRYABLE', 'Only pending, failed, or cancelled distribution items can run.')
            }
            const now = this.now().toISOString()
            running = await this.options.repository.updateDistribution(artifactId, variantId, initial.version, current => ({
                ...current,
                status: 'running',
                updatedAt: now,
                failure: null,
            }), now)
            const activeVariant = this.findVariant(running, variantId)
            const originalBytes = await this.readPortableFile(running.original.file)
            const originalChecksum = await sha256Bytes(originalBytes)
            if (originalChecksum !== running.contentChecksum) {
                throw new ArtifactDistributionError('E_ORGANIZER_SOURCE_CHECKSUM', 'The immutable original checksum no longer matches its recorded artifact.')
            }
            const sourceFormat = sourceFormatFromScan(originalBytes)
            const outputBytes = await this.prepareOutput(originalBytes, sourceFormat, activeVariant.policy)
            const outputChecksum = await sha256Bytes(outputBytes)
            if (activeVariant.policy.metadataPolicy === 'strip') assertMetadataStripped(outputBytes)
            const artifactSidecar = sidecarBytes(running, activeVariant, outputChecksum)
            const artifactSidecarDigest = await sha256Bytes(artifactSidecar)
            const output = await this.outputWriter.write({
                transactionId: artifactTransactionId(artifactId, variantId),
                sourceJobId: running.sourceJobId ?? undefined,
                destination: {
                    portableDirectory: activeVariant.policy.destination,
                    workflowDefaultDirectory: 'nais2/organizer/distributions',
                    fileName: activeVariant.requestedFileName,
                    extension: activeVariant.format,
                    collisionPolicy: activeVariant.policy.collisionPolicy,
                },
                imageBytes: outputBytes,
                imageDataUrl: dataUrlForOrganizerImage(outputBytes, activeVariant.format),
                artifactSidecarBytes: artifactSidecar,
                canCommit: () => !this.cancelled.has(key),
                commitWorkflow: async result => {
                    if (result.contentChecksum !== outputChecksum) {
                        throw new ArtifactDistributionError('E_ORGANIZER_OUTPUT_CHECKSUM', 'OutputWriter checksum did not match the prepared distribution bytes.')
                    }
                    const completedAt = this.now().toISOString()
                    await this.options.repository.updateDistribution(artifactId, variantId, running?.version, current => ({
                        ...current,
                        status: 'succeeded',
                        file: { directory: current.policy.destination, fileName: result.fileName },
                        contentChecksum: outputChecksum,
                        size: outputBytes.byteLength,
                        sidecar: completedSidecar(current, result, artifactSidecarDigest),
                        updatedAt: completedAt,
                        failure: null,
                    }), completedAt)
                },
                rollbackWorkflow: async () => {
                    // The final mutation did not commit, so retain a retryable
                    // failed state after OutputWriter has restored the files.
                    await this.markFailed(artifactId, variantId, 'E_ORGANIZER_OUTPUT_ROLLBACK')
                },
                generateThumbnail: async value => value,
            })
            if (output.status === 'cancelled') {
                await this.markCancelled(artifactId, variantId)
                return { artifactId, variantId, status: 'cancelled' }
            }
            const committed = await this.requireArtifact(artifactId)
            const committedVariant = this.findVariant(committed, variantId)
            await this.enqueueR2FollowUp(committed, committedVariant)
            return { artifactId, variantId, status: 'succeeded' }
        } catch (error) {
            if (this.cancelled.has(key)) {
                await this.markCancelled(artifactId, variantId)
                return { artifactId, variantId, status: 'cancelled' }
            }
            await this.markFailed(artifactId, variantId, error instanceof ArtifactDistributionError ? error.code : 'E_ORGANIZER_DISTRIBUTION')
            return { artifactId, variantId, status: 'failed' }
        } finally {
            this.cancelled.delete(key)
        }
    }

    async retryFailed(artifactIds?: readonly string[]): Promise<FailedDistributionRunSummary> {
        const records = await this.allArtifacts()
        const scope = artifactIds === undefined ? records : records.filter(record => artifactIds.includes(record.artifactId))
        const distributionRuns: DistributionRunResult[] = []
        let remoteRetryCount = 0
        for (const record of scope) {
            for (const variant of record.distributionVariants) {
                if (variant.status !== 'failed') continue
                distributionRuns.push(await this.runExisting(record.artifactId, variant.variantId))
            }
            const refreshed = await this.requireArtifact(record.artifactId)
            for (const remote of refreshed.remoteObjectRefs) {
                if (remote.state !== 'failed') continue
                const variant = refreshed.distributionVariants.find(candidate => candidate.variantId === remote.variantId)
                if (variant?.status !== 'succeeded') continue
                await this.enqueueR2FollowUp(refreshed, variant, remote.remoteKey)
                remoteRetryCount += 1
            }
        }
        return { distributionRuns, remoteRetryCount }
    }

    private async prepareOutput(
        originalBytes: Uint8Array,
        sourceFormat: OrganizerSourceImageFormat,
        policy: DistributionPolicy,
    ): Promise<Uint8Array> {
        const sameFormat = asOutputFormat(sourceFormat) === policy.format
        const rawCopySafe = sameFormat && policy.alphaPolicy === 'preserve'
        if (rawCopySafe) {
            return policy.metadataPolicy === 'strip'
                ? stripImageMetadata(originalBytes)
                : new Uint8Array(originalBytes)
        }
        if (policy.format === 'webp' && policy.webpLossless && !this.transcoder.supportsLosslessWebp) {
            throw new ArtifactDistributionError('E_ORGANIZER_VARIANT_NOT_RETRYABLE', 'Lossless WebP conversion is not supported by this runtime.')
        }
        const before = await this.transcoder.decode(originalBytes, sourceFormat)
        let output = await this.transcoder.transcode({
            sourceBytes: originalBytes,
            sourceFormat,
            targetFormat: policy.format,
            webpLossless: policy.webpLossless,
            quality: policy.quality,
            alphaPolicy: policy.alphaPolicy,
            matteColor: policy.matteColor,
        })
        if (policy.metadataPolicy === 'strip') output = stripImageMetadata(output)
        const after = await this.transcoder.decode(output, policy.format)
        this.verifyVisualContract(before, after, policy)
        return output
    }

    private verifyVisualContract(before: DecodedOrganizerImage, after: DecodedOrganizerImage, policy: DistributionPolicy): void {
        verifyDecodedDistribution({
            before,
            after,
            alphaPolicy: policy.alphaPolicy,
            requireExactColor: policy.format === 'png' || policy.webpLossless,
            maxLossyColorDelta: 12,
        })
    }

    private async enqueueR2FollowUp(record: ArtifactRecord, variant: DistributionVariant, preferredKey?: string): Promise<void> {
        const followUp = variant.policy.r2FollowUp
        if (followUp === null || this.options.r2 === undefined || variant.file === null || variant.contentChecksum === null || variant.size === null) return
        let key = preferredKey ?? remoteKey(followUp.remoteKeyPrefix, variant.file.fileName)
        try {
            const profile = await this.options.r2.getProfile(followUp.profileId)
            if (profile === null) throw new ArtifactDistributionError('E_ORGANIZER_R2_PROFILE', 'The selected R2 profile no longer exists.')
            if (preferredKey === undefined) {
                key = remoteKey(profile.prefix, followUp.remoteKeyPrefix, variant.file.fileName)
            }
            const outputDirectory = await this.options.platform.resolveDirectory({
                portableDirectory: variant.file.directory,
                workflowDefaultDirectory: 'nais2/organizer/distributions',
            })
            const localFile = childOutputRef(outputDirectory, variant.file.fileName)
            const jobs = await this.options.r2.enqueue(profile, {
                artifactId: record.artifactId,
                localVariant: localFile.displayPath,
                remoteKey: key,
                contentSha256: variant.contentChecksum,
                contentType: sourceMimeType(variant.format),
                size: variant.size,
            })
            const job = jobs[0] ?? null
            const now = this.now().toISOString()
            await this.options.repository.replaceRemoteObjectRef(record.artifactId, {
                profileId: profile.id,
                uploadJobId: job?.id ?? null,
                artifactId: record.artifactId,
                variantId: variant.variantId,
                remoteKey: key,
                state: job === null ? 'succeeded' : 'queued',
                updatedAt: now,
                failure: null,
            }, now)
        } catch (error) {
            const now = this.now().toISOString()
            const failure = safeFailure(error, 'E_ORGANIZER_R2_ENQUEUE', now)
            await this.options.repository.replaceRemoteObjectRef(record.artifactId, asFailedRemote(
                record.artifactId,
                variant.variantId,
                followUp.profileId,
                key,
                failure,
            ), now)
        }
    }

    private async readPortableFile(file: ArtifactPortableFileRef): Promise<Uint8Array> {
        const directory = await this.options.platform.resolveDirectory({
            portableDirectory: file.directory,
            workflowDefaultDirectory: 'nais2/organizer',
        })
        return this.options.platform.readFile(childOutputRef(directory, file.fileName))
    }

    private async markFailed(artifactId: string, variantId: string, code: string): Promise<void> {
        try {
            const now = this.now().toISOString()
            await this.options.repository.updateDistribution(artifactId, variantId, undefined, current => ({
                ...current,
                status: 'failed',
                updatedAt: now,
                failure: safeFailure(new Error(code), code, now),
            }), now)
        } catch (error) {
            if (!(error instanceof ArtifactRepositoryError && error.code === 'E_ARTIFACT_VARIANT_NOT_FOUND')) {
                reportDiagnostic(error, { operation: 'organizer.distribution', stage: 'mark-failed', category: 'persistence' })
            }
        }
    }

    private async markCancelled(artifactId: string, variantId: string): Promise<void> {
        try {
            const now = this.now().toISOString()
            await this.options.repository.updateDistribution(artifactId, variantId, undefined, current => ({
                ...current,
                status: 'cancelled',
                updatedAt: now,
                failure: null,
            }), now)
        } catch (error) {
            reportDiagnostic(error, { operation: 'organizer.distribution', stage: 'mark-cancelled', category: 'persistence' })
        }
    }

    private findVariant(record: ArtifactRecord, variantId: string): DistributionVariant {
        const variant = record.distributionVariants.find(candidate => candidate.variantId === variantId)
        if (variant === undefined) throw new ArtifactRepositoryError('E_ARTIFACT_VARIANT_NOT_FOUND', 'Artifact distribution variant was not found.')
        return variant
    }

    private async requireArtifact(artifactId: string): Promise<ArtifactRecord> {
        const record = await this.options.repository.get(artifactId)
        if (record === null) throw new ArtifactRepositoryError('E_ARTIFACT_NOT_FOUND', 'Artifact record was not found.')
        return record
    }

    private async allArtifacts(): Promise<ArtifactRecord[]> {
        const records: ArtifactRecord[] = []
        let cursor: string | null = null
        do {
            const page = await this.options.repository.list({ cursor, limit: 500 })
            records.push(...page.items)
            cursor = page.nextCursor
        } while (cursor !== null)
        return records
    }
}
