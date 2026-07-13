import { describe, expect, it } from 'vitest'

import { migrateLegacyStoresToV2 } from '@/domain/composition/migrations/legacy-stores-to-v2'
import type { CompositionMigrationSourceSnapshot } from '@/lib/composition-migration-runtime'
import { compareLegacyAuthorityToMigratedDocument } from '@/lib/composition-migration-shadow'

function fixture(basePrompt: string) {
    const indexedDbSnapshots = {
        'nais2-generation': {
            state: {
                basePrompt,
                inpaintingPrompt: '',
                additionalPrompt: '',
                detailPrompt: '',
                negativePrompt: 'blurry',
                model: 'nai-diffusion-4-5-full',
                selectedResolution: { width: 832, height: 1216 },
                steps: 28,
                cfgScale: 5,
                cfgRescale: 0,
                sampler: 'k_euler_ancestral',
                scheduler: 'karras',
                smea: true,
                smeaDyn: true,
                variety: false,
                qualityToggle: true,
                ucPreset: 0,
                strength: 0.7,
                noise: 0,
            },
            version: 8,
        },
        'nais2-scenes': {
            state: {
                activePresetId: 'old-scenes',
                presets: [{
                    id: 'old-scenes',
                    name: 'Old scenes',
                    createdAt: 1,
                    scenes: [{ id: 'scene:one', name: 'Scene', scenePrompt: 'not a Main recipe' }],
                }],
            },
            version: 1,
        },
    }
    const legacyInput = { indexedDbSnapshots }
    const migrated = migrateLegacyStoresToV2(legacyInput)
    const source: CompositionMigrationSourceSnapshot = {
        serializedStores: Object.fromEntries(
            Object.entries(indexedDbSnapshots).map(([key, value]) => [key, JSON.stringify(value)]),
        ),
        wildcardContent: {},
    }
    return { source, legacyInput, migrated, document: migrated.document }
}

describe('production migration shadow characterization', () => {
    it('compares the Main direct path when an unrelated old-scene recipe exists', async () => {
        const comparison = await compareLegacyAuthorityToMigratedDocument(fixture('portrait'))

        expect(comparison.status).toBe('match')
        expect(comparison.matches).toBe(true)
    })

    it('detects a real legacy/v2 semantic difference instead of sharing the v2 oracle', async () => {
        const comparison = await compareLegacyAuthorityToMigratedDocument(fixture('portrait, portrait'))

        expect(comparison.status).toBe('different')
        expect(comparison.matches).toBe(false)
        expect(comparison.differences).toContain('semantic-plan')
    })
})
