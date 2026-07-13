import type { MetadataWriteRequest, OutputMetadataWriter } from './metadata-writer'
import { MetadataWriter } from './metadata-writer'
import {
    ensureImageFileExtension,
    resolveCollisionFileName,
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
    thumbnailDataUrl?: string
    capabilityFallbackUsed: boolean
    capabilityFallbackReason?: string
    capabilityFallbackAlternative?: string
}

export interface OutputWriterRequest {
    destination: OutputWriterDestination
    imageBytes: Uint8Array
    imageDataUrl: string
    metadata?: MetadataWriteRequest
    generateThumbnail?: (imageDataUrl: string) => Promise<string>
    canCommit: () => boolean
    commitWorkflow: (result: OutputWriteResult) => void | Promise<void>
    rollbackWorkflow?: (result: OutputWriteResult, cause: unknown) => void | Promise<void>
    onPhase?: (phase: OutputWriterPhase) => void
}

export type OutputWriterOutcome =
    | { status: 'committed'; result: OutputWriteResult }
    | { status: 'cancelled' }

interface JournalArtifact {
    kind: 'image' | 'sidecar' | 'diagnostic'
    temp: OutputFileRef
    final: OutputFileRef
    backup?: OutputFileRef
    committed: boolean
}

interface OutputRecoveryJournal {
    format: 'nais2-output-transaction'
    version: 1
    transactionId: string
    createdAt: string
    updatedAt: string
    phase: RecoveryJournalPhase
    fileName: string
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
            || (entry.kind !== 'image' && entry.kind !== 'sidecar' && entry.kind !== 'diagnostic')) {
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
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        phase: value.phase as RecoveryJournalPhase,
        fileName: value.fileName,
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
    return {
        transactionId: journal.transactionId,
        fileName: journal.fileName,
        path: image.final.displayPath,
        file: image.final,
        directory: journal.directory,
        ...(sidecar === undefined ? {} : { sidecarPath: sidecar.final.displayPath }),
        ...(diagnostic === undefined ? {} : { diagnosticSidecarPath: diagnostic.final.displayPath }),
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
                if (request.metadata === undefined) return false
                const sidecarNeeded = request.metadata.metadataMode === 'sidecar-only'
                    || request.metadata.metadataMode === 'strip-and-sidecar'
                    || request.metadata.imageFormat === 'webp'
                return sidecarNeeded && await this.platform.exists(childOutputRef(directory, toSidecarFileName(candidate)))
            })
            const transactionId = this.createTransactionId()
            const prepared = this.metadataWriter.prepare(request.imageBytes, request.metadata)
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

            mark('stage-temp-output')
            const timestamp = this.now().toISOString()
            journal = {
                format: 'nais2-output-transaction',
                version: 1,
                transactionId,
                createdAt: timestamp,
                updatedAt: timestamp,
                phase: 'staged',
                fileName,
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
                    throw new OutputWriterError('rollback-cleanup', 'Output failed and rollback is pending', {
                        cause: { transactionError: error, cleanupError },
                    })
                }
            }
            if (error instanceof OutputWriterError) throw error
            throw new OutputWriterError(phase, `Output transaction failed during ${phase}`, { cause: error })
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
            return {
                transactionId,
                action: 'failed',
                error: error instanceof Error ? error.message : String(error),
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
}

let runtimeWriter: OutputWriter | null = null

export function getRuntimeOutputWriter(): OutputWriter {
    runtimeWriter ??= new OutputWriter(createRuntimeOutputPlatformAdapter())
    return runtimeWriter
}

export function resetRuntimeOutputWriterForTests(): void {
    runtimeWriter = null
}
