import { describe, expect, it } from 'vitest'

import type { CompositionDocument } from '@/domain/composition/types'
import { typeFixtureDocument } from '@/domain/composition/types.typecheck'
import { resolveCompositionStudioPreview } from '@/services/composition-studio-preview'

describe('Composition Studio resolved preview', () => {
    it('uses the canonical engine and exposes every provenance-rich preview section', () => {
        const document = JSON.parse(JSON.stringify(typeFixtureDocument)) as CompositionDocument
        const result = resolveCompositionStudioPreview(
            document,
            document.recipes[0].id,
            '2026-07-13T00:00:00.000Z',
        )

        expect(result?.success).toBe(true)
        if (result?.success !== true) return
        expect(result.plan.positivePrompt).toBeTypeOf('string')
        expect(result.plan.negativePrompt).toBeTypeOf('string')
        expect(result.plan.promptParts).toHaveProperty('base')
        expect(result.plan.characters).toHaveLength(1)
        expect(result.plan.params).toHaveProperty('model')
        expect(result.plan.outputPolicy).toHaveProperty('filenameTemplate')
        expect(result.plan.randomTrace).toBeInstanceOf(Array)
        expect(result.plan.provenance).toBeInstanceOf(Array)
        expect(result.plan.provenanceDetails.params.length).toBeGreaterThan(0)
    })

    it('returns null when no active profile can be resolved', () => {
        const document = JSON.parse(JSON.stringify(typeFixtureDocument)) as CompositionDocument
        document.profiles = document.profiles.map(profile => ({ ...profile, enabled: false }))

        expect(resolveCompositionStudioPreview(document)).toBeNull()
    })
})
