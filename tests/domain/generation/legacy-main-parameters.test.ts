import { describe, expect, it } from 'vitest'

import { buildLegacyMainGenerationParameters } from '@/domain/generation/legacy-main-parameters'

const baseInput = {
    prompt: 'resolved prompt',
    negativePrompt: 'resolved negative',
    originalPrompts: {
        base: 'base',
        additional: 'additional',
        detail: 'detail',
        negative: 'negative',
        inpainting: 'inpainting',
    },
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfgScale: 5,
    cfgRescale: 0,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    smea: true,
    smeaDyn: false,
    variety: false,
    seed: 42,
    sourceImage: null,
    strength: 0.7,
    noise: 0,
    mask: null,
    characterImages: [],
    vibeImages: [],
    characterPrompts: [],
    characterPositionEnabled: false,
    modulePromptsActive: false,
    moduleCharacterPromptsPresent: false,
    imageFormat: 'png' as const,
    metadataMode: 'both' as const,
    assetModulePlan: null,
    qualityToggle: true,
    ucPreset: 0,
}

describe('legacy Main parameter planner', () => {
    it('projects direct prompts and resource defaults without mutating input', () => {
        const characterImage = {
            base64: 'character-bytes',
            strength: 0.8,
        }
        const vibeImage = {
            base64: 'vibe-bytes',
            informationExtracted: 1,
            strength: 0.6,
        }

        const result = buildLegacyMainGenerationParameters({
            ...baseInput,
            sourceImage: 'source-bytes',
            mask: 'mask-bytes',
            characterImages: [characterImage],
            vibeImages: [vibeImage],
        })

        expect(result).toMatchObject({
            prompt: 'resolved prompt',
            negative_prompt: 'resolved negative',
            sourceImage: 'source-bytes',
            mask: 'mask-bytes',
            charImages: ['character-bytes'],
            charFidelity: [0.6],
            charReferenceType: ['character&style'],
            charCacheKeys: [null],
            vibeImages: ['vibe-bytes'],
            preEncodedVibes: [null],
            characterPositionEnabled: false,
            promptParts: baseInput.originalPrompts,
        })
        expect(result).not.toHaveProperty('assetModulePlan')
        expect(characterImage).toEqual({ base64: 'character-bytes', strength: 0.8 })
    })

    it('retains module policy and collapses prompt parts for module-owned prompts', () => {
        const modulePlan = { id: 'module-plan' }
        const result = buildLegacyMainGenerationParameters({
            ...baseInput,
            modulePromptsActive: true,
            moduleCharacterPromptsPresent: true,
            characterPositionEnabled: false,
            assetModulePlan: modulePlan,
            characterPrompts: [{
                stableId: 'character-1',
                name: 'Hero',
                prompt: 'character prompt',
                negative: '',
                enabled: true,
                position: { x: 0.25, y: 0.75 },
            }],
        })

        expect(result.assetModulePlan).toBe(modulePlan)
        expect(result.characterPositionEnabled).toBe(true)
        expect(result.promptParts).toEqual({
            base: 'resolved prompt',
            additional: '',
            detail: '',
            negative: 'resolved negative',
            inpainting: '',
        })
        expect(result.characterPrompts).toEqual([{
            stableId: 'character-1',
            name: 'Hero',
            prompt: 'character prompt',
            negative: '',
            enabled: true,
            position: { x: 0.25, y: 0.75 },
        }])
    })
})
