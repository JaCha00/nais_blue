import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationJob } from '@/domain/queue/types'
import type { QueueExecutorContext } from '@/services/queue/durable-queue-coordinator'
import type { GenerationParams } from '@/services/novelai-types'

const runtime = vi.hoisted(() => ({
    decode: vi.fn(),
    hydrate: vi.fn(),
    transport: vi.fn(),
    outputWrite: vi.fn(),
}))

vi.mock('@/services/style-lab/style-lab-job-snapshot-codec', () => ({
    decodeStyleLabJobSnapshot: runtime.decode,
}))
vi.mock('@/services/queue/queue-resource-materializer', () => ({
    getRuntimeQueueResourceMaterializer: vi.fn(() => ({})),
    hydrateGenerationParams: runtime.hydrate,
    hashQueueResourceBytes: vi.fn(),
}))
vi.mock('@/services/generation/novelai-image-transport', () => ({
    executeNovelAIImageTransport: runtime.transport,
}))
vi.mock('@/services/output/output-writer', () => ({
    getRuntimeOutputWriter: vi.fn(() => ({ write: runtime.outputWrite })),
}))
vi.mock('@/services/style-lab/indexeddb-style-lab-repository', () => ({
    getStyleLabRepository: vi.fn(),
}))
vi.mock('@/services/style-lab/style-lab-vault', () => ({ getStyleLabVault: vi.fn() }))

import { executeStyleLabQueueJob } from '@/services/style-lab/style-lab-queue-executor'

const params: GenerationParams = {
    prompt: 'prompt',
    negative_prompt: '',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfg_scale: 5,
    cfg_rescale: 0,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    smea: false,
    smea_dyn: false,
    variety: false,
    seed: 7,
}

describe('Style Lab Queue executor presentation cleanup', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        runtime.decode.mockReturnValue({
            generationParams: {},
            resourceBindings: [],
            resourceArrayLengths: {},
            queueExecution: { streaming: false, sourceEdit: false },
            styleLabWorkflow: {
                comboId: 'combo-a',
                output: { imageFormat: 'png' },
            },
        })
        runtime.hydrate.mockResolvedValue({ ...params })
        runtime.transport.mockResolvedValue({ success: false, termination: 'cancelled' })
    })

    it('clears preview activity when provider transport is cancelled before output', async () => {
        const presentation = {
            beginPreview: vi.fn(),
            commitResult: vi.fn(),
            rollbackResult: vi.fn(),
            clearPreview: vi.fn(),
        }
        const context = {
            token: 'credential',
            signal: new AbortController().signal,
            updateProgress: vi.fn().mockResolvedValue(undefined),
            canCommit: vi.fn(() => true),
        } as unknown as QueueExecutorContext
        const job = {
            id: 'job-a',
            snapshot: { prompt: { positive: 'prompt' }, resources: [] },
        } as unknown as GenerationJob

        await executeStyleLabQueueJob(job, context, {
            presentation,
            repository: {} as never,
            vault: {} as never,
        })

        expect(presentation.beginPreview).toHaveBeenCalledWith('combo-a')
        expect(presentation.clearPreview).toHaveBeenCalledWith('combo-a')
        expect(presentation.commitResult).not.toHaveBeenCalled()
        expect(runtime.outputWrite).not.toHaveBeenCalled()
    })
})
