import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import type { DistributionPolicy, DistributionVariant } from '@/domain/organizer/types'
import {
    ArtifactRepositoryError,
    IndexedDBArtifactRepository,
} from '@/services/organizer/artifact-repository'

const NOW = '2026-07-14T12:00:00.000Z'
const HASH_A = `sha256:${'a'.repeat(64)}`
const HASH_B = `sha256:${'b'.repeat(64)}`
let databaseCounter = 0

function repository(label: string): IndexedDBArtifactRepository {
    databaseCounter += 1
    return new IndexedDBArtifactRepository({
        factory: new IDBFactory() as unknown as IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName: `organizer-${label}-${databaseCounter}`,
    })
}

function policy(): DistributionPolicy {
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
    }
}

function variant(id = 'distribution-1'): DistributionVariant {
    return {
        variantId: id,
        status: 'pending',
        file: null,
        requestedFileName: 'portrait-distribution.png',
        format: 'png',
        contentChecksum: null,
        size: null,
        sidecar: null,
        policy: policy(),
        sanitizationPolicyVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
        failure: null,
    }
}

async function putOriginal(repo: IndexedDBArtifactRepository, artifactId = 'artifact-1', checksum = HASH_A) {
    return repo.putOriginal({
        artifactId,
        sourceJobId: 'job-1',
        sourceSceneId: 'scene-1',
        file: { directory: { kind: 'standard', root: 'app-data', segments: ['nais2', 'organizer', 'sources'] }, fileName: `${artifactId}.png` },
        format: 'png',
        contentChecksum: checksum,
        size: 123,
        createdAt: NOW,
    })
}

describe('Organizer artifact repository', () => {
    it('keeps original identity immutable and links distribution sidecar and R2 refs by artifactId', async () => {
        const repo = repository('linkage')
        await putOriginal(repo)
        await repo.addDistribution('artifact-1', variant(), NOW)
        const completed = await repo.updateDistribution('artifact-1', 'distribution-1', undefined, current => ({
            ...current,
            status: 'succeeded',
            file: { directory: policy().destination, fileName: 'portrait-distribution.png' },
            contentChecksum: HASH_B,
            size: 98,
            sidecar: { file: { directory: policy().destination, fileName: 'portrait-distribution.nais-blue.artifact.json' }, digest: HASH_A },
            updatedAt: NOW,
        }), NOW)

        const linked = await repo.replaceRemoteObjectRef('artifact-1', {
            profileId: 'r2-profile',
            uploadJobId: 'upload-1',
            artifactId: 'artifact-1',
            variantId: 'distribution-1',
            remoteKey: 'exports/portrait-distribution.png',
            state: 'queued',
            updatedAt: NOW,
            failure: null,
        }, NOW)

        expect(completed.original.contentChecksum).toBe(HASH_A)
        expect(linked.sidecar?.file.fileName).toBe('portrait-distribution.nais-blue.artifact.json')
        expect(linked.remoteObjectRefs).toEqual([expect.objectContaining({ artifactId: 'artifact-1', variantId: 'distribution-1' })])
        await expect(putOriginal(repo, 'artifact-1', HASH_B)).rejects.toMatchObject({ code: 'E_ARTIFACT_ORIGINAL_IMMUTABLE' })
    })

    it('pages without skipping a record, supporting large virtual browser loads', async () => {
        const repo = repository('pages')
        await putOriginal(repo, 'artifact-a')
        await putOriginal(repo, 'artifact-b')
        await putOriginal(repo, 'artifact-c')

        const first = await repo.list({ limit: 2 })
        const second = await repo.list({ limit: 2, cursor: first.nextCursor })
        expect([...first.items, ...second.items].map(record => record.artifactId)).toEqual(['artifact-a', 'artifact-b', 'artifact-c'])
        expect(second.nextCursor).toBeNull()
    })

    it('removes only an untouched original when an owning output transaction rolls back', async () => {
        const repo = repository('rollback-guard')
        const record = await putOriginal(repo)

        await expect(repo.removeOriginalIfUnmodified({
            artifactId: record.artifactId,
            file: record.original.file,
            contentChecksum: record.contentChecksum,
            size: record.original.size,
        })).resolves.toBe(true)
        await expect(repo.get(record.artifactId)).resolves.toBeNull()

        const retained = await putOriginal(repo, 'artifact-retained')
        await repo.addDistribution(retained.artifactId, variant(), NOW)
        await expect(repo.removeOriginalIfUnmodified({
            artifactId: retained.artifactId,
            file: retained.original.file,
            contentChecksum: retained.contentChecksum,
            size: retained.original.size,
        })).resolves.toBe(false)
        await expect(repo.get(retained.artifactId)).resolves.not.toBeNull()
    })

    it('rejects raw-path/secret-shaped persistence and dangling remote links', async () => {
        const repo = repository('safe-projection')
        await putOriginal(repo)
        await expect(repo.addDistribution('artifact-1', {
            ...variant('unsafe-variant'),
            policy: { ...policy(), authorization: 'credential-shaped' } as DistributionPolicy,
        }, NOW)).rejects.toBeInstanceOf(ArtifactRepositoryError)

        await repo.addDistribution('artifact-1', variant())
        await expect(repo.replaceRemoteObjectRef('artifact-1', {
            profileId: 'r2-profile',
            uploadJobId: null,
            artifactId: 'another-artifact',
            variantId: 'distribution-1',
            remoteKey: 'exports/file.png',
            state: 'queued',
            updatedAt: NOW,
            failure: null,
        }, NOW)).rejects.toMatchObject({ code: 'E_ARTIFACT_RECORD_INVALID' })
    })
})
