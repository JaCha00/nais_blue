import { describe, expect, it } from 'vitest'

import {
    buildGenerateImagePayload,
    type BuildOptions,
    type GenerationRequest,
    type NaiImagePayload,
} from '@/services/nai/payload'
import { assertDeepEqual, loadFixtureJson } from '../helpers'

type CoreModel =
    | 'nai-diffusion-4-5-curated'
    | 'nai-diffusion-4-5-full'
    | 'nai-diffusion-4-curated-preview'
    | 'nai-diffusion-4-full'

interface MatrixCase {
    id: string
    workflow: 'main' | 'scene' | 'style-lab'
    model: string
    transport: 'standard' | 'stream'
    format: 'png' | 'webp'
    seed: number
}

interface OnlineMatrixFixture {
    sourceKind: string
    requiredModels: CoreModel[]
    requiredFormats: Array<'png' | 'webp'>
    cases: MatrixCase[]
    retiredLegacyEvidence: Array<MatrixCase & {
        observedResult: 'pass' | 'provider-http-400'
        releaseAuthority: 'retired' | 'retired-with-family'
    }>
    actualAppCases: Array<{
        id: string
        workflow: 'main' | 'scene' | 'style-lab'
        transport: 'standard' | 'stream' | 'source-zip'
        format: 'png' | 'webp'
        expectedCommit: string
    }>
    provenance: {
        webCapture: boolean
        liveResponseStored: boolean
        sensitiveDataRemoved: boolean
    }
}

interface BasePayloadFixture {
    request: GenerationRequest
    options: BuildOptions
}

async function fixtures(): Promise<{
    matrix: OnlineMatrixFixture
    base: BasePayloadFixture
    expected: NaiImagePayload
}> {
    const [matrix, base, expected] = await Promise.all([
        loadFixtureJson<OnlineMatrixFixture>('payload/supported-online-matrix.json'),
        loadFixtureJson<BasePayloadFixture>('payload/v4-5-text.request.json'),
        loadFixtureJson<NaiImagePayload>('payload/v4-5-text.expected.json'),
    ])
    return { matrix, base, expected }
}

function expectedForCase(base: NaiImagePayload, matrixCase: MatrixCase): NaiImagePayload {
    const expected = structuredClone(base)
    expected.model = matrixCase.model
    expected.parameters.image_format = matrixCase.format
    expected.parameters.skip_cfg_above_sigma = matrixCase.model.includes('4-5') ? 58 : 19
    if (matrixCase.transport === 'stream') expected.parameters.stream = 'msgpack'
    else delete expected.parameters.stream
    return expected
}

describe('supported online model/format covering matrix', () => {
    it('covers every required model/format pair and every production workflow/transport', async () => {
        const { matrix } = await fixtures()
        expect(matrix.sourceKind).toBe('synthetic-target-bearer-covering-matrix')
        expect(matrix.provenance).toMatchObject({
            webCapture: false,
            liveResponseStored: false,
            sensitiveDataRemoved: true,
        })

        for (const model of matrix.requiredModels) {
            for (const format of matrix.requiredFormats) {
                expect(matrix.cases).toContainEqual(expect.objectContaining({ model, format }))
            }
        }

        expect(new Set(matrix.cases.map(item => item.workflow))).toEqual(
            new Set(['main', 'scene', 'style-lab']),
        )
        expect(new Set(matrix.cases.map(item => item.transport))).toEqual(
            new Set(['standard', 'stream']),
        )
        expect(matrix.actualAppCases).toEqual(expect.arrayContaining([
            expect.objectContaining({ workflow: 'main', transport: 'source-zip' }),
            expect.objectContaining({ workflow: 'scene' }),
            expect.objectContaining({ workflow: 'style-lab', expectedCommit: 'none-after-cancel' }),
        ]))
    })

    it('keeps the bounded V3/Furry V3 retirement evidence outside release authority', async () => {
        const { matrix } = await fixtures()
        expect(matrix.requiredModels.some(model => model.includes('diffusion-3'))).toBe(false)
        expect(matrix.retiredLegacyEvidence).toEqual([
            expect.objectContaining({
                model: 'nai-diffusion-3',
                observedResult: 'pass',
                releaseAuthority: 'retired-with-family',
            }),
            expect.objectContaining({
                model: 'nai-diffusion-furry-3',
                observedResult: 'provider-http-400',
                releaseAuthority: 'retired',
            }),
        ])
    })

    it('has zero unexplained payload diff across the required matrix', async () => {
        const { matrix, base, expected } = await fixtures()

        for (const matrixCase of matrix.cases) {
            const request: GenerationRequest = {
                ...structuredClone(base.request),
                model: matrixCase.model,
                seed: matrixCase.seed,
            }
            const options: BuildOptions = {
                ...structuredClone(base.options),
                imageFormat: matrixCase.format,
                ...(matrixCase.transport === 'stream' ? { stream: 'msgpack' as const } : { stream: undefined }),
            }
            const caseExpected = expectedForCase(expected, matrixCase)
            caseExpected.parameters.seed = matrixCase.seed

            assertDeepEqual(
                buildGenerateImagePayload(request, options),
                caseExpected,
                `${matrixCase.id} changed from the release covering matrix`,
            )
        }
    })
})
