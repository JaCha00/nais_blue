import { describe, expect, it } from 'vitest'

import {
    buildGenerateImagePayload,
    type BuildOptions,
    type GenerationRequest,
    type NaiImagePayload,
} from '@/services/nai/payload'
import { assertDeepEqual, loadFixtureJson } from '../helpers'

interface PayloadRequestFixture {
    request: GenerationRequest
    options: BuildOptions
}

describe('NovelAI payload parity fixtures', () => {
    it('matches the captured V4.5 text-generation payload exactly', async () => {
        const fixture = await loadFixtureJson<PayloadRequestFixture>(
            'payload/v4-5-text.request.json',
        )
        const expected = await loadFixtureJson<NaiImagePayload>(
            'payload/v4-5-text.expected.json',
        )

        const actual = buildGenerateImagePayload(fixture.request, fixture.options)

        assertDeepEqual(actual, expected, 'V4.5 text payload changed from its parity fixture')
        expect(actual.input).toBe(
            (actual.parameters.v4_prompt as { caption: { base_caption: string } })
                .caption.base_caption,
        )
        expect(actual.parameters.negative_prompt).toBe(
            (actual.parameters.v4_negative_prompt as { caption: { base_caption: string } })
                .caption.base_caption,
        )
    })
})
