import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { sha256Bytes } from '@/lib/binary-digest'
import type { DistributionPolicy } from '@/domain/organizer/types'
import type { R2ProfileV2, UploadJob } from '@/domain/r2/types'
import type {
    OutputDestinationRequest,
    OutputFileRef,
    OutputPlatformAdapter,
    ResolvedOutputDirectory,
} from '@/services/output/platform-adapter'
import { IndexedDBArtifactRepository } from '@/services/organizer/artifact-repository'
import {
    ArtifactDistributionCoordinator,
    type OrganizerR2FollowUpRuntime,
} from '@/services/organizer/distribution-coordinator'
import type { OrganizerImageTranscoder } from '@/services/organizer/image-transcoder'

const NOW = '2026-07-14T12:00:00.000Z'
let databaseCounter = 0

function ascii(value: string): number[] {
    return [...value].map(character => character.charCodeAt(0))
}

function u32be(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function pngChunk(type: string, data: readonly number[]): number[] {
    return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0]
}

function u32le(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

function webpChunk(type: string, data: readonly number[]): number[] {
    return [...ascii(type), ...u32le(data.length), ...data, ...(data.length % 2 === 0 ? [] : [0])]
}

// The raw-container tests intentionally do not decode this fixture. OutputWriter
// treats it as opaque bytes, exactly as a lossless copy/strip distribution does.
const PNG_WITH_METADATA = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...pngChunk('tEXt', [...ascii('Comment\0distribution fixture')]),
    ...pngChunk('naIs', [...ascii('app chunk')]),
    ...pngChunk('IDAT', [0]),
    ...pngChunk('IEND', []),
])

const WEBP_DISTRIBUTION = (() => {
    const body = webpChunk('VP8 ', [0, 0, 0, 0])
    return new Uint8Array([0x52, 0x49, 0x46, 0x46, ...u32le(body.length + 4), 0x57, 0x45, 0x42, 0x50, ...body])
})()

class InMemoryOrganizerOutputAdapter implements OutputPlatformAdapter {
    readonly capabilities = { absolutePaths: false, atomicSiblingRename: true, runtime: 'app-scoped' as const }
    readonly files = new Map<string, Uint8Array>()
    readonly journals = new Map<string, Uint8Array>()
    failFinalRename = false

    private clone(bytes: Uint8Array): Uint8Array {
        return new Uint8Array(bytes)
    }

    async resolveDirectory(request: OutputDestinationRequest): Promise<ResolvedOutputDirectory> {
        const portable = request.portableDirectory
        const path = portable?.kind === 'standard'
            ? portable.segments.join('/')
            : portable?.kind === 'bookmark'
                ? `bookmark/${portable.bookmarkId}/${portable.segments.join('/')}`
                : request.workflowDefaultDirectory
        return { path, displayPath: `/runtime/${path}`, baseDir: 1, capabilityFallbackUsed: false }
    }

    async ensureDirectory(): Promise<void> {}
    async exists(file: OutputFileRef): Promise<boolean> { return this.files.has(file.path) }
    async writeFile(file: OutputFileRef, bytes: Uint8Array): Promise<void> { this.files.set(file.path, this.clone(bytes)) }
    async readFile(file: OutputFileRef): Promise<Uint8Array> {
        const bytes = this.files.get(file.path)
        if (bytes === undefined) throw new Error('Fixture file is missing')
        return this.clone(bytes)
    }
    async rename(from: OutputFileRef, to: OutputFileRef): Promise<void> {
        if (this.failFinalRename && to.path === 'nais2/organizer/distributions/portrait-distribution.png') {
            this.failFinalRename = false
            throw new Error('Injected final rename interruption')
        }
        const bytes = this.files.get(from.path)
        if (bytes === undefined) throw new Error('Fixture rename source is missing')
        this.files.set(to.path, bytes)
        this.files.delete(from.path)
    }
    async remove(file: OutputFileRef): Promise<void> { this.files.delete(file.path) }
    async writeJournal(transactionId: string, bytes: Uint8Array): Promise<void> { this.journals.set(transactionId, this.clone(bytes)) }
    async readJournal(transactionId: string): Promise<Uint8Array | null> {
        const bytes = this.journals.get(transactionId)
        return bytes === undefined ? null : this.clone(bytes)
    }
    async removeJournal(transactionId: string): Promise<void> { this.journals.delete(transactionId) }
    async listJournalIds(): Promise<string[]> { return [...this.journals.keys()] }

    seed(path: string, bytes: Uint8Array): void { this.files.set(path, this.clone(bytes)) }
    file(path: string): Uint8Array | undefined {
        const bytes = this.files.get(path)
        return bytes === undefined ? undefined : this.clone(bytes)
    }
    paths(): string[] { return [...this.files.keys()].sort() }
}

function repository(label: string): IndexedDBArtifactRepository {
    databaseCounter += 1
    return new IndexedDBArtifactRepository({
        factory: new IDBFactory() as unknown as IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName: `organizer-distribution-${label}-${databaseCounter}`,
    })
}

function policy(overrides: Partial<DistributionPolicy> = {}): DistributionPolicy {
    return {
        destination: { kind: 'standard', root: 'app-data', segments: ['nais2', 'organizer', 'distributions'] },
        filenameTemplate: '{original.name}-distribution',
        collisionPolicy: 'unique',
        format: 'png',
        webpLossless: false,
        quality: 0.92,
        alphaPolicy: 'preserve',
        matteColor: '#ffffff',
        metadataPolicy: 'strip',
        r2FollowUp: null,
        ...overrides,
    }
}

async function seedArtifact(repo: IndexedDBArtifactRepository, adapter: InMemoryOrganizerOutputAdapter): Promise<string> {
    const artifactId = 'artifact-portrait'
    adapter.seed('nais2/organizer/sources/portrait.png', PNG_WITH_METADATA)
    await repo.putOriginal({
        artifactId,
        sourceJobId: 'job-portrait',
        sourceSceneId: 'scene-portrait',
        file: { directory: { kind: 'standard', root: 'app-data', segments: ['nais2', 'organizer', 'sources'] }, fileName: 'portrait.png' },
        format: 'png',
        contentChecksum: await sha256Bytes(PNG_WITH_METADATA),
        size: PNG_WITH_METADATA.byteLength,
        createdAt: NOW,
    })
    return artifactId
}

function profile(): R2ProfileV2 {
    return {
        schemaVersion: 2,
        id: 'r2-organizer',
        name: 'Organizer R2',
        accountId: 'account-fixture',
        jurisdiction: null,
        endpoint: 'https://r2.invalid',
        bucket: 'fixture-bucket',
        prefix: 'exports',
        credentialRef: 'credential-fixture-ref',
        transport: 'native-s3',
        conflictPolicy: 'suffix',
        publicMode: 'private',
        publicBaseUrl: null,
        createdAt: NOW,
        updatedAt: NOW,
    }
}

function r2Runtime(captured: { artifacts: unknown[] }): OrganizerR2FollowUpRuntime {
    return {
        getProfile: async () => profile(),
        enqueue: async (_profile, artifact) => {
            captured.artifacts.push(artifact)
            return [{
                id: 'upload-portrait',
                profileId: 'r2-organizer',
                artifactId: artifact.artifactId,
                localVariant: artifact.localVariant,
                remoteKey: artifact.remoteKey,
                contentSha256: artifact.contentSha256,
                contentType: artifact.contentType,
                size: artifact.size,
                state: 'queued',
                attempt: 0,
                maxAttempts: 3,
                nextAttemptAt: NOW,
                multipart: { uploadId: null, completedParts: [], partSize: 0 },
                diagnosticEventId: null,
                createdAt: NOW,
                updatedAt: NOW,
                version: 1,
            } satisfies UploadJob]
        },
    }
}

describe('ArtifactDistributionCoordinator', () => {
    it('creates a metadata-stripped distribution + artifact sidecar, preserves original bytes, and queues only a linked R2 ref', async () => {
        const adapter = new InMemoryOrganizerOutputAdapter()
        const repo = repository('commit')
        const artifactId = await seedArtifact(repo, adapter)
        const captured: { artifacts: unknown[] } = { artifacts: [] }
        const coordinator = new ArtifactDistributionCoordinator({
            repository: repo,
            platform: adapter,
            r2: r2Runtime(captured),
            now: () => new Date(NOW),
            createVariantId: () => 'distribution-1',
        })

        await expect(coordinator.createAndRun(artifactId, policy({
            r2FollowUp: { profileId: 'r2-organizer', remoteKeyPrefix: 'organizer' },
        }))).resolves.toMatchObject({ status: 'succeeded', variantId: 'distribution-1' })

        const record = await repo.get(artifactId)
        expect(record?.original.contentChecksum).toBe(await sha256Bytes(PNG_WITH_METADATA))
        expect(adapter.file('nais2/organizer/sources/portrait.png')).toEqual(PNG_WITH_METADATA)
        expect(adapter.file('nais2/organizer/distributions/portrait-distribution.png')).toBeDefined()
        expect(adapter.file('nais2/organizer/distributions/portrait-distribution.nais-blue.artifact.json')).toBeDefined()
        expect(record?.distributionVariants[0]).toMatchObject({
            status: 'succeeded',
            file: { fileName: 'portrait-distribution.png' },
            sidecar: { file: { fileName: 'portrait-distribution.nais-blue.artifact.json' } },
        })
        expect(record?.remoteObjectRefs).toEqual([expect.objectContaining({
            artifactId,
            variantId: 'distribution-1',
            remoteKey: 'exports/organizer/portrait-distribution.png',
            state: 'queued',
        })])
        expect(JSON.stringify(record)).not.toContain('/runtime/')
        expect(captured.artifacts).toHaveLength(1)
    })

    it('uses collision-safe sanitized names and does not mutate originals across repeated distributions', async () => {
        const adapter = new InMemoryOrganizerOutputAdapter()
        const repo = repository('collision')
        const artifactId = await seedArtifact(repo, adapter)
        let next = 0
        const coordinator = new ArtifactDistributionCoordinator({
            repository: repo,
            platform: adapter,
            now: () => new Date(NOW),
            createVariantId: () => `distribution-${++next}`,
        })

        await coordinator.createAndRun(artifactId, policy({ filenameTemplate: '../CON' }))
        await coordinator.createAndRun(artifactId, policy({ filenameTemplate: '../CON' }))
        const record = await repo.get(artifactId)
        const names = record?.distributionVariants.map(variant => variant.file?.fileName) ?? []
        expect(names).toHaveLength(2)
        expect(names.every(name => name !== undefined && !name.includes('/') && !name.includes('\\'))).toBe(true)
        expect(new Set(names).size).toBe(2)
        expect(adapter.file('nais2/organizer/sources/portrait.png')).toEqual(PNG_WITH_METADATA)
    })

    it('uses the injected WebView conversion boundary for a PNG-to-WebP distribution while verifying decoded alpha/color', async () => {
        const adapter = new InMemoryOrganizerOutputAdapter()
        const repo = repository('convert')
        const artifactId = await seedArtifact(repo, adapter)
        const calls: string[] = []
        const transcoder: OrganizerImageTranscoder = {
            supportsLosslessWebp: true,
            decode: async () => ({ width: 1, height: 1, rgba: new Uint8ClampedArray([12, 34, 56, 129]), colorSpace: 'srgb' }),
            transcode: async request => {
                calls.push(`${request.sourceFormat}->${request.targetFormat}:${request.alphaPolicy}`)
                return WEBP_DISTRIBUTION
            },
        }
        const coordinator = new ArtifactDistributionCoordinator({
            repository: repo,
            platform: adapter,
            transcoder,
            now: () => new Date(NOW),
            createVariantId: () => 'distribution-webp',
        })

        await expect(coordinator.createAndRun(artifactId, policy({ format: 'webp', metadataPolicy: 'preserve' }))).resolves.toMatchObject({ status: 'succeeded' })
        expect(calls).toEqual(['png->webp:preserve'])
        expect(adapter.file('nais2/organizer/distributions/portrait-distribution.webp')).toEqual(WEBP_DISTRIBUTION)
        expect(adapter.file('nais2/organizer/sources/portrait.png')).toEqual(PNG_WITH_METADATA)
        expect((await repo.get(artifactId))?.distributionVariants[0]).toMatchObject({ format: 'webp', status: 'succeeded' })
    })

    it('rolls back an interrupted rename, marks only that item failed, and retryFailed reruns it without touching the original', async () => {
        const adapter = new InMemoryOrganizerOutputAdapter()
        adapter.failFinalRename = true
        const repo = repository('retry')
        const artifactId = await seedArtifact(repo, adapter)
        const coordinator = new ArtifactDistributionCoordinator({
            repository: repo,
            platform: adapter,
            now: () => new Date(NOW),
            createVariantId: () => 'distribution-retry',
        })

        await expect(coordinator.createAndRun(artifactId, policy())).resolves.toMatchObject({ status: 'failed' })
        expect(adapter.paths().filter(path => path.includes('distributions/'))).toEqual([])
        expect(adapter.journals.size).toBe(0)
        expect(adapter.file('nais2/organizer/sources/portrait.png')).toEqual(PNG_WITH_METADATA)
        expect((await repo.get(artifactId))?.distributionVariants[0]?.status).toBe('failed')

        await expect(coordinator.retryFailed([artifactId])).resolves.toMatchObject({ distributionRuns: [{ status: 'succeeded' }] })
        expect((await repo.get(artifactId))?.distributionVariants[0]?.status).toBe('succeeded')
        expect(adapter.file('nais2/organizer/sources/portrait.png')).toEqual(PNG_WITH_METADATA)
    })

    it('contains a failed conversion before OutputWriter receives any mutable distribution file', async () => {
        const adapter = new InMemoryOrganizerOutputAdapter()
        const repo = repository('conversion-failure')
        const artifactId = await seedArtifact(repo, adapter)
        const interruptedTranscoder: OrganizerImageTranscoder = {
            supportsLosslessWebp: true,
            decode: async () => ({ width: 1, height: 1, rgba: new Uint8ClampedArray([1, 2, 3, 4]), colorSpace: 'srgb' }),
            transcode: async () => { throw new Error('Injected conversion interruption') },
        }
        const coordinator = new ArtifactDistributionCoordinator({
            repository: repo,
            platform: adapter,
            transcoder: interruptedTranscoder,
            now: () => new Date(NOW),
            createVariantId: () => 'distribution-conversion',
        })

        await expect(coordinator.createAndRun(artifactId, policy({ format: 'webp', metadataPolicy: 'preserve' }))).resolves.toMatchObject({ status: 'failed' })
        expect(adapter.paths()).toEqual(['nais2/organizer/sources/portrait.png'])
        expect(adapter.file('nais2/organizer/sources/portrait.png')).toEqual(PNG_WITH_METADATA)
        expect((await repo.get(artifactId))?.distributionVariants[0]).toMatchObject({ status: 'failed', file: null, sidecar: null })
    })
})
