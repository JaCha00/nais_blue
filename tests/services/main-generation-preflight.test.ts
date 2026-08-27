import { describe, expect, it } from 'vitest'

import { createFragmentLookup } from '@/domain/composition/fragment-resolver'
import { calculateAnlasCost } from '@/lib/anlas-calculator'
import type { MainCompositionSnapshot } from '@/lib/composition/main-adapter'
import {
    buildMainCompositionProjection,
    mainPreflightBlocksGeneration,
    preflightMainGeneration,
} from '@/services/generation/main-generation-preflight'
import type { AssetProfile } from '@/types/asset-profile'

const NOW = '2026-08-27T00:00:00.000Z' as const

function profile(): AssetProfile {
    return {
        revision: 1,
        updatedBy: 'agent',
        updatedAt: NOW,
        settings: {},
        output: {},
        r2: { enabled: false },
        modules: {
            params: {
                id: 'params',
                enabled: true,
                kind: 'params',
                settings: {
                    model: 'nai-diffusion-5-full',
                    width: 1024,
                    height: 1024,
                    steps: 40,
                },
            },
        },
        recipes: [{ id: 'advanced', enabled: true, steps: [{ moduleId: 'params' }] }],
    }
}

function snapshot(): MainCompositionSnapshot {
    return {
        profile: profile(),
        selectedRecipeId: 'advanced',
        prompt: { base: 'subject', inpainting: '', additional: '', detail: '', negative: '' },
        characters: [],
        positionEnabled: false,
        references: [],
        params: {
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
            qualityToggle: true,
            ucPreset: 0,
            sourceMode: 'text-to-image',
            strength: 0.7,
            noise: 0,
            characterPositionEnabled: false,
        },
        output: {
            autoSave: true,
            savePath: 'Advanced',
            useAbsolutePath: false,
            imageFormat: 'webp',
            metadataMode: 'embedded',
        },
        source: {
            hasSourceImage: false,
            hasMask: false,
            width: 832,
            height: 1216,
            strength: 0.7,
            noise: 0,
        },
    }
}

describe('Main generation preflight', () => {
    it('blocks invalid preflight only when v2 is execution authority', () => {
        const invalid = {
            profileConflict: true,
            profileLoading: false,
            preflightReady: false,
            resolutionError: true,
        }
        expect(mainPreflightBlocksGeneration('v2', invalid)).toBe(true)
        expect(mainPreflightBlocksGeneration('shadow', invalid)).toBe(false)
        expect(mainPreflightBlocksGeneration('legacy', invalid)).toBe(false)
    })

    it('uses recipe-resolved params for the passive plan and batch cost', () => {
        const draft = snapshot()
        const projection = buildMainCompositionProjection({
            generation: {
                basePrompt: draft.prompt.base,
                additionalPrompt: draft.prompt.additional,
                detailPrompt: draft.prompt.detail,
                negativePrompt: draft.prompt.negative,
                inpaintingPrompt: draft.prompt.inpainting,
                model: draft.params.model,
                steps: draft.params.steps,
                cfgScale: draft.params.cfgScale,
                cfgRescale: draft.params.cfgRescale,
                sampler: draft.params.sampler,
                scheduler: draft.params.scheduler,
                smea: draft.params.smea,
                smeaDyn: draft.params.smeaDyn,
                variety: draft.params.variety,
                qualityToggle: draft.params.qualityToggle,
                ucPreset: draft.params.ucPreset,
                transparentBackground: false,
                sourceImage: null,
                mask: null,
                strength: draft.params.strength,
                noise: draft.params.noise,
                selectedRecipeId: draft.selectedRecipeId,
            },
            effectiveBasePrompt: draft.prompt.base,
            profile: draft.profile,
            characters: [],
            characterPresets: [],
            characterGroups: [],
            positionEnabled: false,
            characterImages: [],
            vibeImages: [],
            paramsPresets: [],
            output: draft.output,
            portableRoot: 'pictures',
            paramsWidth: 832,
            paramsHeight: 1216,
            sourceWidth: 832,
            sourceHeight: 1216,
            seed: 42,
        })
        const result = preflightMainGeneration({
            snapshot: projection.snapshot,
            requestId: 'main-preflight:test',
            now: NOW,
            seed: 42,
            fragment: {
                lookup: createFragmentLookup([]),
                sequenceSnapshot: { revision: 0, counters: {} },
                mode: 'generate',
                strictness: 'compatible',
                maxRecursion: 10,
            },
        }, { batchCount: 3, pricingBasis: 'paid' })

        expect(result.diagnostics.errors).toEqual([])
        expect(projection.fragmentSourceTexts).toContain('nai-diffusion-5-full')
        expect(result.diagnostics.plan?.params).toMatchObject({
            model: 'nai-diffusion-5-full',
            width: 832,
            height: 1216,
            steps: 40,
        })
        expect(result.estimatedCost).toBe(calculateAnlasCost({
            model: 'nai-diffusion-5-full',
            width: 832,
            height: 1216,
            steps: 40,
            imageCount: 1,
            pricingBasis: 'paid',
        }) * 3)
        expect(result.resolution.output).toMatchObject({
            directory: 'Advanced',
            format: 'webp',
            autoSave: true,
        })
    })
})
