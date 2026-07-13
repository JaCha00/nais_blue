import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MetadataWriteRequest, OutputMetadataWriter } from '@/services/output/metadata-writer'
import {
    OutputWriter,
    OutputWriterError,
    type OutputWriterPhase,
    type OutputWriterRequest,
} from '@/services/output/output-writer'
import type {
    OutputDestinationRequest,
    OutputFileRef,
    OutputPlatformAdapter,
    ResolvedOutputDirectory,
} from '@/services/output/platform-adapter'

const FIXED_NOW = new Date('2026-07-13T00:00:00.000Z')
const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4])
const SIDECAR_BYTES = new TextEncoder().encode('{"metadata":true}')

type AdapterOperation =
    | 'resolve-directory'
    | 'ensure-directory'
    | 'exists'
    | 'write-file'
    | 'read-file'
    | 'rename'
    | 'remove'
    | 'write-journal'
    | 'read-journal'
    | 'remove-journal'
    | 'list-journals'

interface AdapterCall {
    operation: AdapterOperation
    from?: string
    to?: string
}

interface AdapterFault {
    operation: AdapterOperation
    when?: (call: AdapterCall) => boolean
    error?: Error
}

function bytesEqual(actual: Uint8Array | undefined, expected: Uint8Array): boolean {
    return actual !== undefined
        && actual.length === expected.length
        && actual.every((value, index) => value === expected[index])
}

class InMemoryOutputAdapter implements OutputPlatformAdapter {
    readonly capabilities = {
        absolutePaths: false,
        atomicSiblingRename: true,
        runtime: 'app-scoped' as const,
    }

    readonly files = new Map<string, Uint8Array>()
    readonly journals = new Map<string, Uint8Array>()
    readonly calls: AdapterCall[] = []
    fault: AdapterFault | null = null

    private record(call: AdapterCall): void {
        this.calls.push(call)
        if (this.fault?.operation === call.operation && (this.fault.when?.(call) ?? true)) {
            const error = this.fault.error ?? new Error(`Injected ${call.operation} failure`)
            this.fault = null
            throw error
        }
    }

    private key(file: OutputFileRef): string {
        return `${file.baseDir ?? 'absolute'}:${file.path}`
    }

    private clone(bytes: Uint8Array): Uint8Array {
        return new Uint8Array(bytes)
    }

    async resolveDirectory(request: OutputDestinationRequest): Promise<ResolvedOutputDirectory> {
        this.record({ operation: 'resolve-directory' })
        const directory = request.directory?.trim() || request.workflowDefaultDirectory
        return {
            path: directory,
            displayPath: `/app-data/${directory}`,
            baseDir: 1,
            capabilityFallbackUsed: false,
        }
    }

    async ensureDirectory(directory: OutputFileRef): Promise<void> {
        this.record({ operation: 'ensure-directory', from: this.key(directory) })
    }

    async exists(file: OutputFileRef): Promise<boolean> {
        const key = this.key(file)
        this.record({ operation: 'exists', from: key })
        return this.files.has(key)
    }

    async writeFile(file: OutputFileRef, bytes: Uint8Array): Promise<void> {
        const key = this.key(file)
        this.record({ operation: 'write-file', to: key })
        this.files.set(key, this.clone(bytes))
    }

    async readFile(file: OutputFileRef): Promise<Uint8Array> {
        const key = this.key(file)
        this.record({ operation: 'read-file', from: key })
        const bytes = this.files.get(key)
        if (bytes === undefined) throw new Error(`Missing file: ${key}`)
        return this.clone(bytes)
    }

    async rename(from: OutputFileRef, to: OutputFileRef): Promise<void> {
        const fromKey = this.key(from)
        const toKey = this.key(to)
        this.record({ operation: 'rename', from: fromKey, to: toKey })
        const bytes = this.files.get(fromKey)
        if (bytes === undefined) throw new Error(`Missing rename source: ${fromKey}`)
        this.files.set(toKey, bytes)
        this.files.delete(fromKey)
    }

    async remove(file: OutputFileRef): Promise<void> {
        const key = this.key(file)
        this.record({ operation: 'remove', from: key })
        this.files.delete(key)
    }

    async writeJournal(transactionId: string, bytes: Uint8Array): Promise<void> {
        this.record({ operation: 'write-journal', to: transactionId })
        this.journals.set(transactionId, this.clone(bytes))
    }

    async readJournal(transactionId: string): Promise<Uint8Array | null> {
        this.record({ operation: 'read-journal', from: transactionId })
        const bytes = this.journals.get(transactionId)
        return bytes === undefined ? null : this.clone(bytes)
    }

    async removeJournal(transactionId: string): Promise<void> {
        this.record({ operation: 'remove-journal', from: transactionId })
        this.journals.delete(transactionId)
    }

    async listJournalIds(): Promise<string[]> {
        this.record({ operation: 'list-journals' })
        return [...this.journals.keys()].sort()
    }

    seed(path: string, bytes: Uint8Array): void {
        this.files.set(`1:${path}`, this.clone(bytes))
    }

    file(path: string): Uint8Array | undefined {
        return this.files.get(`1:${path}`)
    }

    paths(): string[] {
        return [...this.files.keys()].map(key => key.replace(/^1:/, '')).sort()
    }
}

class DeterministicMetadataWriter implements OutputMetadataWriter {
    prepare(imageBytes: Uint8Array, request?: MetadataWriteRequest) {
        return {
            imageBytes: new Uint8Array(imageBytes),
            ...(request === undefined ? {} : { sidecarBytes: new Uint8Array(SIDECAR_BYTES) }),
        }
    }
}

function metadataRequest(): MetadataWriteRequest {
    return {
        params: {} as MetadataWriteRequest['params'],
        imageFormat: 'png',
        metadataMode: 'sidecar-only',
    }
}

function request(overrides: Partial<OutputWriterRequest> = {}): OutputWriterRequest {
    return {
        destination: {
            directory: 'output',
            useAbsolutePath: false,
            workflowDefaultDirectory: 'NAIS_Output',
            extension: 'png',
            fileName: 'result.png',
            collisionPolicy: 'unique',
        },
        imageBytes: new Uint8Array(IMAGE_BYTES),
        imageDataUrl: 'data:image/png;base64,AQIDBA==',
        canCommit: () => true,
        commitWorkflow: () => undefined,
        ...overrides,
    }
}

function writer(adapter: InMemoryOutputAdapter, transactionId = 'txn-1'): OutputWriter {
    return new OutputWriter(
        adapter,
        new DeterministicMetadataWriter(),
        () => transactionId,
        () => new Date(FIXED_NOW),
    )
}

function expectNoTransactionArtifacts(adapter: InMemoryOutputAdapter): void {
    expect(adapter.paths().filter(path => path.includes('.nais2-txn-'))).toEqual([])
    expect([...adapter.journals.keys()]).toEqual([])
}

function expectNoOutput(adapter: InMemoryOutputAdapter): void {
    expect(adapter.paths()).toEqual([])
    expectNoTransactionArtifacts(adapter)
}

beforeEach(() => {
    vi.restoreAllMocks()
})

describe('OutputWriter fault containment', () => {
    it('cancels before destination staging without creating files or a journal', async () => {
        const adapter = new InMemoryOutputAdapter()

        await expect(writer(adapter).write(request({ canCommit: () => false })))
            .resolves.toEqual({ status: 'cancelled' })

        expect(adapter.calls).toEqual([])
        expectNoOutput(adapter)
    })

    it('cleans the journal when the image temp write fails', async () => {
        const adapter = new InMemoryOutputAdapter()
        adapter.fault = {
            operation: 'write-file',
            when: call => call.to?.includes('.image.tmp') === true,
        }

        await expect(writer(adapter).write(request()))
            .rejects.toBeInstanceOf(OutputWriterError)

        expectNoOutput(adapter)
    })

    it('removes the staged image when the sidecar temp write fails', async () => {
        const adapter = new InMemoryOutputAdapter()
        adapter.fault = {
            operation: 'write-file',
            when: call => call.to?.includes('.sidecar.tmp') === true,
        }

        await expect(writer(adapter).write(request({ metadata: metadataRequest() })))
            .rejects.toBeInstanceOf(OutputWriterError)

        expectNoOutput(adapter)
    })

    it('rolls back staged image and sidecar data when thumbnail generation fails', async () => {
        const adapter = new InMemoryOutputAdapter()

        await expect(writer(adapter).write(request({
            metadata: metadataRequest(),
            generateThumbnail: async () => {
                throw new Error('thumbnail failed')
            },
        }))).rejects.toBeInstanceOf(OutputWriterError)

        expectNoOutput(adapter)
    })

    it('removes all staged data when the session changes immediately before commit', async () => {
        const adapter = new InMemoryOutputAdapter()
        let sessionValid = true

        const outcome = await writer(adapter).write(request({
            metadata: metadataRequest(),
            canCommit: () => sessionValid,
            onPhase: (phase: OutputWriterPhase) => {
                if (phase === 'can-commit') sessionValid = false
            },
        }))

        expect(outcome).toEqual({ status: 'cancelled' })
        expectNoOutput(adapter)
    })

    it('removes partially renamed finals after an atomic rename failure', async () => {
        const adapter = new InMemoryOutputAdapter()
        adapter.fault = {
            operation: 'rename',
            when: call => call.from?.includes('.image.tmp') === true,
        }

        await expect(writer(adapter).write(request({ metadata: metadataRequest() })))
            .rejects.toMatchObject({ name: 'OutputWriterError' })

        expectNoOutput(adapter)
    })

    it('removes committed files and invokes workflow compensation after store commit failure', async () => {
        const adapter = new InMemoryOutputAdapter()
        const rollbackWorkflow = vi.fn()

        await expect(writer(adapter).write(request({
            metadata: metadataRequest(),
            commitWorkflow: () => {
                throw new Error('store commit failed')
            },
            rollbackWorkflow,
        }))).rejects.toMatchObject({ name: 'OutputWriterError' })

        expect(rollbackWorkflow).toHaveBeenCalledOnce()
        expectNoOutput(adapter)
    })

    it('rolls back an interrupted files-committed journal on the next writer instance', async () => {
        const adapter = new InMemoryOutputAdapter()
        const oldBytes = new Uint8Array([9, 9, 9])
        const newBytes = new Uint8Array([8, 8, 8])
        adapter.seed('output/restart.png', newBytes)
        adapter.seed('output/.restart.png.nais2-txn-restart.backup', oldBytes)
        adapter.seed('output/.restart.png.nais2-txn-restart.image.tmp', IMAGE_BYTES)
        await adapter.writeJournal('txn-restart', new TextEncoder().encode(JSON.stringify({
            format: 'nais2-output-transaction',
            version: 1,
            transactionId: 'txn-restart',
            createdAt: FIXED_NOW.toISOString(),
            updatedAt: FIXED_NOW.toISOString(),
            phase: 'files-committed',
            fileName: 'restart.png',
            directory: {
                path: 'output',
                displayPath: '/app-data/output',
                baseDir: 1,
                capabilityFallbackUsed: false,
            },
            artifacts: [{
                kind: 'image',
                temp: {
                    path: 'output/.restart.png.nais2-txn-restart.image.tmp',
                    displayPath: '/app-data/output/.restart.png.nais2-txn-restart.image.tmp',
                    baseDir: 1,
                },
                final: {
                    path: 'output/restart.png',
                    displayPath: '/app-data/output/restart.png',
                    baseDir: 1,
                },
                backup: {
                    path: 'output/.restart.png.nais2-txn-restart.backup',
                    displayPath: '/app-data/output/.restart.png.nais2-txn-restart.backup',
                    baseDir: 1,
                },
            }],
            thumbnailStaged: true,
        })))

        const restartedWriter = writer(adapter, 'unused-after-restart')
        await expect(restartedWriter.recoverPending()).resolves.toEqual([{
            transactionId: 'txn-restart',
            action: 'rolled-back',
        }])

        expect(bytesEqual(adapter.file('output/restart.png'), oldBytes)).toBe(true)
        expect(adapter.paths()).toEqual(['output/restart.png'])
        expectNoTransactionArtifacts(adapter)
    })

    it('allocates a unique duplicate filename and leaves only committed finals', async () => {
        const adapter = new InMemoryOutputAdapter()
        const original = new Uint8Array([7, 7, 7])
        adapter.seed('output/result.png', original)

        const outcome = await writer(adapter).write(request())

        expect(outcome).toMatchObject({
            status: 'committed',
            result: {
                fileName: 'result-2.png',
                path: '/app-data/output/result-2.png',
            },
        })
        expect(bytesEqual(adapter.file('output/result.png'), original)).toBe(true)
        expect(bytesEqual(adapter.file('output/result-2.png'), IMAGE_BYTES)).toBe(true)
        expect(adapter.paths()).toEqual(['output/result-2.png', 'output/result.png'])
        expectNoTransactionArtifacts(adapter)
    })
})

describe('OutputWriter overwrite rollback safety', () => {
    it('preserves a pre-existing final when staging an overwrite fails', async () => {
        const adapter = new InMemoryOutputAdapter()
        const original = new Uint8Array([6, 6, 6])
        adapter.seed('output/result.png', original)
        adapter.fault = {
            operation: 'write-file',
            when: call => call.to?.includes('.image.tmp') === true,
        }

        await expect(writer(adapter).write(request({
            destination: {
                directory: 'output',
                workflowDefaultDirectory: 'NAIS_Output',
                extension: 'png',
                fileName: 'result.png',
                collisionPolicy: 'overwrite',
            },
        }))).rejects.toBeInstanceOf(OutputWriterError)

        expect(bytesEqual(adapter.file('output/result.png'), original)).toBe(true)
        expect(adapter.paths()).toEqual(['output/result.png'])
        expectNoTransactionArtifacts(adapter)
    })
})
