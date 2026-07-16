import type { MetadataWriteRequest, OutputMetadataWriter } from './metadata-writer'
import { MetadataWriter } from './metadata-writer'
import {
    ensureImageFileExtension,
    resolveCollisionFileName,
    toArtifactSidecarPath,
    toDiagnosticSidecarPath,
    toSidecarFileName,
    type OutputCollisionPolicy,
} from './filename-policy'
import {
    childOutputRef,
    serializeOutputFileRef,
    type OutputDestinationRequest,
    type OutputFileRef,
    type OutputPlatformAdapter,
    type ResolvedOutputDirectory,
} from './platform-adapter'
import { createRuntimeOutputPlatformAdapter } from './tauri-output-adapter'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { sha256Bytes } from '@/lib/binary-digest'

export type OutputWriterPhase =
    | 'resolve-destination'
    | 'stage-temp-output'
    | 'write-image-temp'
    | 'write-metadata-temp'
    | 'generate-thumbnail-temp'
    | 'can-commit'
    | 'atomic-commit'
    | 'workflow-state-update'
    | 'rollback-cleanup'
    | 'recovery-journal'

export type RecoveryJournalPhase =
    | 'staged'
    | 'image-written'
    | 'metadata-written'
    | 'thumbnail-staged'
    | 'commit-pending'
    | 'files-committed'
    | 'workflow-committed'
    | 'rollback-required'

export interface OutputWriterDestination extends OutputDestinationRequest {
    fileName?: string | null
    extension: 'png' | 'webp'
    collisionPolicy?: OutputCollisionPolicy
}

export interface OutputWriteResult {
    transactionId: string
    fileName: string
    path: string
    file: OutputFileRef
    directory: ResolvedOutputDirectory
    sidecarPath?: string
    diagnosticSidecarPath?: string
    artifactSidecarPath?: string
    /** SHA-256 of the exact final image bytes, after any metadata preparation. */
    contentChecksum?: string
    thumbnailDataUrl?: string
    capabilityFallbackUsed: boolean
    capabilityFallbackReason?: string
    capabilityFallbackAlternative?: string
}

export interface OutputWriterRequest {
    /** Pre-bound by durable queue before any file is staged. */
    transactionId?: string
    /** Stable queue linkage only; never contains prompt or credential material. */
    sourceJobId?: string
    destination: OutputWriterDestination
    imageBytes: Uint8Array
    imageDataUrl: string
    metadata?: MetadataWriteRequest
    /**
     * A non-generation artifact sidecar written in the same journaled
     * transaction as the image.  This is deliberately bytes-only so callers
     * cannot bypass OutputWriter with a direct file write.
     */
    artifactSidecarBytes?: Uint8Array
    generateThumbnail?: (imageDataUrl: string) => Promise<string>
    canCommit: () => boolean
    commitWorkflow: (result: OutputWriteResult) => void | Promise<void>
    rollbackWorkflow?: (result: OutputWriteResult, cause: unknown) => void | Promise<void>
    /**
     * The workflow callback commits an immutable durable authority. Once it
     * succeeds, journal cleanup may be retried but files must never roll back.
     */
    terminalWorkflowCommit?: boolean
    onPhase?: (phase: OutputWriterPhase) => void
}

export type OutputWriterOutcome =
    | { status: 'committed'; result: OutputWriteResult }
    | { status: 'cancelled' }

interface JournalArtifact {
    kind: 'image' | 'sidecar' | 'diagnostic' | 'artifact-sidecar'
    temp: OutputFileRef
    final: OutputFileRef
    backup?: OutputFileRef
    committed: boolean
}

interface OutputRecoveryJournal {
    format: 'nais2-output-transaction'
    version: 1
    transactionId: string
    sourceJobId?: string
    createdAt: string
    updatedAt: string
    phase: RecoveryJournalPhase
    fileName: string
    contentChecksum?: string
    directory: ResolvedOutputDirectory
    artifacts: JournalArtifact[]
    thumbnailStaged: boolean
    commitStarted: boolean
}

export interface OutputRecoveryResult {
    transactionId: string
    action: 'rolled-back' | 'retried' | 'cleaned' | 'missing' | 'failed'
    error?: string
}

export interface PendingQueueOutputTransaction {
    transactionId: string
    sourceJobId: string
    phase: RecoveryJournalPhase
}

export interface RetryRecoveryOptions {
    mode?: 'rollback' | 'retry-workflow'
    canCommit?: () => boolean
    commitWorkflow?: (result: OutputWriteResult) => void | Promise<void>
}

export class OutputWriterError extends Error {
    constructor(
        readonly phase: OutputWriterPhase,
        message: string,
        options?: { cause?: unknown },
    ) {
        super(message)
        this.name = 'OutputWriterError'
        if (options?.cause !== undefined) {
            ;(this as Error & { cause?: unknown }).cause = options.cause
        }
    }
}

/**
 * Links the transaction failure to the cleanup failure using the standard Error.cause chain.
 * Diagnostics depend on that linear chain, so preserving both failures here explains why a
 * recovery journal remains without logging raw platform values or weakening rollback safety.
 */
function rollbackFailureCause(transactionError: unknown, cleanupError: unknown): Error {
    const transactionCause = transactionError instanceof Error
        ? transactionError
        : new Error(`Output transaction failed: ${String(transactionError)}`)
    const cleanupCause = cleanupError instanceof Error
        ? cleanupError
        : new Error(`Output rollback cleanup failed: ${String(cleanupError)}`)
    const linked = new Error(`Rollback cleanup failed: ${cleanupCause.message}`) as Error & { cause?: unknown }
    linked.name = 'OutputRollbackCleanupError'
    linked.cause = transactionCause
    return linked
}

function randomTransactionId(): string {
    const uuid = globalThis.crypto?.randomUUID?.()
    return (uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '')
}

function tempName(fileName: string, transactionId: string, kind: JournalArtifact['kind']): string {
    return `.${fileName}.nais2-txn-${transactionId}.${kind}.tmp`
}

function backupName(fileName: string, transactionId: string): string {
    return `.${fileName}.nais2-txn-${transactionId}.backup`
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseFileRef(value: unknown): OutputFileRef {
    if (!isRecord(value) || typeof value.path !== 'string' || typeof value.displayPath !== 'string') {
        throw new Error('Invalid output journal file reference')
    }
    return {
        path: value.path,
        displayPath: value.displayPath,
        ...(typeof value.baseDir === 'number' ? { baseDir: value.baseDir } : {}),
    }
}

function parseJournal(bytes: Uint8Array): OutputRecoveryJournal {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!isRecord(value)
        || value.format !== 'nais2-output-transaction'
        || value.version !== 1
        || typeof value.transactionId !== 'string'
        || typeof value.createdAt !== 'string'
        || typeof value.updatedAt !== 'string'
        || typeof value.fileName !== 'string'
        || (value.sourceJobId !== undefined
            && (typeof value.sourceJobId !== 'string'
                || value.sourceJobId.length === 0
                || value.sourceJobId.length > 256))
        || !Array.isArray(value.artifacts)
        || !isRecord(value.directory)) {
        throw new Error('Invalid output recovery journal')
    }
    const allowedPhases: RecoveryJournalPhase[] = [
        'staged', 'image-written', 'metadata-written', 'thumbnail-staged',
        'commit-pending', 'files-committed', 'workflow-committed', 'rollback-required',
    ]
    if (!allowedPhases.includes(value.phase as RecoveryJournalPhase)) {
        throw new Error('Invalid output recovery journal phase')
    }
    const directoryRef = parseFileRef(value.directory)
    const directory: ResolvedOutputDirectory = {
        ...directoryRef,
        capabilityFallbackUsed: value.directory.capabilityFallbackUsed === true,
        ...(typeof value.directory.fallbackReason === 'string'
            ? { fallbackReason: value.directory.fallbackReason }
            : {}),
        ...(typeof value.directory.fallbackAlternative === 'string'
            ? { fallbackAlternative: value.directory.fallbackAlternative }
            : {}),
    }
    const artifacts = value.artifacts.map(entry => {
        if (!isRecord(entry)
            || (entry.kind !== 'image'
                && entry.kind !== 'sidecar'
                && entry.kind !== 'diagnostic'
                && entry.kind !== 'artifact-sidecar')) {
            throw new Error('Invalid output recovery journal artifact')
        }
        return {
            kind: entry.kind,
            temp: parseFileRef(entry.temp),
            final: parseFileRef(entry.final),
            ...(entry.backup === undefined ? {} : { backup: parseFileRef(entry.backup) }),
            committed: entry.committed === true,
        } satisfies JournalArtifact
    })
    return {
        format: 'nais2-output-transaction',
        version: 1,
        transactionId: value.transactionId,
        ...(typeof value.sourceJobId === 'string' ? { sourceJobId: value.sourceJobId } : {}),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        phase: value.phase as RecoveryJournalPhase,
        fileName: value.fileName,
        ...(typeof value.contentChecksum === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value.contentChecksum)
            ? { contentChecksum: value.contentChecksum }
            : {}),
        directory,
        artifacts,
        thumbnailStaged: value.thumbnailStaged === true,
        commitStarted: value.commitStarted === true,
    }
}

function resultFromJournal(journal: OutputRecoveryJournal): OutputWriteResult {
    const image = journal.artifacts.find(artifact => artifact.kind === 'image')
    if (image === undefined) throw new Error('Recovery journal has no image artifact')
    const sidecar = journal.artifacts.find(artifact => artifact.kind === 'sidecar')
    const diagnostic = journal.artifacts.find(artifact => artifact.kind === 'diagnostic')
    const artifactSidecar = journal.artifacts.find(artifact => artifact.kind === 'artifact-sidecar')
    return {
        transactionId: journal.transactionId,
        fileName: journal.fileName,
        path: image.final.displayPath,
        file: image.final,
        directory: journal.directory,
        ...(sidecar === undefined ? {} : { sidecarPath: sidecar.final.displayPath }),
        ...(diagnostic === undefined ? {} : { diagnosticSidecarPath: diagnostic.final.displayPath }),
        ...(artifactSidecar === undefined ? {} : { artifactSidecarPath: artifactSidecar.final.displayPath }),
        ...(journal.contentChecksum === undefined ? {} : { contentChecksum: journal.contentChecksum }),
        capabilityFallbackUsed: journal.directory.capabilityFallbackUsed,
        ...(journal.directory.fallbackReason === undefined
            ? {}
            : { capabilityFallbackReason: journal.directory.fallbackReason }),
        ...(journal.directory.fallbackAlternative === undefined
            ? {}
            : { capabilityFallbackAlternative: journal.directory.fallbackAlternative }),
    }
}

export class OutputWriter {
    constructor(
        private readonly platform: OutputPlatformAdapter,
        private readonly metadataWriter: OutputMetadataWriter = new MetadataWriter(),
        private readonly createTransactionId: () => string = randomTransactionId,
        private readonly now: () => Date = () => new Date(),
    ) {}

    private async persistJournal(journal: OutputRecoveryJournal): Promise<void> {
        journal.updatedAt = this.now().toISOString()
        await this.platform.writeJournal(
            journal.transactionId,
            new TextEncoder().encode(JSON.stringify(journal, null, 2)),
        )
    }

    private async safeRemove(file: OutputFileRef): Promise<void> {
        if (await this.platform.exists(file)) await this.platform.remove(file)
    }

    private async rollbackArtifacts(journal: OutputRecoveryJournal): Promise<void> {
        const failures: unknown[] = []
        for (const artifact of [...journal.artifacts].reverse()) {
            try {
                await this.safeRemove(artifact.temp)
                if (artifact.backup !== undefined) {
                    if (await this.platform.exists(artifact.backup)) {
                        await this.safeRemove(artifact.final)
                        await this.platform.rename(artifact.backup, artifact.final)
                    }
                } else if (journal.commitStarted
                    && (artifact.committed || !await this.platform.exists(artifact.temp))) {
                    await this.safeRemove(artifact.final)
                }
            } catch (error) {
                failures.push(error)
            }
        }
        if (failures.length > 0) {
            const error = new Error('Output rollback did not finish') as Error & { causes?: unknown[] }
            error.causes = failures
            throw error
        }
    }

    private async cleanupCompleted(journal: OutputRecoveryJournal): Promise<void> {
        for (const artifact of journal.artifacts) {
            await this.safeRemove(artifact.temp)
            if (artifact.backup !== undefined) await this.safeRemove(artifact.backup)
        }
        await this.platform.removeJournal(journal.transactionId)
    }

    private async cancelStaged(journal: OutputRecoveryJournal): Promise<OutputWriterOutcome> {
        try {
            await this.rollbackArtifacts(journal)
            await this.platform.removeJournal(journal.transactionId)
        } catch (error) {
            journal.phase = 'rollback-required'
            try { await this.persistJournal(journal) } catch { /* retain the last durable journal */ }
            throw new OutputWriterError('rollback-cleanup', 'Cancelled output cleanup failed', { cause: error })
        }
        return { status: 'cancelled' }
    }

    async write(request: OutputWriterRequest): Promise<OutputWriterOutcome> {
        if (!request.canCommit()) return { status: 'cancelled' }

        let phase: OutputWriterPhase = 'resolve-destination'
        let journal: OutputRecoveryJournal | null = null
        const mark = (next: OutputWriterPhase): void => {
            phase = next
            request.onPhase?.(next)
        }

        try {
            mark('resolve-destination')
            const directory = await this.platform.resolveDirectory(request.destination)
            if (!request.canCommit()) return { status: 'cancelled' }
            await this.platform.ensureDirectory(directory)
            if (!request.canCommit()) return { status: 'cancelled' }

            const fallback = `NAIS_${this.now().getTime()}.${request.destination.extension}`
            const requestedFileName = ensureImageFileExtension(
                request.destination.fileName ?? fallback,
                request.destination.extension,
            ) ?? fallback
            const collisionPolicy = request.destination.collisionPolicy ?? 'unique'
            const fileName = await resolveCollisionFileName(requestedFileName, collisionPolicy, async candidate => {
                const imageExists = await this.platform.exists(childOutputRef(directory, candidate))
                if (imageExists) return true
                if (request.metadata !== undefined) {
                    const sidecarNeeded = request.metadata.metadataMode === 'sidecar-only'
                        || request.metadata.metadataMode === 'strip-and-sidecar'
                        || request.metadata.imageFormat === 'webp'
                    if (sidecarNeeded && await this.platform.exists(childOutputRef(directory, toSidecarFileName(candidate)))) {
                        return true
                    }
                }
                return request.artifactSidecarBytes !== undefined
                    && await this.platform.exists(childOutputRef(directory, toArtifactSidecarPath(candidate)))
            })
            const transactionId = request.transactionId ?? this.createTransactionId()
            if (!/^[A-Za-z0-9-]{1,128}$/.test(transactionId)) {
                throw new OutputWriterError(
                    'resolve-destination',
                    'Output transaction identity is not a safe bounded filename component',
                )
            }
            if (request.sourceJobId !== undefined
                && (request.sourceJobId.length === 0 || request.sourceJobId.length > 256)) {
                throw new OutputWriterError('resolve-destination', 'Source job identity is not bounded')
            }
            const prepared = this.metadataWriter.prepare(request.imageBytes, request.metadata)
            // Keep the established generation/output scheduling unchanged.
            // Organizer already opts into a separate artifact sidecar, so only
            // that new path pays the asynchronous byte-digest cost.
            const contentChecksum = request.artifactSidecarBytes === undefined
                ? undefined
                : await sha256Bytes(prepared.imageBytes)
            const imageFinal = childOutputRef(directory, fileName)
            const artifacts: JournalArtifact[] = [{
                kind: 'image',
                temp: childOutputRef(directory, tempName(fileName, transactionId, 'image')),
                final: imageFinal,
                committed: false,
            }]
            if (prepared.sidecarBytes !== undefined) {
                const sidecarName = toSidecarFileName(fileName)
                artifacts.push({
                    kind: 'sidecar',
                    temp: childOutputRef(directory, tempName(sidecarName, transactionId, 'sidecar')),
                    final: childOutputRef(directory, sidecarName),
                    committed: false,
                })
            }
            if (prepared.diagnosticSidecarBytes !== undefined) {
                const diagnosticName = toDiagnosticSidecarPath(fileName)
                artifacts.push({
                    kind: 'diagnostic',
                    temp: childOutputRef(directory, tempName(diagnosticName, transactionId, 'diagnostic')),
                    final: childOutputRef(directory, diagnosticName),
                    committed: false,
                })
            }
            if (request.artifactSidecarBytes !== undefined) {
                const artifactSidecarName = toArtifactSidecarPath(fileName)
                artifacts.push({
                    kind: 'artifact-sidecar',
                    temp: childOutputRef(directory, tempName(artifactSidecarName, transactionId, 'artifact-sidecar')),
                    final: childOutputRef(directory, artifactSidecarName),
                    committed: false,
                })
            }

            mark('stage-temp-output')
            const timestamp = this.now().toISOString()
            journal = {
                format: 'nais2-output-transaction',
                version: 1,
                transactionId,
                ...(request.sourceJobId === undefined ? {} : { sourceJobId: request.sourceJobId }),
                createdAt: timestamp,
                updatedAt: timestamp,
                phase: 'staged',
                fileName,
                ...(contentChecksum === undefined ? {} : { contentChecksum }),
                directory: {
                    ...serializeOutputFileRef(directory),
                    capabilityFallbackUsed: directory.capabilityFallbackUsed,
                    ...(directory.fallbackReason === undefined
                        ? {}
                        : { fallbackReason: directory.fallbackReason }),
                    ...(directory.fallbackAlternative === undefined
                        ? {}
                        : { fallbackAlternative: directory.fallbackAlternative }),
                },
                artifacts,
                thumbnailStaged: false,
                commitStarted: false,
            }
            mark('recovery-journal')
            await this.persistJournal(journal)
            if (!request.canCommit()) return this.cancelStaged(journal)

            mark('write-image-temp')
            await this.platform.writeFile(artifacts[0].temp, prepared.imageBytes)
            journal.phase = 'image-written'
            await this.persistJournal(journal)
            if (!request.canCommit()) return this.cancelStaged(journal)

            mark('write-metadata-temp')
            const sidecarArtifact = artifacts.find(artifact => artifact.kind === 'sidecar')
            if (sidecarArtifact !== undefined && prepared.sidecarBytes !== undefined) {
                await this.platform.writeFile(sidecarArtifact.temp, prepared.sidecarBytes)
            }
            const diagnosticArtifact = artifacts.find(artifact => artifact.kind === 'diagnostic')
            if (diagnosticArtifact !== undefined && prepared.diagnosticSidecarBytes !== undefined) {
                await this.platform.writeFile(diagnosticArtifact.temp, prepared.diagnosticSidecarBytes)
            }
            const artifactSidecarArtifact = artifacts.find(artifact => artifact.kind === 'artifact-sidecar')
            if (artifactSidecarArtifact !== undefined && request.artifactSidecarBytes !== undefined) {
                await this.platform.writeFile(artifactSidecarArtifact.temp, request.artifactSidecarBytes)
            }
            journal.phase = 'metadata-written'
            await this.persistJournal(journal)
            if (!request.canCommit()) return this.cancelStaged(journal)

            mark('generate-thumbnail-temp')
            const thumbnailDataUrl = request.generateThumbnail === undefined
                ? undefined
                : await request.generateThumbnail(request.imageDataUrl)
            journal.thumbnailStaged = thumbnailDataUrl !== undefined
            journal.phase = 'thumbnail-staged'
            await this.persistJournal(journal)

            mark('can-commit')
            if (!request.canCommit()) return this.cancelStaged(journal)

            journal.phase = 'commit-pending'
            journal.commitStarted = true
            for (const artifact of artifacts) {
                if (await this.platform.exists(artifact.final)) {
                    artifact.backup = childOutputRef(
                        directory,
                        backupName(artifact.final.path.split(/[\\/]/).pop() ?? fileName, transactionId),
                    )
                }
            }
            await this.persistJournal(journal)

            mark('atomic-commit')
            for (const artifact of artifacts) {
                if (artifact.backup !== undefined) await this.platform.rename(artifact.final, artifact.backup)
            }
            // The image is renamed last: a visible final image means all required
            // metadata artifacts were already committed.
            const orderedArtifacts = [
                ...artifacts.filter(artifact => artifact.kind !== 'image'),
                ...artifacts.filter(artifact => artifact.kind === 'image'),
            ]
            for (const artifact of orderedArtifacts) {
                await this.platform.rename(artifact.temp, artifact.final)
                artifact.committed = true
                await this.persistJournal(journal)
            }
            journal.phase = 'files-committed'
            await this.persistJournal(journal)
            if (!request.canCommit()) {
                await this.rollbackArtifacts(journal)
                await this.platform.removeJournal(journal.transactionId)
                journal = null
                return { status: 'cancelled' }
            }

            const result: OutputWriteResult = {
                transactionId,
                fileName,
                path: imageFinal.displayPath,
                file: imageFinal,
                directory,
                ...(sidecarArtifact === undefined ? {} : { sidecarPath: sidecarArtifact.final.displayPath }),
                ...(diagnosticArtifact === undefined
                    ? {}
                    : { diagnosticSidecarPath: diagnosticArtifact.final.displayPath }),
                ...(artifactSidecarArtifact === undefined
                    ? {}
                    : { artifactSidecarPath: artifactSidecarArtifact.final.displayPath }),
                ...(contentChecksum === undefined ? {} : { contentChecksum }),
                ...(thumbnailDataUrl === undefined ? {} : { thumbnailDataUrl }),
                capabilityFallbackUsed: directory.capabilityFallbackUsed,
                ...(directory.fallbackReason === undefined
                    ? {}
                    : { capabilityFallbackReason: directory.fallbackReason }),
                ...(directory.fallbackAlternative === undefined
                    ? {}
                    : { capabilityFallbackAlternative: directory.fallbackAlternative }),
            }

            mark('workflow-state-update')
            try {
                await request.commitWorkflow(result)
            } catch (error) {
                try { await request.rollbackWorkflow?.(result, error) } catch { /* journal remains authoritative */ }
                journal.phase = 'rollback-required'
                try { await this.persistJournal(journal) } catch { /* use previous durable state */ }
                mark('rollback-cleanup')
                await this.rollbackArtifacts(journal)
                await this.platform.removeJournal(journal.transactionId)
                journal = null
                throw error
            }

            journal.phase = 'workflow-committed'
            try {
                await this.persistJournal(journal)
            } catch (error) {
                if (request.terminalWorkflowCommit === true) throw error
                try { await request.rollbackWorkflow?.(result, error) } catch { /* file rollback remains mandatory */ }
                journal.phase = 'rollback-required'
                try { await this.persistJournal(journal) } catch { /* previous files-committed journal remains */ }
                await this.rollbackArtifacts(journal)
                await this.platform.removeJournal(journal.transactionId)
                journal = null
                throw error
            }
            await this.cleanupCompleted(journal)
            return { status: 'committed', result }
        } catch (error) {
            if (journal !== null && journal.phase !== 'workflow-committed') {
                try {
                    mark('rollback-cleanup')
                    await this.rollbackArtifacts(journal)
                    await this.platform.removeJournal(journal.transactionId)
                } catch (cleanupError) {
                    journal.phase = 'rollback-required'
                    try { await this.persistJournal(journal) } catch { /* retain earlier journal */ }
                    const rollbackError = new OutputWriterError('rollback-cleanup', 'Output failed and rollback is pending', {
                        cause: rollbackFailureCause(error, cleanupError),
                    })
                    reportDiagnostic(rollbackError, {
                        operation: 'output.write',
                        stage: rollbackError.phase,
                    })
                    throw rollbackError
                }
            }
            const diagnosticError = error instanceof OutputWriterError
                ? error
                : new OutputWriterError(phase, `Output transaction failed during ${phase}`, { cause: error })
            reportDiagnostic(diagnosticError, {
                operation: 'output.write',
                stage: diagnosticError.phase,
            })
            throw diagnosticError
        }
    }

    async recoverTransaction(
        transactionId: string,
        options: RetryRecoveryOptions = {},
    ): Promise<OutputRecoveryResult> {
        try {
            const bytes = await this.platform.readJournal(transactionId)
            if (bytes === null) return { transactionId, action: 'missing' }
            const journal = parseJournal(bytes)

            if (journal.phase === 'workflow-committed') {
                await this.cleanupCompleted(journal)
                return { transactionId, action: 'cleaned' }
            }
            if (options.mode === 'retry-workflow'
                && journal.phase === 'files-committed'
                && options.commitWorkflow !== undefined
                && (options.canCommit?.() ?? true)) {
                await options.commitWorkflow(resultFromJournal(journal))
                journal.phase = 'workflow-committed'
                await this.persistJournal(journal)
                await this.cleanupCompleted(journal)
                return { transactionId, action: 'retried' }
            }

            await this.rollbackArtifacts(journal)
            await this.platform.removeJournal(transactionId)
            return { transactionId, action: 'rolled-back' }
        } catch (error) {
            const diagnostic = reportDiagnostic(error, {
                operation: 'output.recovery',
                stage: 'recover-transaction',
            })
            return {
                transactionId,
                action: 'failed',
                error: diagnostic.userSummary,
            }
        }
    }

    async recoverPending(options: RetryRecoveryOptions = {}): Promise<OutputRecoveryResult[]> {
        const transactionIds = await this.platform.listJournalIds()
        const results: OutputRecoveryResult[] = []
        for (const transactionId of transactionIds) {
            results.push(await this.recoverTransaction(transactionId, options))
        }
        return results
    }

    async inspectPendingQueueTransactions(): Promise<PendingQueueOutputTransaction[]> {
        const transactionIds = await this.platform.listJournalIds()
        const result: PendingQueueOutputTransaction[] = []
        for (const transactionId of transactionIds) {
            const bytes = await this.platform.readJournal(transactionId)
            if (bytes === null) continue
            try {
                const journal = parseJournal(bytes)
                if (journal.sourceJobId !== undefined) {
                    result.push({
                        transactionId: journal.transactionId,
                        sourceJobId: journal.sourceJobId,
                        phase: journal.phase,
                    })
                }
            } catch {
                // Generic recovery owns malformed/orphan journals. Queue recovery
                // must not guess ownership from a filename or output path.
            }
        }
        return result.sort((left, right) => left.transactionId.localeCompare(right.transactionId))
    }
}

let runtimeWriter: OutputWriter | null = null

export function getRuntimeOutputWriter(): OutputWriter {
    runtimeWriter ??= new OutputWriter(createRuntimeOutputPlatformAdapter())
    return runtimeWriter
}

export function resetRuntimeOutputWriterForTests(): void {
    runtimeWriter = null
}
