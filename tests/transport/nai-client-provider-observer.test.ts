import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateImage } from '@/services/nai/client'
import { NaiTransportNetworkError } from '@/services/nai/transport'
import { NovelAIHttpError, type GenerationParams } from '@/services/novelai-types'

const params: GenerationParams = {
    prompt: 'observer fixture',
    negative_prompt: '',
    model: 'nai-diffusion-4-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfg_scale: 5,
    cfg_rescale: 0,
    sampler: 'k_euler',
    scheduler: 'native',
    smea: false,
    smea_dyn: false,
    variety: false,
    seed: 1,
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('NovelAI client provider observation', () => {
    it('keeps legacy failure results but preserves typed errors in opt-in throw mode', async () => {
        const cause = new TypeError('synthetic network failure')
        vi.stubGlobal('fetch', vi.fn(async () => { throw cause }))

        await expect(generateImage('token', params)).resolves.toMatchObject({ success: false })
        const thrown = await generateImage(
            'token',
            params,
            undefined,
            undefined,
            { errorMode: 'throw' },
        ).catch(error => error as NaiTransportNetworkError)
        expect(thrown).toBeInstanceOf(NaiTransportNetworkError)
        expect((thrown as Error & { cause?: unknown }).cause).toBe(cause)
    })

    it('preserves explicit HTTP status, body, and Retry-After', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', {
            status: 429,
            headers: { 'Retry-After': '11' },
        })))

        const thrown = await generateImage(
            'token',
            params,
            undefined,
            undefined,
            { errorMode: 'throw' },
        ).catch(error => error as NovelAIHttpError)

        expect(thrown).toBeInstanceOf(NovelAIHttpError)
        expect(thrown).toMatchObject({
            status: 429,
            responseBody: 'slow down',
            retryAfter: '11',
        })
    })
})
