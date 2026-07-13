import { existsSync, readFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { readNais2Params } from '@/lib/nais2-png-meta'
import type { GenerateImageResult, GenerationParams } from '@/services/novelai-types'

const LIVE_ENABLED = process.env.NAI_LIVE === '1'

function readToken(): string {
    const fromProcess = process.env.NAI_TOKEN?.trim()
    if (fromProcess) return fromProcess
    if (!existsSync('.env')) return ''
    const match = readFileSync('.env', 'utf8').match(/^\s*NAI_TOKEN\s*=\s*(.+?)\s*$/m)
    return match?.[1]?.replace(/^["']|["']$/g, '').trim() ?? ''
}

function params(seed: number, steps = 4): GenerationParams {
    return {
        prompt: 'single red apple on a plain white table, simple studio lighting',
        negative_prompt: 'lowres, bad quality, text, watermark',
        model: 'nai-diffusion-4-5-curated',
        width: 512,
        height: 512,
        steps,
        cfg_scale: 5,
        cfg_rescale: 0,
        sampler: 'k_euler',
        scheduler: 'native',
        smea: false,
        smea_dyn: false,
        variety: false,
        seed,
        imageFormat: 'png',
        metadataMode: 'embedded',
        qualityToggle: false,
        ucPreset: 4,
        compositionMode: 'v2',
        engineVersion: 'composition-v2-live-smoke',
        sourceRevision: 0,
        promptParts: {
            base: 'single red apple on a plain white table, simple studio lighting',
            negative: 'lowres, bad quality, text, watermark',
        },
    }
}

function verifyResult(result: GenerateImageResult): void {
    expect(result.success, result.error).toBe(true)
    expect(result.sentPayloadSummary).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.imageData).toBeTruthy()

    const bytes = new Uint8Array(Buffer.from(result.imageData!, 'base64'))
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const metadata = readNais2Params(bytes)
    expect(metadata?.version).toBe(2)
    if (metadata?.version === 2) {
        expect(metadata.engineVersion).toBe('composition-v2-live-smoke')
        expect(metadata.redactedPayloadHash).toBe(result.sentPayloadSummary)
    }
}

describe.skipIf(!LIVE_ENABLED)('NovelAI production client live smoke', () => {
    let token = ''
    let client: typeof import('@/services/nai/client')

    beforeAll(async () => {
        token = readToken()
        if (!token) throw new Error('NAI_LIVE=1 requires NAI_TOKEN in the process or ignored .env file')
        vi.stubGlobal('window', { fetch: globalThis.fetch.bind(globalThis) })
        client = await import('@/services/nai/client')
    })

    afterAll(() => {
        token = ''
        vi.unstubAllGlobals()
    })

    it('generates a fixed-seed PNG through the production adapter and embeds Metadata v2', async () => {
        verifyResult(await client.generateImage(token, params(17071301)))
    }, 120_000)

    it('parses the msgpack streaming endpoint and reports a final event', async () => {
        const progress: number[] = []
        const result = await client.generateImageStream(
            token,
            params(17071302),
            value => progress.push(value),
        )

        verifyResult(result)
        expect(progress).toContain(100)
    }, 120_000)

    it('cancels an in-flight production request through AbortSignal', async () => {
        const controller = new AbortController()
        const pending = client.generateImage(token, params(17071303, 28), controller.signal)
        setTimeout(() => controller.abort(), 25)
        const result = await pending

        expect(result.success).toBe(false)
        expect(result.error).toContain('취소')
    }, 120_000)
})
