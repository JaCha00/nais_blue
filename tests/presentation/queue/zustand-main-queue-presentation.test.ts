import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => {
    const generation = {
        history: [] as Array<{ id: string }>,
        previewImage: null as string | null,
        setGeneratingMode: vi.fn(),
        setIsGenerating: vi.fn(),
        setStreamProgress: vi.fn(),
        setPreviewImage: vi.fn((value: string | null) => { generation.previewImage = value }),
        addToHistory: vi.fn((value: { id: string }) => { generation.history = [value, ...generation.history] }),
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
        queue: {
            beginEnqueueOperation: vi.fn(() => 'operation-1'),
            completeEnqueueOperation: vi.fn(),
        },
        character: {
            vibeImages: [] as Array<{ id: string, encodedVibe?: string }>,
            updateVibeImage: vi.fn(),
            releaseImageData: vi.fn(),
        },
        auth: { refreshAnlas: vi.fn() },
        publishGeneratedArtifact: vi.fn(),
    }
})

vi.mock('@/stores/generation-store', () => ({ useGenerationStore: runtime.useGenerationStore }))
vi.mock('@/stores/queue-store', () => ({
    useQueueStore: { getState: () => runtime.queue },
}))
vi.mock('@/stores/character-store', () => ({
    useCharacterStore: { getState: () => runtime.character },
}))
vi.mock('@/stores/auth-store', () => ({
    useAuthStore: { getState: () => runtime.auth },
}))
vi.mock('@/stores/artifact-lifecycle-store', () => ({
    publishGeneratedArtifact: runtime.publishGeneratedArtifact,
}))

import { createZustandMainQueuePresentation } from '@/presentation/queue/zustand-main-queue-presentation'

describe('Zustand Main Queue presentation adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        runtime.generation.history = []
        runtime.generation.previewImage = null
        runtime.character.vibeImages = []
        runtime.queue.beginEnqueueOperation.mockReturnValue('operation-1')
    })

    it('projects enqueue, execution progress, and terminal cleanup', () => {
        const presentation = createZustandMainQueuePresentation()

        expect(presentation.beginEnqueueOperation()).toBe('operation-1')
        presentation.completeEnqueueOperation('operation-1')
        presentation.beginExecution()
        presentation.reportStreamProgress(45, 'data:image/png;base64,preview')
        presentation.finishExecution()

        expect(runtime.queue.beginEnqueueOperation).toHaveBeenCalledWith('main')
        expect(runtime.queue.completeEnqueueOperation).toHaveBeenCalledWith('main', 'operation-1')
        expect(runtime.generation.setGeneratingMode).toHaveBeenNthCalledWith(1, 'main')
        expect(runtime.generation.setIsGenerating).toHaveBeenNthCalledWith(1, true)
        expect(runtime.generation.setStreamProgress).toHaveBeenCalledWith(45)
        expect(runtime.generation.setPreviewImage).toHaveBeenCalledWith('data:image/png;base64,preview')
        expect(runtime.generation.setIsGenerating).toHaveBeenLastCalledWith(false)
        expect(runtime.character.releaseImageData).toHaveBeenCalledOnce()
    })

    it('commits and rolls back history while publishing lineage', () => {
        const presentation = createZustandMainQueuePresentation()
        const history = {
            id: 'history-1',
            url: 'thumbnail',
            prompt: 'prompt',
            seed: 7,
            timestamp: new Date(0),
        }

        presentation.commitHistory(history, 'final-image')
        presentation.publishArtifact({ path: 'output.png', sourceJobId: 'job-1' })
        presentation.rollbackHistory('history-1', 'final-image')

        expect(runtime.generation.addToHistory).toHaveBeenCalledWith(history)
        expect(runtime.publishGeneratedArtifact).toHaveBeenCalledWith({
            path: 'output.png',
            sourceJobId: 'job-1',
        })
        expect(runtime.generation.history).toEqual([])
        expect(runtime.generation.previewImage).toBeNull()
    })

    it('updates only missing Vibe encodings and refreshes the selected account', () => {
        runtime.character.vibeImages = [
            { id: 'cached', encodedVibe: 'existing' },
            { id: 'missing-1' },
            { id: 'missing-2' },
        ]
        const presentation = createZustandMainQueuePresentation()

        presentation.updateEncodedVibes(['encoded-1', 'encoded-2'])
        presentation.refreshAnlas(2)

        expect(runtime.character.updateVibeImage.mock.calls).toEqual([
            ['missing-1', { encodedVibe: 'encoded-1' }],
            ['missing-2', { encodedVibe: 'encoded-2' }],
        ])
        expect(runtime.auth.refreshAnlas).toHaveBeenCalledWith(2)
    })
})
