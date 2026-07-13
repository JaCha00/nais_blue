import {
    resolveComposition,
    type CompositionEngineResolveResult,
} from '@/domain/composition/engine'
import type {
    CompositionDocument,
    EntityId,
    ResolvedGenerationParams,
} from '@/domain/composition/types'

const STUDIO_ENGINE_DEFAULTS: ResolvedGenerationParams = {
    model: 'nai-diffusion-4-5-full',
    width: 1024,
    height: 1024,
    steps: 28,
    cfgScale: 5,
    cfgRescale: 0,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    smea: false,
    smeaDyn: false,
    variety: false,
    seed: 0,
    qualityToggle: false,
    ucPreset: 0,
    sourceMode: 'text-to-image',
    strength: 0,
    noise: 0,
    characterPositionEnabled: false,
}

/**
 * Resolves the current authoring draft through the real Composition engine.
 * It is preview-only: fragment counters never commit and the fixed seed keeps
 * the result stable while fields are edited.
 */
export function resolveCompositionStudioPreview(
    document: CompositionDocument,
    recipeId?: EntityId,
    now = new Date().toISOString(),
): CompositionEngineResolveResult | null {
    const profile = document.profiles.find(item => (
        item.id === document.activeProfileId && item.enabled && item.deletedAt === undefined
    )) ?? document.profiles.find(item => item.enabled && item.deletedAt === undefined)
    if (profile === undefined) return null

    const selectedRecipeId = recipeId
        ?? profile.defaultRecipeId
        ?? profile.recipeIds.find(id => document.recipes.some(recipe => recipe.id === id && recipe.enabled))
    if (selectedRecipeId === undefined) return null

    return resolveComposition({
        request: {
            schemaVersion: 2,
            requestId: `studio-preview:${document.id}:${document.revision}`,
            requestedAt: now,
            requestedBy: { kind: 'user', id: 'asset-module-studio' },
            document,
            profileId: profile.id,
            recipeId: selectedRecipeId,
            contributions: [],
            characterPatches: [],
            resourceBindings: [],
            randomSeed: 0,
        },
        now,
        engineDefaults: STUDIO_ENGINE_DEFAULTS,
        fragment: {
            lookup: { getFragment: () => null },
            sequenceSnapshot: { revision: 0, counters: {} },
            mode: 'preview',
            strictness: 'compatible',
        },
        referencePolicy: 'strict',
        randomScope: 'asset-module-studio-preview',
    })
}
