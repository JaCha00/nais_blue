import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { createR2ProfileV2, type NativeR2ScannedArtifact, type R2ProfileV2 } from '@/domain/r2/types'
import {
    createUploadJob,
    IndexedDBR2UploadRepository,
    R2UploadRepositoryError,
} from '@/services/r2/indexeddb-r2-upload-repository'
import { NativeR2Error, type NativeR2UploadAdapter } from '@/services/r2/native-r2-adapter'
import { R2UploadCoordinator } from '@/services/r2/r2-upload-coordinator'

const NOW = '2026-07-14T12:00:00.000Z'
const HASH = `sha256:${'a'.repeat(64)}`
let databaseCounter = 0

function repository(label: string): IndexedDBR2UploadRepository {
    databaseCounter += 1
    return new IndexedDBR2UploadRepository({
        factory: new IDBFactory() as unknown as globalThis.IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName: `r2-${label}-${databaseCounter}`,
    })
}

function profile(overrides: Partial<R2ProfileV2> = {}): R2ProfileV2 {
    return {
        ...createR2ProfileV2({
            id: 'r2-profile',
            name: 'Fixture R2',
            accountId: 'account-metadata',
            jurisdiction: null,
            endpoint: 'https://fixture.invalid',
            bucket: 'fixture-bucket',
            prefix: 'exports',
            credentialRef: 'r2-system-fixture',
            transport: 'native-s3',
            conflictPolicy: 'fail',
            publicMode: 'private',
            publicBaseUrl: null,
        }, NOW),
        ...overrides,
    }
}

function artifact(index: number, size = 128): NativeR2ScannedArtifact {
    return {
        artifactId: `artifact:${index}`,
        localVariant: `C:/fixture/image-${index}.png`,
        remoteKey: `exports/image-${index}.png`,
        contentSha256: `sha256:${index.toString(16).padStart(64, '0')}`,
        contentType: 'image/png',
        size,
    }
}

function adapter(overrides: Partial<NativeR2UploadAdapter> = {}): NativeR2UploadAdapter {
    return {
        headObject: vi.fn(async () => ({ exists: false, size: null, contentSha256: null, etag: null })),
        putObject: vi.fn(async (_profile, job) => ({ remoteKey: job.remoteKey, uploaded: true, skippedSame: false, etag: 'etag' })),
        createMultipart: vi.fn(async (_profile, job) => ({ remoteKey: job.remoteKey, uploadId: 'upload-1' })),
        uploadPart: vi.fn(async (_profile, input) => ({ partNumber: input.partNumber, etag: `etag-${input.partNumber}`, size: input.length })),
        completeMultipart: vi.fn(async (_profile, input) => ({ remoteKey: input.remoteKey, uploaded: true, skippedSame: false, etag: 'complete-etag' })),
        abortMultipart: vi.fn(async () => undefined),
        ...overrides,
    }
}

describe('R2 upload repository and coordinator', () => {
    it('persists only non-secret profiles and rejects credentials or signed URLs', async () => {
        const repo = repository('secret-safe')
        await expect(repo.putProfile(profile())).resolves.toMatchObject({ credentialRef: 'r2-system-fixture' })
        await expect(repo.putProfile({
            ...profile({ id: 'unsafe' }),
            endpoint: `https://fixture.invalid?X-Amz-Signature=${'secret-canary'}`,
        })).rejects.toMatchObject({ code: 'E_R2_RECORD_INVALID' })
        await expect(repo.putProfile({
            ...profile({ id: 'unsafe-field' }),
            accessKeyId: 'secret-canary',
        } as R2ProfileV2)).rejects.toBeInstanceOf(R2UploadRepositoryError)
    })

    it('deduplicates completed objects through manifest v2 and idempotent enqueue', async () => {
        const repo = repository('manifest')
        const currentProfile = profile()
        await repo.putProfile(currentProfile)
        const coordinator = new R2UploadCoordinator(repo, adapter(), () => new Date(NOW))
        const first = await coordinator.plan(currentProfile, [artifact(1)], 'delta')
        const [job] = await coordinator.enqueuePlan(first)
        const duplicate = await coordinator.enqueuePlan(first)
        expect(duplicate[0].id).toBe(job.id)
        await coordinator.runUntilIdle(currentProfile)

        const second = await coordinator.plan(currentProfile, [artifact(1)], 'delta')
        expect(second.jobs).toHaveLength(0)
        expect(second.alreadyCompleted).toBe(1)
        await expect(coordinator.manifest(currentProfile)).resolves.toMatchObject({ schemaVersion: 2 })
    })

    it('previews conditional conflicts without writing remote objects', async () => {
        const repo = repository('preview')
        const currentProfile = profile({ conflictPolicy: 'fail' })
        const fake = adapter({
            headObject: vi.fn(async () => ({ exists: true, size: 64, contentSha256: `sha256:${'b'.repeat(64)}`, etag: 'existing' })),
        })
        const coordinator = new R2UploadCoordinator(repo, fake, () => new Date(NOW))
        const plan = await coordinator.plan(currentProfile, [artifact(9)], 'dry-run')
        await expect(coordinator.previewConflicts(currentProfile, plan)).resolves.toMatchObject({
            examined: 1,
            conflicts: 1,
            overwrites: 0,
        })
        expect(fake.putObject).not.toHaveBeenCalled()
        expect(fake.createMultipart).not.toHaveBeenCalled()
    })

    it('resumes interrupted multipart from completed parts without starting over', async () => {
        const repo = repository('multipart-resume')
        const currentProfile = profile()
        await repo.putProfile(currentProfile)
        let failedOnce = false
        const fake = adapter({
            uploadPart: vi.fn(async (_profile, input) => {
                if (input.partNumber === 2 && !failedOnce) {
                    failedOnce = true
                    throw new NativeR2Error('E_R2_TRANSPORT', 'Typed interruption.', true, null)
                }
                return { partNumber: input.partNumber, etag: `etag-${input.partNumber}`, size: input.length }
            }),
        })
        let clock = new Date(NOW)
        const firstRuntime = new R2UploadCoordinator(repo, fake, () => clock)
        const multipartArtifact = artifact(2, 20 * 1024 * 1024)
        await firstRuntime.enqueuePlan(await firstRuntime.plan(currentProfile, [multipartArtifact], 'full-sync'))
        await firstRuntime.runUntilIdle(currentProfile)

        const interrupted = (await repo.listJobs(currentProfile.id))[0]
        expect(interrupted.state).toBe('queued')
        expect(interrupted.multipart.uploadId).toBe('upload-1')
        expect(interrupted.multipart.completedParts.map(part => part.partNumber)).toEqual([1])

        clock = new Date('2026-07-14T12:01:00.000Z')
        const restarted = new R2UploadCoordinator(repo, fake, () => clock)
        await restarted.recoverAfterRestart()
        const summary = await restarted.runUntilIdle(currentProfile)
        expect(summary.succeeded).toBe(1)
        expect(fake.createMultipart).toHaveBeenCalledTimes(1)
        expect(vi.mocked(fake.uploadPart).mock.calls.filter(call => call[1].partNumber === 1)).toHaveLength(1)
        expect(vi.mocked(fake.uploadPart).mock.calls.filter(call => call[1].partNumber === 2)).toHaveLength(2)
    })

    it('reconciles a lost multipart completion response as already complete', async () => {
        const repo = repository('multipart-complete-reconcile')
        const currentProfile = profile()
        const fake = adapter({
            completeMultipart: vi.fn(async () => {
                throw new NativeR2Error('E_R2_ALREADY_COMPLETE', 'Typed reconciliation.', false, null)
            }),
        })
        const coordinator = new R2UploadCoordinator(repo, fake, () => new Date(NOW))
        await coordinator.enqueuePlan(await coordinator.plan(currentProfile, [artifact(5, 9 * 1024 * 1024)], 'full-sync'))
        await expect(coordinator.runUntilIdle(currentProfile)).resolves.toMatchObject({ succeeded: 1, failed: 0 })
        await expect(coordinator.manifest(currentProfile)).resolves.toMatchObject({
            items: [expect.objectContaining({ contentSha256: artifact(5).contentSha256 })],
        })
    })

    it('continues a 1,000-object batch after isolated non-retryable failures', async () => {
        const repo = repository('thousand')
        const currentProfile = profile()
        const fake = adapter({
            putObject: vi.fn(async (_profile, job) => {
                const index = Number(job.remoteKey.match(/(\d+)\.png$/)?.[1] ?? 0)
                if (index % 100 === 0) throw new NativeR2Error('E_R2_AUTH', 'Typed fixture failure.', false, 403)
                return { remoteKey: job.remoteKey, uploaded: true, skippedSame: false, etag: `etag-${index}` }
            }),
        })
        const coordinator = new R2UploadCoordinator(repo, fake, () => new Date(NOW))
        const artifacts = Array.from({ length: 1_000 }, (_, index) => artifact(index))
        await coordinator.enqueuePlan(await coordinator.plan(currentProfile, artifacts, 'full-sync'))
        const summary = await coordinator.runUntilIdle(currentProfile)
        expect(summary).toEqual({ succeeded: 990, failed: 10, queued: 0, cancelled: 0 })
        expect(fake.putObject).toHaveBeenCalledTimes(1_000)
    }, 30_000)

    it('honors cancellation that changes a job after the ready snapshot', async () => {
        const repo = repository('snapshot-cancel')
        const currentProfile = profile()
        const first = createUploadJob(currentProfile.id, artifact(1), { id: 'job:snapshot:first', now: NOW })
        const second = createUploadJob(currentProfile.id, artifact(2), { id: 'job:snapshot:second', now: NOW })
        const fake = adapter({
            putObject: vi.fn(async (_profile, job) => {
                if (job.id === first.id) {
                    const target = await repo.getJob(second.id)
                    if (!target) throw new Error('Cancellation target was not found.')
                    await repo.updateJob(target.id, target.version, { state: 'cancelled' }, NOW)
                }
                return { remoteKey: job.remoteKey, uploaded: true, skippedSame: false, etag: 'etag' }
            }),
        })
        await repo.enqueue([first, second])

        const summary = await new R2UploadCoordinator(repo, fake, () => new Date(NOW)).runUntilIdle(currentProfile)

        expect(summary).toEqual({ succeeded: 1, failed: 0, queued: 0, cancelled: 1 })
        expect(fake.putObject).toHaveBeenCalledTimes(1)
    })

    it('never converts a conditional conflict into overwrite success', async () => {
        const repo = repository('conflict')
        const currentProfile = profile({ conflictPolicy: 'fail' })
        const fake = adapter({
            putObject: vi.fn(async () => {
                throw new NativeR2Error('E_R2_CONFLICT', 'Conditional create rejected.', false, 412)
            }),
        })
        const coordinator = new R2UploadCoordinator(repo, fake, () => new Date(NOW))
        const job = createUploadJob(currentProfile.id, {
            artifactId: 'artifact:conflict',
            localVariant: 'C:/fixture/conflict.png',
            remoteKey: 'exports/conflict.png',
            contentSha256: HASH,
            contentType: 'image/png',
            size: 128,
        }, { id: 'job:conflict', now: NOW })
        await repo.enqueue([job])
        const summary = await coordinator.runUntilIdle(currentProfile)
        expect(summary.failed).toBe(1)
        expect(fake.putObject).toHaveBeenCalledTimes(1)
        expect(fake.completeMultipart).not.toHaveBeenCalled()
    })

    it('aborts an active multipart before marking the job cancelled', async () => {
        const repo = repository('abort')
        const currentProfile = profile()
        const fake = adapter()
        const job = createUploadJob(currentProfile.id, artifact(8, 20 * 1024 * 1024), { id: 'job:abort', now: NOW })
        const [stored] = await repo.enqueue([job])
        const running = await repo.updateJob(stored.id, stored.version, {
            state: 'running',
            multipart: { ...stored.multipart, uploadId: 'upload-abort' },
        }, NOW)
        const coordinator = new R2UploadCoordinator(repo, fake, () => new Date(NOW))
        const cancelled = await coordinator.cancel(currentProfile, running.id)
        expect(fake.abortMultipart).toHaveBeenCalledWith(currentProfile, {
            remoteKey: running.remoteKey,
            uploadId: 'upload-abort',
        })
        expect(cancelled.state).toBe('cancelled')
    })
})
