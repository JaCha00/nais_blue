import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
    const generation = {
        history: [] as Array<{ id: string }>,
        addToHistory: vi.fn((value: { id: string }) => {
            generation.history = [value, ...generation.history]
        }),
    }
    const useGenerationStore = Object.assign(() => undefined, {
        getState: () => generation,
        setState: vi.fn((project: (state: typeof generation) => Partial<typeof generation>) => {
            Object.assign(generation, project(generation))
        }),
    })
    return {
        generation,
        useGenerationStore,
        styleLab: { updateCombinationPreview: vi.fn() },
        publishGeneratedArtifact: vi.fn(),
    }
})

vi.mock('@/stores/generation-store', () => ({ useGenerationStore: runtime.useGenerationStore }))
vi.mock('@/stores/style-lab-store', () => ({
    useStyleLabStore: { getState: () => runtime.styleLab },
}))
vi.mock('@/stores/artifact-lifecycle-store', () => ({
    publishGeneratedArtifact: runtime.publishGeneratedArtifact,
}))

import { createZustandStyleLabQueuePresentation } from '@/presentation/queue/zustand-style-lab-queue-presentation'

describe('Zustand Style Lab Queue presentation adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        runtime.generation.history = []
    })

    it('projects begin and committed result facts into the existing read models', () => {
        const presentation = createZustandStyleLabQueuePresentation()
        const result = {
            comboId: 'combo-a',
            preview: {
                path: 'nais-style/result.webp',
                thumbnail: 'data:image/webp;base64,thumb',
                seed: 7,
                prompt: 'prompt',
                contextId: 'context-a',
            },
            history: {
                id: 'queue-history:job-a',
                url: 'data:image/webp;base64,thumb',
                thumbnail: 'data:image/webp;base64,thumb',
                prompt: 'prompt',
                seed: 7,
                timestamp: new Date(0),
                sourceJobId: 'job-a',
            },
            artifact: { path: 'nais-style/result.webp', sourceJobId: 'job-a' },
        }

        presentation.beginPreview('combo-a')
        presentation.commitResult(result)

        expect(runtime.styleLab.updateCombinationPreview).toHaveBeenNthCalledWith(1, 'combo-a', {
            isPreviewing: true,
            previewProgress: 0,
            previewError: undefined,
        })
        expect(runtime.styleLab.updateCombinationPreview).toHaveBeenNthCalledWith(2, 'combo-a', {
            previewImage: undefined,
            previewPath: 'nais-style/result.webp',
            previewThumbnail: 'data:image/webp;base64,thumb',
            previewSeed: 7,
            previewPrompt: 'prompt',
            previewContextId: 'context-a',
            previewProgress: 1,
            isPreviewing: false,
        })
        expect(runtime.generation.addToHistory).toHaveBeenCalledWith(result.history)
        expect(runtime.publishGeneratedArtifact).toHaveBeenCalledWith(result.artifact)
    })

    it('rolls back Queue history and clears terminal preview activity', () => {
        runtime.generation.history = [{ id: 'keep' }, { id: 'queue-history:job-a' }]
        const presentation = createZustandStyleLabQueuePresentation()

        presentation.rollbackResult('combo-a', 'queue-history:job-a')

        expect(runtime.generation.history).toEqual([{ id: 'keep' }])
        expect(runtime.styleLab.updateCombinationPreview).toHaveBeenCalledWith('combo-a', {
            isPreviewing: false,
            previewProgress: 0,
        })
    })
})
