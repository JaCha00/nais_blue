import type { CompositionPlanHash } from '@/domain/composition/canonical-serialize'
import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type {
    CompositionEngineIssue,
    CompositionEnginePlan,
} from '@/domain/composition/engine'
import type { FragmentSequenceCommitProposal } from '@/domain/composition/fragment-resolver'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type { GenerationParams } from '@/services/novelai-api'
import { useAssetModuleStore } from '@/stores/asset-module-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import {
    createCharacterStoreResourceRepository,
    useCharacterStore,
} from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import {
    createRuntimeCharacterOverrides,
    getRuntimeSelection,
    useRotationStore,
} from '@/stores/character-rotation-store'
import {
    useSceneStore,
    type SceneCard,
    type SceneCompositionMode,
} from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import type { AssetModulePlan } from '@/lib/asset-modules/resolver'
import { cloneCompositionRandomTrace } from '@/lib/generation-metadata'
import {
    diagnosticsFromSceneResolution,
    resolveSceneComposition,
    type SceneCompositionResolution,
    type SceneCompositionSnapshot,
    type SceneRuntimeCharacterOverride,
} from '@/lib/composition/scene-adapter'
import {
    type MainReferenceSnapshot,
} from '@/lib/composition/main-adapter'
import { materializeCharacterResourcesForNai } from '@/lib/composition/character-resource-adapter'
import { effectiveSceneCompositionMode } from '@/lib/composition-authority'
import { runtimeCapabilities } from '@/platform/capabilities'
import { assessPortableCompositionPlan } from '@/platform/portable-resources'
import {
    buildLegacySceneGenerationParams,
    resolveLegacySceneAssetModulePlan,
    selectSceneGenerationSeed,
} from './legacy-build-scene-params'
import {
    buildSceneFragmentInput,
    collectSceneFragmentSourceTexts,
} from './fragment-runtime'

type ReadonlyScenePlan = DeepReadonly<CompositionEnginePlan>
type ReadonlySceneIssue = DeepReadonly<CompositionEngineIssue>

export interface SceneCompositionBuildDiagnostics {
    mode: SceneCompositionMode
    planHash: CompositionPlanHash | null
    warnings: readonly ReadonlySceneIssue[]
    errors: readonly ReadonlySceneIssue[]
}

interface SceneGenerationBuildBase extends SceneCompositionBuildDiagnostics {
    sequenceCommitProposal: DeepReadonly<FragmentSequenceCommitProposal> | null
}

export interface SceneGenerationBuildSuccess extends SceneGenerationBuildBase {
    success: true
    params: GenerationParams
    finalPrompt: string
    mimeType: string
}

export interface SceneGenerationBuildFailure extends SceneGenerationBuildBase {
    success: false
}

export type SceneGenerationBuildResult = SceneGenerationBuildSuccess | SceneGenerationBuildFailure

interface SceneMaterializedReference {
    id: string
    base64?: string
    enabled: boolean
    encodedVibe?: string
    thumbnail?: string
    informationExtracted: number
    strength: number
    fidelity: number
    referenceType: 'character' | 'style' | 'character&style'
    cacheKey?: string
}

interface ResolveSceneRuntimeOptions {
    mode: 'preview' | 'generate'
    seed: number
    now: Date
    requestId: string
    scenePrompt?: string
}

interface SceneRuntimeCompositionCapture {
    resolution: SceneCompositionResolution
    snapshot: SceneCompositionSnapshot
    sourceImage: string | null
    mask: string | null
    runtimeCharacterOverride?: SceneRuntimeCharacterOverride
}

const roundTo64 = (value: number): number => Math.round(value / 64) * 64

function runtimeDigest(value: string | null | undefined): string | undefined {
    return value ? `sha256:${sha256Utf8(value)}` : undefined
}

function referenceSnapshots(
    characterImages: readonly SceneMaterializedReference[],
    vibeImages: readonly SceneMaterializedReference[],
): MainReferenceSnapshot[] {
    return [
        ...characterImages.map(image => ({
            id: image.id,
            enabled: image.enabled !== false,
            kind: 'character' as const,
            referenceType: image.referenceType,
            strength: image.strength,
            fidelity: image.fidelity,
            informationExtracted: image.informationExtracted,
            digest: runtimeDigest(image.thumbnail),
        })),
        ...vibeImages.map(image => ({
            id: image.id,
            enabled: image.enabled !== false,
            kind: 'vibe' as const,
            referenceType: image.referenceType,
            strength: image.strength,
            fidelity: image.fidelity,
            informationExtracted: image.informationExtracted,
            digest: runtimeDigest(image.thumbnail),
        })),
    ]
}

async function resolveSourceDimensions(
    sourceImage: string | null,
    fallback: { width: number; height: number },
): Promise<{ width: number; height: number }> {
    if (!sourceImage) return fallback
    try {
        const image = new Image()
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve()
            image.onerror = () => reject(new Error('Failed to load source image'))
            image.src = sourceImage
        })
        const result = { width: roundTo64(image.width), height: roundTo64(image.height) }
        image.src = ''
        return result
    } catch {
        console.warn('[SceneGeneration] Failed to get source image dimensions, using scene/global resolution')
        return fallback
    }
}

function effectiveRecipeSources(snapshot: SceneCompositionSnapshot): string[] {
    const requestedId = snapshot.scene.compositionRef?.recipeId
    const recipe = snapshot.scene.compositionRef?.selectionKind === 'direct'
        ? undefined
        : requestedId === undefined
            ? snapshot.profile.recipes.find(candidate => candidate.enabled)
            : snapshot.profile.recipes.find(candidate => candidate.id === requestedId)
    if (recipe === undefined) return []
    return collectSceneFragmentSourceTexts({
        steps: recipe.steps,
        modules: recipe.steps.map(step => snapshot.profile.modules[step.moduleId]),
    })
}

async function createSceneCompositionSnapshot(
    scene: SceneCard,
    seed: number,
    scenePrompt = scene.scenePrompt,
): Promise<{
    snapshot: SceneCompositionSnapshot
    sourceImage: string | null
    mask: string | null
    runtimeCharacterOverride?: SceneRuntimeCharacterOverride
}> {
    const generation = useGenerationStore.getState()
    const settings = useSettingsStore.getState()
    const characterPrompts = useCharacterPromptStore.getState()
    const referenceState = useCharacterStore.getState()
    const rotation = useRotationStore.getState()
    const { usePresetStore } = await import('@/stores/preset-store')
    const paramsPresetState = usePresetStore.getState()
    const excludedPinnedIds = rotation.active && scene.excludePinned
        ? new Set(rotation.pinnedCharacterIds)
        : null
    const activePreset = useSceneStore.getState().presets.find(preset => (
        preset.id === useSceneStore.getState().activePresetId
    ))
    const sceneNumber = activePreset?.scenes.findIndex(candidate => candidate.id === scene.id)
    const fallbackDimensions = {
        width: roundTo64(scene.width ?? generation.selectedResolution.width),
        height: roundTo64(scene.height ?? generation.selectedResolution.height),
    }
    const sourceDimensions = await resolveSourceDimensions(generation.sourceImage, fallbackDimensions)

    const characters = characterPrompts.characters.filter(character => !excludedPinnedIds?.has(character.id))
    const rotationSelection = getRuntimeSelection(rotation, seed)
    const rotationPatches = createRuntimeCharacterOverrides(
        rotationSelection,
        characters.map(character => character.id),
        { excludePinned: scene.excludePinned },
    )
    const runtimeCharacterOverride = rotationSelection === null
        ? undefined
        : {
            characterPatches: rotationPatches,
            randomTrace: rotationSelection.trace,
        }
    const snapshot: SceneCompositionSnapshot = {
        profile: useAssetModuleStore.getState().profile,
        scene: {
            id: scene.id,
            name: scene.name,
            scenePrompt,
            ...(scene.width === undefined ? {} : { width: roundTo64(scene.width) }),
            ...(scene.height === undefined ? {} : { height: roundTo64(scene.height) }),
            createdAt: scene.createdAt,
            ...(scene.compositionRef === undefined ? {} : { compositionRef: scene.compositionRef }),
        },
        ...(activePreset === undefined
            ? {}
            : {
                preset: {
                    id: activePreset.id,
                    name: activePreset.name,
                    ...(sceneNumber === undefined || sceneNumber < 0 ? {} : { sceneNumber: sceneNumber + 1 }),
                },
            }),
        prompt: {
            base: generation.basePrompt,
            inpainting: generation.i2iMode === 'inpaint' ? generation.inpaintingPrompt : '',
            additional: generation.additionalPrompt,
            detail: generation.detailPrompt,
            negative: generation.negativePrompt,
        },
        characters,
        characterPresets: characterPrompts.presets,
        characterGroups: characterPrompts.groups,
        positionEnabled: characterPrompts.positionEnabled,
        references: referenceSnapshots(referenceState.characterImages, referenceState.vibeImages),
        paramsPresets: paramsPresetState.presets,
        activeParamsPresetId: paramsPresetState.activePresetId,
        params: {
            model: generation.model,
            width: roundTo64(generation.selectedResolution.width),
            height: roundTo64(generation.selectedResolution.height),
            steps: generation.steps,
            cfgScale: generation.cfgScale,
            cfgRescale: generation.cfgRescale,
            sampler: generation.sampler,
            scheduler: generation.scheduler,
            smea: generation.smea,
            smeaDyn: generation.smeaDyn,
            variety: generation.variety ?? false,
            seed,
            qualityToggle: generation.qualityToggle,
            ucPreset: generation.ucPreset,
            sourceMode: 'text-to-image',
            strength: generation.strength,
            noise: generation.noise,
            characterPositionEnabled: characterPrompts.positionEnabled,
        },
        output: {
            autoSave: true,
            savePath: settings.sceneSavePath,
            useAbsolutePath: settings.useAbsoluteScenePath,
            imageFormat: settings.imageFormat,
            metadataMode: settings.metadataMode,
            portableRoot: runtimeCapabilities.absoluteOutputPath.supported
                ? 'pictures'
                : 'app-data',
        },
        source: {
            hasSourceImage: Boolean(generation.sourceImage),
            hasMask: Boolean(generation.mask),
            sourceImageDigest: runtimeDigest(generation.sourceImage),
            maskDigest: runtimeDigest(generation.mask),
            width: sourceDimensions.width,
            height: sourceDimensions.height,
            strength: generation.strength,
            noise: generation.noise,
        },
    }
    return {
        snapshot,
        sourceImage: generation.sourceImage,
        mask: generation.mask,
        ...(runtimeCharacterOverride === undefined ? {} : { runtimeCharacterOverride }),
    }
}

async function resolveSceneRuntimeComposition(
    scene: SceneCard,
    options: ResolveSceneRuntimeOptions,
): Promise<SceneRuntimeCompositionCapture> {
    const captured = await createSceneCompositionSnapshot(
        scene,
        options.seed,
        options.scenePrompt ?? scene.scenePrompt,
    )
    const { snapshot } = captured
    const fragment = await buildSceneFragmentInput(options.mode, [
        snapshot.prompt.base,
        snapshot.prompt.inpainting,
        snapshot.prompt.additional,
        snapshot.scene.scenePrompt,
        snapshot.prompt.detail,
        snapshot.prompt.negative,
        ...snapshot.characters.flatMap(character => [character.prompt, character.negative]),
        ...collectSceneFragmentSourceTexts(snapshot.scene.compositionRef?.sceneContributions ?? []),
        ...effectiveRecipeSources(snapshot),
    ])
    return {
        ...captured,
        resolution: resolveSceneComposition({
            snapshot,
            requestId: options.requestId,
            now: options.now.toISOString(),
        seed: options.seed,
        fragment,
        fragmentMode: options.mode,
        runtimeCharacterOverride: captured.runtimeCharacterOverride,
    }),
    }
}

function clonePlanHash(plan: ReadonlyScenePlan): CompositionPlanHash {
    return {
        version: plan.planHash.version,
        algorithm: plan.planHash.algorithm,
        canonicalization: plan.planHash.canonicalization,
        digest: plan.planHash.digest,
    }
}

function promptGroupsFromPlan(plan: ReadonlyScenePlan): Record<string, string> {
    const groups: Record<string, string> = {
        'main.base': plan.promptParts.base,
        'main.inpainting': plan.promptParts.inpainting,
        'main.additional': plan.promptParts.additional,
        'main.workflow': plan.promptParts.workflow,
        'main.detail': plan.promptParts.detail,
        'main.negative': plan.promptParts.negative,
    }
    plan.characters.forEach((character, index) => {
        groups[`v4.char.${index}.positive`] = character.positive
        groups[`v4.char.${index}.negative`] = character.negative
    })
    return Object.fromEntries(Object.entries(groups).filter(([, value]) => value.length > 0))
}

function reconcileSceneAssetModulePlan(
    modulePlan: AssetModulePlan | null,
    plan: ReadonlyScenePlan,
): AssetModulePlan | null {
    if (modulePlan === null) return null
    const promptGroups = promptGroupsFromPlan(plan)
    return {
        ...modulePlan,
        promptGroups,
        contributions: modulePlan.contributions.map(contribution => ({
            ...contribution,
            prompt: promptGroups[contribution.target] ?? '',
        })),
        generationParams: {
            ...modulePlan.generationParams,
            prompt: plan.positivePrompt,
            negative_prompt: plan.negativePrompt,
            seed: plan.params.seed,
            promptGroups,
            characterPrompts: plan.characters.filter(character => character.enabled).map(character => ({
                prompt: character.positive,
                negative: character.negative,
                enabled: true,
                position: character.position.mode === 'manual'
                    ? { x: character.position.x, y: character.position.y }
                    : { x: 0.5, y: 0.5 },
            })),
        },
    }
}

async function materializeV2GenerationParams(
    scene: SceneCard,
    plan: ReadonlyScenePlan,
    mode: 'shadow' | 'v2',
    now: Date,
    selectedRecipeId: string,
    directRecipeId: string,
    sourceImage: string | null,
    mask: string | null,
    output: SceneCompositionSnapshot['output'],
): Promise<GenerationParams> {
    if (mode === 'v2') {
        const portability = assessPortableCompositionPlan(plan, runtimeCapabilities)
        if (!portability.readyForGeneration) {
            throw new Error(portability.issues
                .map(issue => `${issue.code}:${issue.resourceId ?? 'output'}:${issue.repairAction.label}`)
                .join(', '))
        }
    }
    const enabledBindings = [
        ...plan.resourceBindings,
        ...plan.characters
            .filter(character => character.enabled)
            .flatMap(character => character.resourceBindings),
    ].filter((binding, index, bindings) => binding.enabled && bindings.findIndex(candidate => (
        candidate.resourceId === binding.resourceId
        && candidate.referenceType === binding.referenceType
        && candidate.strength === binding.strength
        && candidate.fidelity === binding.fidelity
        && candidate.informationExtracted === binding.informationExtracted
    )) === index)
    const materialized = await materializeCharacterResourcesForNai({
        resources: plan.resources,
        bindings: enabledBindings,
        repository: createCharacterStoreResourceRepository(),
    })
    if (!materialized.success) {
        throw new Error(materialized.errors.map(error => `${error.code}:${error.resourceId}`).join(', '))
    }
    const references = materialized.value
    const requestedRecipeId = selectedRecipeId === directRecipeId ? undefined : selectedRecipeId
    const legacyModulePlan = requestedRecipeId === undefined
        ? null
        : await resolveLegacySceneAssetModulePlan(scene, plan.params.seed, {
            recipeId: requestedRecipeId,
            now,
            wildcardProcessor: prompt => prompt,
        })
    const modulePlan = reconcileSceneAssetModulePlan(legacyModulePlan, plan)

    return {
        prompt: plan.positivePrompt,
        negative_prompt: plan.negativePrompt,
        model: plan.params.model,
        width: plan.params.width,
        height: plan.params.height,
        steps: plan.params.steps,
        cfg_scale: plan.params.cfgScale,
        cfg_rescale: plan.params.cfgRescale,
        sampler: plan.params.sampler,
        scheduler: plan.params.scheduler,
        smea: plan.params.smea,
        smea_dyn: plan.params.smeaDyn,
        variety: plan.params.variety,
        seed: plan.params.seed,
        ...(sourceImage ? { sourceImage } : {}),
        strength: plan.params.strength,
        noise: plan.params.noise,
        ...(mask ? { mask } : {}),
        charImages: references.charImages,
        charStrength: references.charStrength,
        charFidelity: references.charFidelity,
        charReferenceType: references.charReferenceType,
        charCacheKeys: references.charCacheKeys,
        charInfo: references.charInfo,
        vibeImages: references.vibeImages,
        vibeInfo: references.vibeInfo,
        vibeStrength: references.vibeStrength,
        preEncodedVibes: references.preEncodedVibes,
        characterPrompts: plan.characters.filter(character => character.enabled).map(character => ({
            stableId: character.characterId,
            prompt: character.positive,
            negative: character.negative,
            enabled: true,
            position: character.position.mode === 'manual'
                ? { x: character.position.x, y: character.position.y }
                : { x: 0.5, y: 0.5 },
        })),
        characterPositionEnabled: plan.params.characterPositionEnabled,
        // Scene output ownership remains in saveSceneResult during this phase.
        imageFormat: output.imageFormat,
        metadataMode: modulePlan?.output.metadataMode ?? output.metadataMode,
        ...(modulePlan === null ? {} : { assetModulePlan: modulePlan }),
        qualityToggle: plan.params.qualityToggle,
        ucPreset: plan.params.ucPreset,
        promptParts: {
            base: plan.promptParts.base,
            inpainting: plan.promptParts.inpainting,
            additional: plan.promptParts.additional,
            workflow: plan.promptParts.workflow,
            detail: plan.promptParts.detail,
            negative: plan.promptParts.negative,
        },
        compositionMode: mode,
        engineVersion: plan.engineVersion,
        sourceRevision: plan.documentRevision,
        compositionPlanHash: clonePlanHash(plan),
        compositionPlanId: plan.planId,
        compositionRecipeId: plan.recipeId,
        compositionProvenanceSummary: {
            sourceCount: plan.provenance.length,
            promptContributionCount: plan.provenanceDetails.prompts.length,
            randomSelectionCount: plan.provenanceDetails.randomSelections.length,
        },
        compositionRandomTrace: cloneCompositionRandomTrace(plan.randomTrace),
        outputPolicySummary: {
            imageFormat: output.imageFormat,
            metadataMode: modulePlan?.output.metadataMode ?? output.metadataMode,
            destinationKind: output.useAbsolutePath ? 'custom' : 'default',
            writesSidecar: (modulePlan?.output.metadataMode ?? output.metadataMode) !== 'embedded'
                || output.imageFormat === 'webp',
            writesThumbnail: true,
            filenameTemplateId: plan.outputPolicy.filenameTemplate,
            collisionPolicy: plan.outputPolicy.collisionPolicy,
        },
        ...(plan.outputPolicy.destination.kind === 'filesystem'
            ? {
                portableOutputDirectory: plan.outputPolicy.destination.directory.kind === 'standard'
                    ? {
                        kind: 'standard' as const,
                        root: plan.outputPolicy.destination.directory.root,
                        segments: [...plan.outputPolicy.destination.directory.segments],
                    }
                    : {
                        kind: 'bookmark' as const,
                        bookmarkId: plan.outputPolicy.destination.directory.bookmarkId,
                        segments: [...plan.outputPolicy.destination.directory.segments],
                    },
            }
            : {}),
    }
}

function diagnosticsFor(
    mode: SceneCompositionMode,
    resolution: SceneCompositionResolution,
): SceneCompositionBuildDiagnostics {
    const diagnostics = diagnosticsFromSceneResolution(resolution)
    return {
        mode,
        planHash: diagnostics.plan === null ? null : clonePlanHash(diagnostics.plan),
        warnings: diagnostics.warnings,
        errors: diagnostics.errors,
    }
}

export async function previewSceneComposition(
    scene: SceneCard,
    options: { scenePrompt?: string; seed?: number; now?: Date } = {},
): Promise<SceneCompositionResolution> {
    const authorityMode = effectiveSceneCompositionMode(useSceneStore.getState().sceneCompositionMode)
    if (authorityMode === 'legacy') {
        throw new Error('Composition preview is unavailable while legacy authority is active')
    }
    const generation = useGenerationStore.getState()
    const seed = options.seed ?? generation.previewSeed ?? (generation.seed || 1)
    const now = options.now ?? new Date()
    const captured = await resolveSceneRuntimeComposition(scene, {
        mode: 'preview',
        seed,
        now,
        requestId: `scene-preview:${scene.id}:${seed}`,
        scenePrompt: options.scenePrompt,
    })
    return captured.resolution
}

// Facade only: store snapshot -> engine (v2/shadow) -> existing GenerationParams.
// Legacy prompt assembly is isolated in legacy-build-scene-params.ts for rollback.
export async function buildSceneGenerationParams(
    scene: SceneCard,
    options: { sessionId?: number; requestId?: string; now?: Date } = {},
): Promise<SceneGenerationBuildResult> {
    const mode = effectiveSceneCompositionMode(useSceneStore.getState().sceneCompositionMode)
    if (mode === 'legacy') {
        const legacy = await buildLegacySceneGenerationParams(scene)
        return {
            success: true,
            ...legacy,
            mode,
            planHash: null,
            warnings: [],
            errors: [],
            sequenceCommitProposal: legacy.sequenceCommitProposal,
        }
    }

    if (mode === 'shadow') {
        const legacy = await buildLegacySceneGenerationParams(scene)
        const now = options.now ?? new Date()
        const captured = await resolveSceneRuntimeComposition(scene, {
            mode: 'preview',
            seed: legacy.params.seed,
            now,
            requestId: options.requestId ?? `scene-shadow:${options.sessionId ?? 0}:${scene.id}`,
        })
        const { resolution } = captured
        const diagnostics = diagnosticsFor(mode, resolution)
        const params = resolution.result.success
            ? {
                ...legacy.params,
                compositionMode: 'shadow' as const,
                compositionPlanHash: clonePlanHash(resolution.result.plan),
                compositionPlanId: resolution.result.plan.planId,
                compositionRecipeId: resolution.result.plan.recipeId,
                compositionProvenanceSummary: {
                    sourceCount: resolution.result.plan.provenance.length,
                    promptContributionCount: resolution.result.plan.provenanceDetails.prompts.length,
                    randomSelectionCount: resolution.result.plan.provenanceDetails.randomSelections.length,
                },
            }
            : legacy.params
        return {
            success: true,
            ...legacy,
            params,
            ...diagnostics,
            sequenceCommitProposal: legacy.sequenceCommitProposal,
        }
    }

    const generation = useGenerationStore.getState()
    const seed = selectSceneGenerationSeed(generation.seedLocked, generation.seed)
    const now = options.now ?? new Date()
    const captured = await resolveSceneRuntimeComposition(scene, {
        mode: 'generate',
        seed,
        now,
        requestId: options.requestId ?? `scene-request:${options.sessionId ?? 0}:${scene.id}:${seed}`,
    })
    const { resolution } = captured
    const diagnostics = diagnosticsFor(mode, resolution)
    if (!resolution.result.success) {
        return {
            success: false,
            ...diagnostics,
            sequenceCommitProposal: null,
        }
    }
    const params = await materializeV2GenerationParams(
        scene,
        resolution.result.plan,
        'v2',
        now,
        resolution.selectedRecipeId,
        resolution.directRecipeId,
        captured.sourceImage,
        captured.mask,
        captured.snapshot.output,
    )
    return {
        success: true,
        params,
        finalPrompt: params.prompt,
        mimeType: params.imageFormat === 'webp' ? 'image/webp' : 'image/png',
        ...diagnostics,
        sequenceCommitProposal: resolution.result.sequenceCommitProposal,
    }
}
