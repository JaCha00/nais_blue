import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateImageResult, GenerationParams } from '@/services/novelai-types'

const provider = vi.hoisted(() => ({
    generateImage: vi.fn(),
    generateImageStream: vi.fn(),
}))

vi.mock('@/services/novelai-api', () => ({
    generateImage: provider.generateImage,
    generateImageStream: provider.generateImageStream,
}))

import { executeNovelAIImageTransport } from '@/services/generation/novelai-image-transport'

const params: GenerationParams = {
    prompt: 'shared transport fixture',
    negative_prompt: '',
    model: 'nai-diffusion-4-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfg_scale: 6,
    cfg_rescale: 0,
    sampler: 'k_euler',
    scheduler: 'native',
    smea: false,
    smea_dyn: false,
    variety: false,
    seed: 73,
}

const standardResult: GenerateImageResult = { success: true, imageData: 'standard-result' }
const streamResult: GenerateImageResult = { success: true, imageData: 'stream-result' }

describe('NovelAI image transport', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        provider.generateImage.mockResolvedValue(standardResult)
        provider.generateImageStream.mockResolvedValue(streamResult)
    })

    it('forwards a standard request and returns the provider result unchanged', async () => {
        const signal = new AbortController().signal

        await expect(executeNovelAIImageTransport({
            token: 'credential',
            params,
            imageFormat: 'png',
            streaming: false,
            signal,
        })).resolves.toBe(standardResult)

        expect(provider.generateImage).toHaveBeenCalledWith('credential', params, signal)
        expect(provider.generateImageStream).not.toHaveBeenCalled()
    })

    it('normalizes streaming previews without changing progress or result', async () => {
        provider.generateImageStream.mockImplementation(async (
            _token: string,
            _params: GenerationParams,
            onProgress: (progress: number, partialImage?: string) => void,
        ) => {
            onProgress(41, 'partial')
            onProgress(59)
            return streamResult
        })
        const onProgress = vi.fn()

        await expect(executeNovelAIImageTransport({
            token: 'credential',
            params,
            imageFormat: 'webp',
            streaming: true,
            signal: new AbortController().signal,
            onProgress,
        })).resolves.toBe(streamResult)

        expect(provider.generateImage).not.toHaveBeenCalled()
        expect(onProgress).toHaveBeenNthCalledWith(1, 41, 'data:image/webp;base64,partial')
        expect(onProgress).toHaveBeenNthCalledWith(2, 59, undefined)
    })
})
