import { existsSync, readFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { readNais2Params } from '@/lib/nais2-png-meta'
import type { GenerateImageResult, GenerationParams } from '@/services/novelai-types'
import { loadFixtureJson } from '../helpers'

const MATRIX_ENABLED = process.env.NAI_LIVE_MATRIX === '1'

interface MatrixCase {
    id: string
    workflow: 'main' | 'scene' | 'style-lab'
    model: string
    transport: 'standard' | 'stream'
    format: 'png' | 'webp'
    seed: number
}

interface OnlineMatrixFixture {
    cases: MatrixCase[]
}

function readToken(): string {
    const fromProcess = process.env.NAI_TOKEN?.trim()
    if (fromProcess) return fromProcess
    if (!existsSync('.env')) return ''
    const match = readFileSync('.env', 'utf8').match(/^\s*NAI_TOKEN\s*=\s*(.+?)\s*$/m)
    return match?.[1]?.replace(/^["']|["']$/g, '').trim() ?? ''
}

// The fixture owns model/workflow coverage; this adapter supplies only the
// credential-free generation defaults used by the production NAI client.
function params(matrixCase: MatrixCase): GenerationParams {
    return {
        prompt: 'single cobalt ceramic sphere on a plain neutral table, studio lighting',
        negative_prompt: 'lowres, bad quality, text, watermark',
        model: matrixCase.model,
        width: 512,
        height: 512,
        steps: 1,
        cfg_scale: 5,
        cfg_rescale: 0,
        sampler: 'k_euler',
        scheduler: 'native',
        smea: false,
        smea_dyn: false,
        variety: false,
        seed: matrixCase.seed,
        imageFormat: matrixCase.format,
        metadataMode: 'embedded',
        qualityToggle: false,
        ucPreset: 4,
        compositionMode: 'v2',
        engineVersion: 'composition-v2-release-matrix',
        sourceRevision: 0,
        promptParts: {
            base: 'single cobalt ceramic sphere on a plain neutral table, studio lighting',
            negative: 'lowres, bad quality, text, watermark',
            workflow: matrixCase.workflow,
        },
    }
}

function verifyResult(result: GenerateImageResult, matrixCase: MatrixCase): void {
    expect(result.success, result.error).toBe(true)
    expect(result.sentPayloadSummary).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.imageData).toBeTruthy()

    const bytes = new Uint8Array(Buffer.from(result.imageData!, 'base64'))
    if (matrixCase.format === 'png') {
        expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        const metadata = readNais2Params(bytes)
        expect(metadata?.version).toBe(2)
        if (metadata?.version === 2) {
            expect(metadata.engineVersion).toBe('composition-v2-release-matrix')
            expect(metadata.redactedPayloadHash).toBe(result.sentPayloadSummary)
        }
        return
    }

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WEBP')
}

describe.skipIf(!MATRIX_ENABLED)('NovelAI required online covering matrix', () => {
    let token = ''
    let client: typeof import('@/services/nai/client')
    let matrix: OnlineMatrixFixture

    beforeAll(async () => {
        token = readToken()
        if (!token) throw new Error('NAI_LIVE_MATRIX=1 requires NAI_TOKEN in the process or ignored .env file')
        vi.stubGlobal('window', { fetch: globalThis.fetch.bind(globalThis) })
        ;[client, matrix] = await Promise.all([
            import('@/services/nai/client'),
            loadFixtureJson<OnlineMatrixFixture>('payload/supported-online-matrix.json'),
        ])
    })

    afterAll(() => {
        token = ''
        vi.unstubAllGlobals()
    })

    it('passes every required model/format case without retaining response bytes', async () => {
        for (const matrixCase of matrix.cases) {
            const progress: number[] = []
            const result = matrixCase.transport === 'stream'
                ? await client.generateImageStream(token, params(matrixCase), value => progress.push(value))
                : await client.generateImage(token, params(matrixCase))

            verifyResult(result, matrixCase)
            if (matrixCase.transport === 'stream') expect(progress).toContain(100)
        }
    }, 600_000)

})
