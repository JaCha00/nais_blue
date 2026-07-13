import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/generation-store', () => ({ useGenerationStore: { getState: vi.fn() } }))
vi.mock('@/stores/preset-store', () => ({ usePresetStore: { getState: vi.fn() } }))
vi.mock('@/stores/character-prompt-store', () => ({ useCharacterPromptStore: { getState: vi.fn() } }))
vi.mock('@/stores/character-store', () => ({ useCharacterStore: { getState: vi.fn() } }))

import { buildNais2Params } from '@/lib/generation-metadata'
import type { NAIMetadata } from '@/lib/metadata-parser'
import {
    createMetadataApplyPreview,
    type MetadataApplyCurrentState,
    type MetadataApplyOptions,
} from '@/services/output/metadata-apply'

const options: MetadataApplyOptions = {
    targetPresetId: 'preset:target',
    prompts: true,
    parameters: true,
    resolution: true,
    seed: true,
    characterPrompts: true,
    vibeTransfer: true,
}

const current: MetadataApplyCurrentState = {
    activePresetId: 'preset:target',
    targetPresetExists: true,
    generation: {
        basePrompt: '',
        additionalPrompt: '',
        detailPrompt: '',
        inpaintingPrompt: '',
        negativePrompt: '',
        model: 'old-model',
        steps: 20,
        cfgScale: 4,
        cfgRescale: 0,
        sampler: 'old-sampler',
        scheduler: 'old-scheduler',
        smea: false,
        smeaDyn: false,
        variety: false,
        qualityToggle: false,
        ucPreset: 0,
        width: 512,
        height: 512,
        seed: 1,
    },
    characterIds: [],
    vibeCount: 0,
}

function v2Metadata(): NAIMetadata {
    const nais2 = buildNais2Params({
        prompt: 'portrait',
        negative_prompt: 'bad anatomy',
        model: 'nai-diffusion-4-5-full',
        width: 832,
        height: 1216,
        steps: 28,
        cfg_scale: 5,
        cfg_rescale: 0,
        sampler: 'k_euler_ancestral',
        scheduler: 'karras',
        smea: true,
        smea_dyn: false,
        variety: false,
        seed: 77,
        characterPrompts: [{
            stableId: 'character:alice',
            prompt: 'alice',
            negative: '',
            enabled: true,
            position: { x: 0.25, y: 0.75 },
        }],
    })
    if (nais2.version !== 2) throw new Error('expected v2')
    return {
        nais2,
        metadataVersion: 2,
        promptParts: nais2.promptParts,
    }
}

describe('metadata repository apply preview', () => {
    it('builds a validated v2 change-set and diff without mutating stores', () => {
        const preview = createMetadataApplyPreview(v2Metadata(), options, current)
        expect(preview.sourceVersion).toBe('v2')
        expect(preview.validation.valid).toBe(true)
        expect(preview.changeSet.characters[0].stableId).toBe('character:alice')
        expect(preview.diff.some(change => change.path === 'steps' && change.after === 28)).toBe(true)
        expect(preview.diff.some(change => change.repository === 'character-prompts')).toBe(true)
    })

    it('validates positions before apply', () => {
        const metadata = v2Metadata()
        if (metadata.nais2?.version !== 2) throw new Error('expected v2')
        metadata.nais2.characters[0].positions[0].x = 1.5
        const preview = createMetadataApplyPreview(metadata, options, current)
        expect(preview.validation.valid).toBe(false)
        expect(preview.validation.errors).toContainEqual(expect.objectContaining({
            code: 'character-position-invalid',
        }))
    })

    it('routes legacy metadata through the compatibility importer', () => {
        const preview = createMetadataApplyPreview({ prompt: 'legacy prompt', steps: 30 }, options, current)
        expect(preview.sourceVersion).toBe('legacy')
        expect(preview.changeSet.generation).toMatchObject({ basePrompt: 'legacy prompt', steps: 30 })
        expect(preview.validation.warnings).toContainEqual(expect.objectContaining({
            code: 'legacy-compatibility-import',
        }))
    })
})
