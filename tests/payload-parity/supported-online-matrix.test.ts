import { describe, expect, it } from 'vitest'

import {
    buildGenerateImagePayload,
    type BuildOptions,
    type GenerationRequest,
    type NaiImagePayload,
} from '@/services/nai/payload'
import { assertDeepEqual, loadFixtureJson } from '../helpers'

type CoreModel =
    | 'nai-diffusion-5-full'
    | 'nai-diffusion-5-curated'
    | 'nai-diffusion-4-5-curated'
    | 'nai-diffusion-4-5-full'
    | 'nai-diffusion-4-curated-preview'
    | 'nai-diffusion-4-full'

interface MatrixCase {
    id: string
    workflow: 'main' | 'scene' | 'style-lab'
    model: CoreModel
    transport: 'standard' | 'stream'
    format: 'png' | 'webp'
    seed: number
}

interface ModelPayloadContract {
    model: CoreModel
    promptBase: string
    qualitySuffix: string
    negativeBase: string
    ucPreset0Prefix: string
    skipCfgAboveSigma?: number | null
    v5TagHints?: {
        tag_hint_qt: number
        tag_hint_uc_preset: number
        tag_hint_transparent_background: boolean
    }
}

interface OnlineMatrixFixture {
    sourceKind: string
    requiredModels: CoreModel[]
    requiredFormats: Array<'png' | 'webp'>
    modelPayloadContracts: ModelPayloadContract[]
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

function expectedForCase(
    base: NaiImagePayload,
    matrixCase: MatrixCase,
    contract: ModelPayloadContract,
): NaiImagePayload {
    const expected = structuredClone(base)
    const positive = `${contract.promptBase}, ${contract.qualitySuffix}`
    const negative = `${contract.ucPreset0Prefix}, ${contract.negativeBase}`
    expected.model = matrixCase.model
    expected.input = positive
    expected.parameters.image_format = matrixCase.format
    expected.parameters.negative_prompt = negative
    if (contract.skipCfgAboveSigma === undefined) delete expected.parameters.skip_cfg_above_sigma
    else expected.parameters.skip_cfg_above_sigma = contract.skipCfgAboveSigma
    expected.parameters.v4_prompt = {
        ...expected.parameters.v4_prompt as Record<string, unknown>,
        caption: {
            ...((expected.parameters.v4_prompt as { caption: Record<string, unknown> }).caption),
            base_caption: positive,
        },
    }
    expected.parameters.v4_negative_prompt = {
        ...expected.parameters.v4_negative_prompt as Record<string, unknown>,
        caption: {
            ...((expected.parameters.v4_negative_prompt as { caption: Record<string, unknown> }).caption),
            base_caption: negative,
        },
    }
    if (contract.v5TagHints === undefined) {
        delete expected.parameters.tag_hint_qt
        delete expected.parameters.tag_hint_uc_preset
        delete expected.parameters.tag_hint_transparent_background
    } else {
        Object.assign(expected.parameters, contract.v5TagHints)
    }
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
        expect(matrix.modelPayloadContracts.map(contract => contract.model)).toEqual(matrix.requiredModels)

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
        const contractByModel = new Map(
            matrix.modelPayloadContracts.map(contract => [contract.model, contract]),
        )

        for (const matrixCase of matrix.cases) {
            const contract = contractByModel.get(matrixCase.model)
            if (contract === undefined) throw new Error(`Missing model payload contract: ${matrixCase.model}`)
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
            const caseExpected = expectedForCase(expected, matrixCase, contract)
            caseExpected.parameters.seed = matrixCase.seed

            assertDeepEqual(
                buildGenerateImagePayload(request, options),
                caseExpected,
                `${matrixCase.id} changed from the release covering matrix`,
            )
        }
    })
})
