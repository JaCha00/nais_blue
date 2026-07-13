import { describe, expect, it } from 'vitest'

import {
    buildGenerateImagePayload,
    type BuildOptions,
    type GenerationRequest,
    type NaiImagePayload,
} from '@/services/nai/payload'
import {
    assertDeepEqual,
    deepDiff,
    type DeepDifference,
    loadFixtureJson,
} from '../helpers'

interface BuilderBehaviorGapFixture {
    schemaVersion: 1
    case: string
    classification: 'target-bug-possibility'
    request: GenerationRequest
    options: BuildOptions
    expected: NaiImagePayload
    actual: NaiImagePayload
    differences: DeepDifference[]
    provenance: {
        repository: string
        pinnedCommit: string
        sourcePath: string
        sourceBlob: string
        license: string
        reconstructedAt: string
        webCapture: false
        transformation: string
    }
}

describe('documented target builder behavior gaps', () => {
    it('keeps the comment-only character gap artifact current', async () => {
        const fixture = await loadFixtureJson<BuilderBehaviorGapFixture>(
            'payload/gaps/comment-only-character.gap.json',
        )

        const actual = buildGenerateImagePayload(fixture.request, fixture.options)
        const differences = deepDiff(actual, fixture.expected)
        const recomputed: BuilderBehaviorGapFixture = {
            ...fixture,
            actual,
            differences,
        }

        expect(fixture.schemaVersion).toBe(1)
        expect(fixture.classification).toBe('target-bug-possibility')
        expect(fixture.provenance.webCapture).toBe(false)
        expect(differences).not.toHaveLength(0)
        assertDeepEqual(
            recomputed,
            fixture,
            `${fixture.case} no longer matches its committed expected/actual gap artifact`,
        )
    })
})
