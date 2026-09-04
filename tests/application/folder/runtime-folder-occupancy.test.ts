import { describe, expect, it } from 'vitest'

import type { ArtifactRecord } from '@/domain/organizer/types'
import type { GenerationJob, OutputReservation } from '@/domain/queue/types'
import {
    inspectFolderOccupancy,
    type FolderOccupancyAuthority,
} from '@/services/folder/runtime-folder-occupancy'

const binding = {
    resourceType: 'generation-folder-document' as const,
    resourceId: 'local',
    revision: 2,
    contentHash: `sha256:${'a'.repeat(64)}` as const,
}

function job(selector: string | null | 'scene-outside' | 'unknown'): GenerationJob {
    return {
        id: 'job:1',
        batchId: 'batch:1',
        snapshot: {
            parameters: selector === 'unknown'
                ? {}
                : selector === 'scene-outside'
                    ? { sceneWorkflow: { outputContext: {} } }
                    : { mainWorkflow: { output: { generationFolderId: selector } } },
            outputReservation: {
                reservationId: 'reservation:1', folderBinding: binding,
                directoryIdentity: `sha256:${'b'.repeat(64)}`, relativePath: 'image.png',
                collisionPolicy: 'fail', expectedExistingDigest: null,
            },
        },
    } as unknown as GenerationJob
}

function authority(input: {
    readonly job: GenerationJob
    readonly reservationState?: OutputReservation['state']
    readonly reservationFault?: 'missing' | 'owner-mismatch'
    readonly artifactSourceJobId?: string | null
}): FolderOccupancyAuthority {
    return {
        queue: {
            listJobs: async () => ({ items: [input.job], nextCursor: null }),
            getJob: async id => id === input.job.id ? input.job : null,
            getOutputReservation: async () => input.reservationFault === 'missing'
                ? null
                : ({
                    ...input.job.snapshot.outputReservation,
                    batchId: input.job.batchId,
                    jobId: input.reservationFault === 'owner-mismatch' ? 'job:other' : input.job.id,
                    state: input.reservationState ?? 'storage-pending',
                } as OutputReservation),
        } as FolderOccupancyAuthority['queue'],
        artifacts: {
            list: async () => ({
                items: input.artifactSourceJobId === undefined
                    ? []
                    : [{ sourceJobId: input.artifactSourceJobId } as ArtifactRecord],
                nextCursor: null,
            }),
        },
    }
}

describe('Folder production occupancy authority', () => {
    it('blocks an affected folder with an active output reservation', async () => {
        await expect(inspectFolderOccupancy(authority({ job: job('child') }), 'local', ['child']))
            .resolves.toEqual({ status: 'occupied', folderIds: ['child'] })
    })

    it('blocks an affected folder with Artifact lineage after reservation abandonment', async () => {
        await expect(inspectFolderOccupancy(authority({
            job: job('child'), reservationState: 'abandoned', artifactSourceJobId: 'job:1',
        }), 'local', ['child'])).resolves.toEqual({ status: 'occupied', folderIds: ['child'] })
    })

    it('fails closed when lineage cannot identify a Folder', async () => {
        await expect(inspectFolderOccupancy(authority({
            job: job('unknown'), artifactSourceJobId: null,
        }), 'local', ['child'])).resolves.toEqual({ status: 'unknown', folderIds: ['child'] })
    })

    it.each(['missing', 'owner-mismatch'] as const)(
        'fails closed on a %s reservation row for only the identified target',
        async reservationFault => {
            await expect(inspectFolderOccupancy(authority({
                job: job('child'), reservationFault,
            }), 'local', ['child', 'sibling'])).resolves.toEqual({
                status: 'unknown', folderIds: ['child'],
            })
        },
    )

    it('ignores a valid Main reservation explicitly outside Folder selection', async () => {
        await expect(inspectFolderOccupancy(authority({ job: job(null) }), 'local', ['child']))
            .resolves.toEqual({ status: 'empty' })
    })

    it('ignores valid Scene Artifact lineage outside Folder selection', async () => {
        await expect(inspectFolderOccupancy(authority({
            job: job('scene-outside'), reservationState: 'abandoned', artifactSourceJobId: 'job:1',
        }), 'local', ['child'])).resolves.toEqual({ status: 'empty' })
    })
})
