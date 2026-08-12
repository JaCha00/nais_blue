import { describe, expect, it, vi } from 'vitest'

import { createArtifactRecord, type ArtifactRecord } from '@/domain/organizer/types'
import {
    artifactHistoryPathKey,
    buildArtifactHistoryShadow,
    type ArtifactHistoryShadowRepository,
} from '@/services/organizer/artifact-history-shadow'
import type { OutputDestinationRequest, ResolvedOutputDirectory } from '@/services/output/platform-adapter'

const CHECKSUM = `sha256:${'a'.repeat(64)}`

function record(
    artifactId: string,
    fileName: string,
    sourceJobId: string | null = null,
): ArtifactRecord {
    return createArtifactRecord({
        artifactId,
        sourceJobId,
        sourceSceneId: sourceJobId === null ? null : 'scene:history',
        file: {
            directory: { kind: 'standard', root: 'pictures', segments: ['NAI_Blue_Output'] },
            fileName,
        },
        format: 'png',
        contentChecksum: CHECKSUM,
        size: 12,
        createdAt: '2026-07-17T00:00:00.000Z',
    })
}

function platform(resolveDirectory = vi.fn(async (_request: OutputDestinationRequest): Promise<ResolvedOutputDirectory> => ({
    path: 'NAI_Blue_Output',
    displayPath: 'C:\\Pictures\\NAI_Blue_Output',
    capabilityFallbackUsed: false,
}))) {
    return { resolveDirectory }
}

describe('Artifact History shadow', () => {
    it('matches the disk scan case-insensitively on Windows and preserves Queue lineage', async () => {
        const queueRecord = record('artifact:job:history', 'queued.png', 'job:history')
        const missingRecord = record('artifact:missing', 'missing.png')
        const repository: ArtifactHistoryShadowRepository = {
            list: vi.fn(async ({ cursor }) => cursor === null
                ? { items: [queueRecord], nextCursor: 'next-page' }
                : { items: [missingRecord], nextCursor: null }),
        }
        const runtime = platform()

        const shadow = await buildArtifactHistoryShadow([{
            name: 'queued.png',
            path: 'c:/pictures/nai_blue_output/queued.png',
        }, {
            name: 'disk-only.png',
            path: 'C:\\Pictures\\NAI_Blue_Output\\disk-only.png',
        }], repository, runtime)

        expect(shadow.lineageByPath.get(artifactHistoryPathKey('C:\\Pictures\\NAI_Blue_Output\\queued.png'))).toEqual({
            artifactId: 'artifact:job:history',
            sourceJobId: 'job:history',
            sourceSceneId: 'scene:history',
        })
        expect(shadow.unmatchedArtifactIds).toEqual(['artifact:missing'])
        expect(shadow.unmatchedDiskPaths).toEqual([
            artifactHistoryPathKey('C:\\Pictures\\NAI_Blue_Output\\disk-only.png'),
        ])
        expect(runtime.resolveDirectory).toHaveBeenCalledTimes(1)
        expect(repository.list).toHaveBeenNthCalledWith(1, { cursor: null, limit: 500 })
        expect(repository.list).toHaveBeenNthCalledWith(2, { cursor: 'next-page', limit: 500 })
    })

    it('keeps unresolved and missing artifact files as a non-blocking comparison result', async () => {
        const unresolved = record('artifact:unresolved', 'visible.png', 'job:unresolved')
        const absent = record('artifact:absent', 'absent.png')
        const repository: ArtifactHistoryShadowRepository = {
            list: async () => ({ items: [unresolved, absent], nextCursor: null }),
        }
        const runtime = platform(vi.fn(async () => {
            throw new Error('bookmark unavailable')
        }))

        const shadow = await buildArtifactHistoryShadow([{
            name: 'visible.png',
            path: '/history/visible.png',
        }], repository, runtime)

        expect(shadow.lineageByPath.size).toBe(0)
        expect(shadow.unmatchedArtifactIds).toEqual(['artifact:absent', 'artifact:unresolved'])
        expect(shadow.unmatchedDiskPaths).toEqual(['/history/visible.png'])
        // `absent.png` is compared without reaching the platform boundary
        // because it cannot match the current History grid by filename.
        expect(runtime.resolveDirectory).toHaveBeenCalledTimes(1)
    })
})
