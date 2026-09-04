import type { CompositionEnginePlan } from '@/domain/composition/engine'
import {
    composePromptContributions,
    type CanonicalMainPromptSlot,
    type PromptCompositionDraft,
} from '@/domain/composition/prompt-normalizer'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type { ParamsOverride, ProvenanceRef, PromptContribution } from '@/domain/composition/types'
import type {
    SceneAuthoringRecord,
    SceneV1CharacterCaption,
    SceneV1GenerationConfig,
    SceneV1PromptConfig,
} from './scene-repository'

export type SceneEffectiveSource =
    | { readonly kind: 'default' }
    | { readonly kind: 'legacy-scalar'; readonly field: 'scenePrompt' }
    | { readonly kind: 'scene-field'; readonly field: string }
    | { readonly kind: 'scene-contribution'; readonly contributionIds: readonly string[] }
    | { readonly kind: 'composed'; readonly sources: readonly SceneEffectiveSource[] }
    | { readonly kind: 'composition-plan'; readonly provenance: readonly DeepReadonly<ProvenanceRef>[] }

export interface EffectiveSceneValue<T> {
    readonly value: T
    readonly source: SceneEffectiveSource
}

export interface ResolvedSceneAuthoring {
    readonly raw: SceneAuthoringRecord
    readonly effective: {
        readonly prompts: {
            readonly base: EffectiveSceneValue<string>
            readonly inpainting: EffectiveSceneValue<string>
            readonly additional: EffectiveSceneValue<string>
            readonly workflow: EffectiveSceneValue<string>
            readonly detail: EffectiveSceneValue<string>
            readonly positive: EffectiveSceneValue<string>
            readonly negative: EffectiveSceneValue<string>
            readonly character: EffectiveSceneValue<string>
            readonly characterNegative: EffectiveSceneValue<string>
        }
        readonly generation: { readonly [Key in keyof Required<SceneV1GenerationConfig>]: EffectiveSceneValue<Required<SceneV1GenerationConfig>[Key]> }
        readonly width: EffectiveSceneValue<number | undefined>
        readonly height: EffectiveSceneValue<number | undefined>
        readonly characterCaptions: readonly {
            readonly value: SceneV1CharacterCaption
            readonly source: SceneEffectiveSource
        }[]
        readonly recipe: EffectiveSceneValue<{
            readonly recipeId: string
            readonly recipeRevision?: number
            readonly selectionKind: 'asset' | 'direct'
        } | null>
    }
}

const DEFAULT_PROMPTS: Required<SceneV1PromptConfig> = {
    base: '',
    additional: '',
    character: '',
    negative: '',
    characterNegative: '',
}

const DEFAULT_GENERATION: Required<SceneV1GenerationConfig> = {
    model: 'nai-diffusion-4-5-full',
    steps: 28,
    cfgScale: 5,
    cfgRescale: 0,
    sampler: 'k_euler_ancestral',
    scheduler: 'karras',
    smea: false,
    smeaDyn: false,
    variety: false,
    qualityToggle: true,
    ucPreset: 0,
    seed: 0,
    seedLocked: false,
}

function canonicalSlot(contribution: PromptContribution): CanonicalMainPromptSlot | null {
    if (contribution.target.kind !== 'positive') return null
    switch (contribution.target.slot) {
        case 'base':
        case 'inpainting':
        case 'additional':
        case 'workflow':
        case 'detail':
            return contribution.target.slot
        case 'scene':
        case 'style':
        case 'quality':
            return 'workflow'
    }
}

function activeContributions(
    scene: SceneAuthoringRecord,
    predicate: (contribution: PromptContribution) => boolean,
): PromptContribution[] {
    return (scene.compositionRef?.sceneContributions ?? [])
        .filter(item => item.enabled && item.deletedAt === undefined && predicate(item))
        .sort((left, right) => left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id))
}

function composedSource(
    fallback: SceneEffectiveSource,
    contributions: readonly PromptContribution[],
): SceneEffectiveSource {
    if (contributions.length === 0) return fallback
    let lastReplace = -1
    contributions.forEach((item, index) => {
        if (item.merge === 'replace') lastReplace = index
    })
    const retained = contributions.slice(Math.max(0, lastReplace))
    const contributionSource: SceneEffectiveSource = {
        kind: 'scene-contribution',
        contributionIds: retained.map(item => item.id),
    }
    return lastReplace >= 0 || fallback.kind === 'default'
        ? contributionSource
        : { kind: 'composed', sources: [fallback, contributionSource] }
}

function legacyPromptSource(
    scene: SceneAuthoringRecord,
    field: keyof Required<SceneV1PromptConfig>,
): SceneEffectiveSource {
    if (scene.prompts?.[field] !== undefined) return { kind: 'scene-field', field: `prompts.${field}` }
    if (field === 'additional' && scene.scenePrompt.length > 0) return { kind: 'legacy-scalar', field: 'scenePrompt' }
    return { kind: 'default' }
}

function legacyPrompts(scene: SceneAuthoringRecord): Required<SceneV1PromptConfig> {
    return {
        ...DEFAULT_PROMPTS,
        additional: scene.scenePrompt || '',
        ...scene.prompts,
    }
}

function composeScenePrompts(scene: SceneAuthoringRecord): PromptCompositionDraft {
    const legacy = legacyPrompts(scene)
    return composePromptContributions(scene.compositionRef?.sceneContributions ?? [], {
        main: { base: legacy.base, additional: legacy.additional },
        negative: legacy.negative,
    })
}

/** Pure compatibility adapter equivalent to the legacy Zustand prompt resolver. */
export function resolveScenePrompts(scene: SceneAuthoringRecord): Required<SceneV1PromptConfig> {
    const legacy = legacyPrompts(scene)
    const composed = composeScenePrompts(scene)
    return {
        ...legacy,
        base: composed.main.base,
        additional: composed.main.additional,
        negative: composed.negative,
    }
}

/** Pure compatibility adapter equivalent to the legacy Zustand generation resolver. */
export function resolveSceneGeneration(scene: SceneAuthoringRecord): Required<SceneV1GenerationConfig> {
    const override = scene.compositionRef?.paramsOverride ?? {}
    return {
        ...DEFAULT_GENERATION,
        ...scene.generation,
        ...pickGenerationParams(override),
        smea: false,
        smeaDyn: false,
    }
}

function pickGenerationParams(params: Readonly<ParamsOverride>): SceneV1GenerationConfig {
    const result: SceneV1GenerationConfig = {}
    for (const key of [
        'model', 'steps', 'cfgScale', 'cfgRescale', 'sampler', 'scheduler',
        'smea', 'smeaDyn', 'variety', 'qualityToggle', 'ucPreset', 'seed', 'seedLocked',
    ] as const) {
        const value = params[key]
        if (value !== undefined) Object.assign(result, { [key]: value })
    }
    return result
}

/** Resolves legacy captions first, then applies Scene-owned CharacterSlotPatch values by ID. */
export function resolveSceneCharacterCaptions(scene: SceneAuthoringRecord): SceneV1CharacterCaption[] {
    const prompts = resolveScenePrompts(scene)
    const base = scene.characterCaptions !== undefined
        ? scene.characterCaptions.map(caption => ({ ...caption, position: { ...caption.position } }))
        : (!prompts.character.trim() && !prompts.characterNegative.trim())
            ? []
            : [{
                id: `scene:${scene.id}:character`,
                name: scene.name,
                prompt: prompts.character,
                negative: prompts.characterNegative,
                enabled: true,
                position: { x: 0.5, y: 0.5 },
            }]
    const byId = new Map(base.map(caption => [caption.id, caption]))
    for (const patch of scene.compositionRef?.characterOverrides ?? []) {
        const current = byId.get(patch.characterId)
        const position = patch.position?.mode === 'manual'
            ? { x: patch.position.x, y: patch.position.y }
            : current?.position ?? { x: 0.5, y: 0.5 }
        byId.set(patch.characterId, {
            id: patch.characterId,
            ...(current?.name === undefined ? {} : { name: current.name }),
            prompt: patch.positivePrompt ?? current?.prompt ?? '',
            negative: patch.negativePrompt ?? current?.negative ?? '',
            enabled: patch.enabled ?? current?.enabled ?? true,
            position,
        })
    }
    return [...byId.values()]
}

function planSource(plan: DeepReadonly<CompositionEnginePlan>): SceneEffectiveSource {
    return { kind: 'composition-plan', provenance: plan.provenance }
}

/** Returns raw authoring data beside resolved values and their winning sources. */
export function resolveScene(
    scene: SceneAuthoringRecord,
    plan?: DeepReadonly<CompositionEnginePlan>,
): ResolvedSceneAuthoring {
    const prompts = resolveScenePrompts(scene)
    const composed = composeScenePrompts(scene)
    const generation = resolveSceneGeneration(scene)
    const planValueSource = plan === undefined ? undefined : planSource(plan)
    const sourceForSlot = (slot: CanonicalMainPromptSlot): SceneEffectiveSource => composedSource(
        slot === 'base' || slot === 'additional'
            ? legacyPromptSource(scene, slot)
            : { kind: 'default' },
        activeContributions(scene, item => canonicalSlot(item) === slot),
    )
    const negativeSource = composedSource(
        legacyPromptSource(scene, 'negative'),
        activeContributions(scene, item => item.target.kind === 'negative'),
    )
    const promptParts = plan?.promptParts ?? { ...composed.main, negative: composed.negative }
    const positive = plan?.positivePrompt ?? [
        promptParts.base,
        promptParts.inpainting,
        promptParts.additional,
        promptParts.workflow,
        promptParts.detail,
    ].filter(Boolean).join(', ')
    const positiveSources = (['base', 'inpainting', 'additional', 'workflow', 'detail'] as const)
        .filter(slot => promptParts[slot].length > 0)
        .map(sourceForSlot)
    const generationKeys = Object.keys(DEFAULT_GENERATION) as Array<keyof typeof DEFAULT_GENERATION>
    const effectiveGeneration = Object.fromEntries(generationKeys.map(key => {
        const overridden = scene.compositionRef?.paramsOverride?.[key] !== undefined
        const authored = scene.generation?.[key] !== undefined
        return [key, {
            value: plan?.params[key as keyof typeof plan.params] ?? generation[key],
            source: planValueSource
                ?? (overridden
                    ? { kind: 'scene-field' as const, field: `compositionRef.paramsOverride.${key}` }
                    : authored
                        ? { kind: 'scene-field' as const, field: `generation.${key}` }
                        : { kind: 'default' as const }),
        }]
    })) as ResolvedSceneAuthoring['effective']['generation']
    const overrides = new Set((scene.compositionRef?.characterOverrides ?? []).map(patch => patch.characterId))

    return {
        raw: scene,
        effective: {
            prompts: {
                base: { value: promptParts.base, source: planValueSource ?? sourceForSlot('base') },
                inpainting: { value: promptParts.inpainting, source: planValueSource ?? sourceForSlot('inpainting') },
                additional: { value: promptParts.additional, source: planValueSource ?? sourceForSlot('additional') },
                workflow: { value: promptParts.workflow, source: planValueSource ?? sourceForSlot('workflow') },
                detail: { value: promptParts.detail, source: planValueSource ?? sourceForSlot('detail') },
                positive: {
                    value: positive,
                    source: planValueSource ?? (positiveSources.length === 0
                        ? { kind: 'default' }
                        : positiveSources.length === 1
                            ? positiveSources[0]
                            : { kind: 'composed', sources: positiveSources }),
                },
                negative: { value: promptParts.negative, source: planValueSource ?? negativeSource },
                character: { value: prompts.character, source: legacyPromptSource(scene, 'character') },
                characterNegative: {
                    value: prompts.characterNegative,
                    source: legacyPromptSource(scene, 'characterNegative'),
                },
            },
            generation: effectiveGeneration,
            width: {
                value: plan?.params.width ?? scene.compositionRef?.paramsOverride?.width ?? scene.width,
                source: planValueSource
                    ?? (scene.compositionRef?.paramsOverride?.width !== undefined
                        ? { kind: 'scene-field', field: 'compositionRef.paramsOverride.width' }
                        : scene.width !== undefined
                            ? { kind: 'scene-field', field: 'width' }
                            : { kind: 'default' }),
            },
            height: {
                value: plan?.params.height ?? scene.compositionRef?.paramsOverride?.height ?? scene.height,
                source: planValueSource
                    ?? (scene.compositionRef?.paramsOverride?.height !== undefined
                        ? { kind: 'scene-field', field: 'compositionRef.paramsOverride.height' }
                        : scene.height !== undefined
                            ? { kind: 'scene-field', field: 'height' }
                            : { kind: 'default' }),
            },
            characterCaptions: resolveSceneCharacterCaptions(scene).map(caption => ({
                value: caption,
                source: overrides.has(caption.id)
                    ? { kind: 'scene-field', field: `compositionRef.characterOverrides.${caption.id}` }
                    : { kind: 'scene-field', field: `characterCaptions.${caption.id}` },
            })),
            recipe: {
                value: scene.compositionRef === undefined ? null : {
                    recipeId: scene.compositionRef.recipeId,
                    ...(scene.compositionRef.recipeRevision === undefined
                        ? {}
                        : { recipeRevision: scene.compositionRef.recipeRevision }),
                    selectionKind: scene.compositionRef.selectionKind ?? 'asset',
                },
                source: scene.compositionRef === undefined
                    ? { kind: 'default' }
                    : { kind: 'scene-field', field: 'compositionRef.recipeId' },
            },
        },
    }
}

export function resolveScenes(
    scenes: readonly SceneAuthoringRecord[],
): readonly ResolvedSceneAuthoring[] {
    return scenes.map(scene => resolveScene(scene))
}
