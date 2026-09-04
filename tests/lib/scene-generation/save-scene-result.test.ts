import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
    order: [] as string[],
    write: vi.fn(async (request: {
        commitWorkflow: (result: unknown) => Promise<void>
        rollbackWorkflow?: (result: unknown, cause: unknown) => Promise<void>
        destination: { portableDirectory?: unknown }
    }) => {
        runtime.order.push('output')
        const result = {
            transactionId: 'txn-a',
            fileName: 'result.png',
            path: 'NAI_Blue_Scene/result.png',
            file: { kind: 'path', path: 'result.png' },
            directory: { baseDir: 'Picture', path: 'NAI_Blue_Scene' },
            finalImage: {
                contentChecksum: `sha256:${'a'.repeat(64)}`,
                byteSize: 1,
                portableDirectory: request.destination.portableDirectory
                    ?? { kind: 'standard', root: 'pictures', segments: ['NAI_Blue_Scene'] },
            },
            capabilityFallbackUsed: false,
        }
        try {
            await request.commitWorkflow(result)
        } catch (error) {
            await request.rollbackWorkflow?.(result, error)
            throw error
        }
        return { status: 'committed', result }
    }),
}))

vi.mock('@/services/output/output-writer', () => ({
    getRuntimeOutputWriter: () => ({ write: runtime.write }),
}))
vi.mock('@/lib/image-utils', () => ({ createThumbnail: vi.fn() }))

import {
    registerDirectSceneArtifact,
    saveSceneResult,
} from '@/lib/scene-generation/save-scene-result'
import { bindDurableSceneOutputDirectory } from '@/lib/scene-output-portable-locator'
import { runtimePortablePathTokenRegistry } from '@/platform/portable-resources'
import {
    BACKUP_STORE_KEYS,
    getIndexedDBItemStrict,
    SCENE_OUTPUT_PORTABLE_TOKEN_STORE_KEY,
} from '@/lib/indexed-db'

describe('saveSceneResult authority ordering', () => {
    beforeEach(() => {
        runtime.order = []
        vi.clearAllMocks()
    })

    it('commits OutputWriter, ArtifactRecord, durable job, Scene link, and presentation in order', async () => {
        const presentation = {
            readOutputDefaults: () => ({
                useAbsoluteScenePath: false,
                metadataMode: 'sidecar-only' as const,
                presetName: 'Preset',
                presetPathSegments: ['Preset'],
                fallbackPromptParts: { base: '', additional: '', detail: '', negative: '', inpainting: '' },
            }),
            commitResult: () => { runtime.order.push('presentation') },
            rollbackResult: vi.fn(),
            reportCapabilityFallback: vi.fn(),
            updateEncodedVibes: vi.fn(),
        }
        const saved = await saveSceneResult(
            { id: 'scene-a', name: 'Scene' },
            { activePresetId: 'preset-a', sceneSavePath: 'NAI_Blue_Scene' },
            'prompt',
            { seed: 1, imageFormat: 'png' } as never,
            'AA==',
            'image/png',
            undefined,
            {
                presentation,
                registerArtifact: async () => {
                    runtime.order.push('artifact')
                    return { artifactId: 'artifact-a', sourceJobId: 'job-a', sourceSceneId: 'scene-a' }
                },
                linkArtifact: async () => { runtime.order.push('scene-link') },
                commitDurable: async () => { runtime.order.push('durable') },
            },
        )
        expect(saved).toBe(true)
        expect(runtime.order).toEqual(['output', 'artifact', 'durable', 'scene-link', 'presentation'])
    })

    it('never creates a Scene link when the durable Queue commit fails', async () => {
        const rollbackArtifact = vi.fn(() => { runtime.order.push('artifact-rollback') })
        const presentation = {
            readOutputDefaults: () => ({
                useAbsoluteScenePath: false,
                metadataMode: 'sidecar-only' as const,
                presetName: 'Preset',
                presetPathSegments: ['Preset'],
                fallbackPromptParts: { base: '', additional: '', detail: '', negative: '', inpainting: '' },
            }),
            commitResult: vi.fn(),
            rollbackResult: vi.fn(),
            reportCapabilityFallback: vi.fn(),
            updateEncodedVibes: vi.fn(),
        }

        await expect(saveSceneResult(
            { id: 'scene-a', name: 'Scene' },
            { activePresetId: 'preset-a', sceneSavePath: 'NAI_Blue_Scene' },
            'prompt',
            { seed: 1, imageFormat: 'png' } as never,
            'AA==',
            'image/png',
            undefined,
            {
                presentation,
                registerArtifact: async () => {
                    runtime.order.push('artifact')
                    return { artifactId: 'artifact-a', sourceJobId: 'job-a', sourceSceneId: 'scene-a' }
                },
                linkArtifact: async () => { runtime.order.push('scene-link') },
                commitDurable: async () => {
                    runtime.order.push('durable')
                    throw new Error('durable failure')
                },
                rollbackArtifact,
            },
        )).rejects.toThrow('durable failure')

        expect(runtime.order).toEqual(['output', 'artifact', 'durable', 'artifact-rollback'])
        expect(presentation.commitResult).not.toHaveBeenCalled()
    })

    it('rejects Artifact registration when OutputWriter has no durable portable locator', async () => {
        const repository = {
            get: vi.fn(),
            putOriginal: vi.fn(),
            removeOriginalIfUnmodified: vi.fn(),
        }
        await expect(registerDirectSceneArtifact('job-a', 'scene-a', {
            transactionId: 'txn-a',
            fileName: 'result.png',
            path: 'D:\\Images\\result.png',
            file: { kind: 'path', path: 'D:\\Images\\result.png' },
            directory: { baseDir: null, path: 'D:\\Images' },
            finalImage: {
                contentChecksum: `sha256:${'a'.repeat(64)}`,
                byteSize: 1,
            },
            capabilityFallbackUsed: false,
        }, repository)).rejects.toThrow('durable portable locator')

        expect(repository.get).not.toHaveBeenCalled()
        expect(repository.putOriginal).not.toHaveBeenCalled()
    })

    it('keeps a durable job bookmark immutable while safely deduplicating retries', async () => {
        const first = await bindDurableSceneOutputDirectory('D:\\Images\\A')
        const retry = await bindDurableSceneOutputDirectory('D:\\Images\\A')
        const changed = await bindDurableSceneOutputDirectory('D:\\Images\\B')

        expect(retry).toBe(first)
        expect(changed).not.toBe(first)
        expect(runtimePortablePathTokenRegistry.resolve(first)?.opaqueToken).toBe('D:\\Images\\A')
        expect(await getIndexedDBItemStrict(SCENE_OUTPUT_PORTABLE_TOKEN_STORE_KEY)).toContain('D:\\\\Images\\\\A')
        expect(BACKUP_STORE_KEYS).not.toContain(SCENE_OUTPUT_PORTABLE_TOKEN_STORE_KEY)
    })

    it('publishes absolute output through a logical bookmark without persisting its raw path', async () => {
        const presentation = {
            readOutputDefaults: () => ({
                useAbsoluteScenePath: true,
                metadataMode: 'sidecar-only' as const,
                presetName: 'Preset',
                presetPathSegments: ['Preset'],
                fallbackPromptParts: { base: '', additional: '', detail: '', negative: '', inpainting: '' },
            }),
            commitResult: vi.fn(),
            rollbackResult: vi.fn(),
            reportCapabilityFallback: vi.fn(),
            updateEncodedVibes: vi.fn(),
        }

        let locator: unknown
        await expect(saveSceneResult(
            { id: 'scene-a', name: 'Scene' },
            { activePresetId: 'preset-a', sceneSavePath: 'D:\\Images' },
            'prompt',
            { seed: 1, imageFormat: 'png' } as never,
            'AA==',
            'image/png',
            undefined,
            {
                presentation,
                sourceJobId: 'job-absolute-a',
                registerArtifact: async output => {
                    locator = output.finalImage?.portableDirectory
                    return { artifactId: 'artifact-a', sourceJobId: 'job-a', sourceSceneId: 'scene-a' }
                },
            },
        )).resolves.toBe(true)
        expect(locator).toEqual({
            kind: 'bookmark',
            bookmarkId: expect.stringMatching(/^scene-output:immutable:[a-f0-9]{64}$/),
            segments: ['Preset', 'Scene'],
        })
        expect(JSON.stringify(locator)).not.toContain('D:\\\\Images')
        expect(presentation.commitResult).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'artifact-a' }))
    })

    it('fails closed instead of publishing a session-only image when Artifact registration fails', async () => {
        const presentation = {
            readOutputDefaults: () => ({
                useAbsoluteScenePath: true,
                metadataMode: 'sidecar-only' as const,
                presetName: 'Preset',
                presetPathSegments: ['Preset'],
                fallbackPromptParts: { base: '', additional: '', detail: '', negative: '', inpainting: '' },
            }),
            commitResult: vi.fn(),
            rollbackResult: vi.fn(),
            reportCapabilityFallback: vi.fn(),
            updateEncodedVibes: vi.fn(),
        }

        await expect(saveSceneResult(
            { id: 'scene-a', name: 'Scene' },
            { activePresetId: 'preset-a', sceneSavePath: 'D:\\Images' },
            'prompt',
            { seed: 1, imageFormat: 'png' } as never,
            'AA==',
            'image/png',
            undefined,
            { presentation, sourceJobId: 'job-absolute-b', registerArtifact: async () => null },
        )).rejects.toThrow('durable ArtifactRecord')
        expect(presentation.commitResult).not.toHaveBeenCalled()
    })
})
