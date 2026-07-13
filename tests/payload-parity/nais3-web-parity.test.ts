import { describe, expect, it } from 'vitest'

import type { NaiImagePayload } from '@/services/nai/payload'
import {
    assertDeepEqual,
    deepDiff,
    loadFixtureJson,
    type DeepDifference,
} from '../helpers'
import {
    adaptNaiWebPayloadFixture,
    buildAdaptedNaiWebPayload,
} from './nai-web-fixture-adapter'

const EXACT_FIXTURES = [
    'nai-web-charref.json',
    'nai-web-t2i-2char.json',
    'nai-web-t2i-coords.json',
    'nai-web-t2i-default.json',
    'nai-web-t2i-quality.json',
    'nai-web-t2i-uc-humanfocus.json',
    'nai-web-t2i-uc-light.json',
    'nai-web-t2i-uc-none.json',
    'nai-web-t2i-variety-1024.json',
    'nai-web-t2i-variety.json',
] as const

const GAP_CASES = [
    {
        artifact: 'payload/gaps/nai-web-i2i.gap.json',
        fixture: 'nai-web-i2i.json',
        gapKind: 'cached-i2i',
    },
    {
        artifact: 'payload/gaps/nai-web-vibe.gap.json',
        fixture: 'nai-web-vibe.json',
        gapKind: 'cached-vibe',
    },
] as const

const FIXTURE_ROOT = 'payload/nais3-web'

/**
 * Checked-in gap artifact contract. `expected` is the sanitized web/NAIS3
 * payload, while `actual` and `differences` must be reproducible from the
 * current target builder. Updating either is an explicit gap review event.
 */
export interface NaiWebPayloadGapArtifact {
    schemaVersion: 1
    fixture: string
    classification: 'web-session-vs-bearer-transport'
    expected: NaiImagePayload
    actual: NaiImagePayload
    differences: DeepDifference[]
}

describe('sanitized NAIS3 NAI-web payload parity', () => {
    it.each(EXACT_FIXTURES)('deep-equals %s through the target fixture adapter', async (filename) => {
        const fixturePath = `${FIXTURE_ROOT}/${filename}`
        const fixture = await loadFixtureJson(fixturePath)
        const adapted = adaptNaiWebPayloadFixture(fixture)

        expect(adapted.kind).toBe('exact')
        if (adapted.kind !== 'exact') {
            throw new Error(`${fixturePath} unexpectedly classified as ${adapted.gapKind}`)
        }

        assertDeepEqual(
            buildAdaptedNaiWebPayload(adapted),
            adapted.expected,
            `${filename} differs from the sanitized web/NAIS3 payload`,
        )
    })

    it.each(GAP_CASES)(
        'keeps $gapKind expected/actual differences synchronized with its artifact',
        async ({ artifact: artifactPath, fixture: filename, gapKind }) => {
            const fixturePath = `${FIXTURE_ROOT}/${filename}`
            const fixture = await loadFixtureJson(fixturePath)
            const adapted = adaptNaiWebPayloadFixture(fixture)

            expect(adapted.kind).toBe('transport-gap')
            if (adapted.kind !== 'transport-gap') {
                throw new Error(`${fixturePath} unexpectedly classified as exact parity`)
            }
            expect(adapted.gapKind).toBe(gapKind)

            const actual = buildAdaptedNaiWebPayload(adapted)
            const differences = deepDiff(actual, adapted.expected)
            expect(differences.length).toBeGreaterThan(0)

            const artifact = await loadFixtureJson<NaiWebPayloadGapArtifact>(artifactPath)
            expect(artifact.schemaVersion).toBe(1)
            expect(artifact.fixture).toBe(fixturePath)
            expect(artifact.classification).toBe('web-session-vs-bearer-transport')
            assertDeepEqual(artifact.expected, adapted.expected, `${artifactPath} expected payload is stale`)
            assertDeepEqual(artifact.actual, actual, `${artifactPath} actual payload is stale`)
            assertDeepEqual(artifact.differences, differences, `${artifactPath} deep diff is stale`)
        },
    )
})
