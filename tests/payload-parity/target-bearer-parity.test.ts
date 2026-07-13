import { describe, expect, it } from 'vitest'

import {
    buildGenerateImagePayload,
    type BuildOptions,
    type GenerationRequest,
    type NaiImagePayload,
} from '@/services/nai/payload'
import { assertDeepEqual, loadFixtureJson } from '../helpers'

interface TargetBearerFixture {
    case: string
    sourceKind: string
    request: GenerationRequest
    options: BuildOptions
    expected: NaiImagePayload
    provenance: {
        webCapture: boolean
    }
}

const TARGET_BEARER_FIXTURES = [
    'v4-uc2-webp-nonstream.json',
    'raw-charref-preencoded-vibe.json',
    'i2i-inline-bearer.json',
    'infill-inline-bearer.json',
] as const

describe('synthetic target Bearer payload parity', () => {
    it.each(TARGET_BEARER_FIXTURES)('%s matches the pinned NAIS3 builder output', async (name) => {
        const fixture = await loadFixtureJson<TargetBearerFixture>(
            `payload/target-bearer/${name}`,
        )

        expect(fixture.sourceKind).toBe('synthetic-target-bearer')
        expect(fixture.provenance.webCapture).toBe(false)

        const actual = buildGenerateImagePayload(fixture.request, fixture.options)
        assertDeepEqual(
            actual,
            fixture.expected,
            `${fixture.case} changed from its pinned NAIS3-derived Bearer fixture`,
        )
    })
})
