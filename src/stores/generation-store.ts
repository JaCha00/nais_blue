import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { useAuthStore } from './auth-store'
import { useSettingsStore } from './settings-store'
import { generateImage, generateImageStream, type GenerationParams } from '@/services/novelai-api'
import {
    createCharacterStoreResourceRepository,
    useCharacterStore,
} from './character-store'
import { useCharacterPromptStore } from './character-prompt-store'
import {
    commitWildcardSequenceProposal,
    createWildcardResolutionSession,
    createStoreFragmentResolverInput,
} from '@/lib/fragment-processor'
import { createThumbnail } from '@/lib/image-utils'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'
import { useAssetModuleStore } from './asset-module-store'
import { resolveAssetModulePlan, type AssetModulePlan } from '@/lib/asset-modules/resolver'
import {
    cloneCompositionRandomTrace,
    ensureImageFileExtension,
} from '@/lib/generation-metadata'
import { shouldUseAbsoluteMediaPath } from '@/platform/storage'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'
import {
    diagnosticsFromMainResolution,
    MAIN_DIRECT_RECIPE_ID,
    resolveMainComposition,
    resolveMainRecipeSelection,
    type MainCompositionMode,
    type MainCompositionSnapshot,
    type MainOutputMaterialization,
    type MainReferenceSnapshot,
} from '@/lib/composition/main-adapter'
import type { FragmentSequenceCommitProposal } from '@/domain/composition/fragment-resolver'
import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { CompositionEngineIssue, CompositionEnginePlan } from '@/domain/composition/engine'
import type { DeepReadonly } from '@/domain/composition/provenance'
import { materializeCharacterResourcesForNai } from '@/lib/composition/character-resource-adapter'
import type { StyleLabCompositionMode } from '@/lib/style-lab/composition-mode'
import { effectiveMainCompositionMode } from '@/lib/composition-authority'
import { runtimeCapabilities } from '@/platform/capabilities'
import {
    assessPortableCompositionPlan,
    runtimePortablePathTokenRegistry,
} from '@/platform/portable-resources'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { publishGeneratedArtifact } from './artifact-lifecycle-store'

interface Resolution {
    label: string
    width: number
    height: number
}

interface HistoryItem {
    id: string
    url: string // Base64 or Blob URL
    thumbnail?: string
    prompt: string
    seed: number
    timestamp: Date
    sentPayloadSummary?: string
}

type CharacterPromptParams = NonNullable<GenerationParams['characterPrompts']>
type ReadonlyCompositionPlan = DeepReadonly<CompositionEnginePlan>
type ReadonlyCompositionIssue = DeepReadonly<CompositionEngineIssue>

export interface MainCompositionShadowDifference {
    path: string
    legacy: unknown
    v2: unknown
    approvedRule?:
        | 'seeded-wildcard-selection'
        | 'uniform-comment-removal'
        | 'exact-token-dedupe'
        | 'strict-broken-reference'
}

export interface CapturedMainGeneration {
    params: GenerationParams
    finalPrompt: string
    imageFormat: 'png' | 'webp'
    metadataMode: GenerationParams['metadataMode']
    streaming: boolean
    sequenceCommitProposal: DeepReadonly<FragmentSequenceCommitProposal> | null
    output: {
        autoSave: boolean
        directory: string
        useAbsolutePath: boolean
        capabilityFallbackDirectory: string
        portableDirectory?: GenerationParams['portableOutputDirectory']
        fileName?: string
        collisionPolicy: 'unique' | 'overwrite' | 'error'
    }
}

interface GenerateOptions {
    /** Internal enqueue planner seam. No transport or output is performed. */
    capturePrepared?: (capture: CapturedMainGeneration) => void | Promise<void>
}

export interface MainCompositionShadowDiff {
    matches: boolean
    v2Valid: boolean
    differences: MainCompositionShadowDifference[]
}

const removeComments = (text: string) => text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n')

function hasAssetModulePrompts(plan: AssetModulePlan | null): plan is AssetModulePlan {
    return Boolean(plan && Object.values(plan.promptGroups).some(prompt => prompt.trim().length > 0))
}

function readStringParam(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function readModuleCharacterPrompts(plan: AssetModulePlan | null): CharacterPromptParams | null {
    const value = plan?.generationParams.characterPrompts
    return Array.isArray(value) ? value as CharacterPromptParams : null
}

async function resolveMainAssetModulePlan(
    seed: number,
    options: {
        recipeId?: string
        now?: Date
        wildcardProcessor?: (prompt: string) => string | Promise<string>
    } = {},
): Promise<AssetModulePlan | null> {
    const profile = useAssetModuleStore.getState().profile
    if (!profile.recipes.some(recipe => recipe.enabled)) return null

    try {
        const plan = await resolveAssetModulePlan({
            profile,
            recipeId: options.recipeId,
            seed,
            now: options.now,
            baseParams: {
                prompt: '',
                negative_prompt: '',
            },
            filenameContext: {
                seed,
            },
            wildcardProcessor: options.wildcardProcessor,
        })

        return plan.recipe && plan.modules.length > 0 ? plan : null
    } catch (error) {
        console.warn('[AssetModules] Failed to resolve main generation plan; falling back to direct prompts.', error)
        return null
    }
}

function collectStringValues(value: unknown, seen = new Set<object>()): string[] {
    if (typeof value === 'string') return [value]
    if (value === null || typeof value !== 'object' || seen.has(value)) return []
    seen.add(value)
    if (Array.isArray(value)) return value.flatMap(item => collectStringValues(item, seen))
    return Object.values(value).flatMap(item => collectStringValues(item, seen))
}

async function buildMainFragmentInput(
    mode: 'preview' | 'generate',
    sourceTexts: readonly string[],
) {
    return createStoreFragmentResolverInput(sourceTexts, {
        mode,
        strictness: 'compatible',
        maxRecursion: 10,
    })
}

export function commitMainFragmentSequenceProposal(
    proposal: DeepReadonly<FragmentSequenceCommitProposal> | null,
): boolean {
    return commitWildcardSequenceProposal(proposal)
}

function roundTo64(value: number): number {
    return Math.round(value / 64) * 64
}

async function resolveMainSourceDimensions(
    sourceImage: string | null,
    selectedResolution: Resolution,
): Promise<{ width: number; height: number }> {
    let width = roundTo64(selectedResolution.width)
    let height = roundTo64(selectedResolution.height)
    if (!sourceImage) return { width, height }

    try {
        const image = new Image()
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve()
            image.onerror = () => reject(new Error('Failed to load source image'))
            image.src = sourceImage
        })
        width = roundTo64(image.width)
        height = roundTo64(image.height)
        console.log(`[Generate] Using source image dimensions: ${image.width}x${image.height} → ${width}x${height}`)
        image.src = ''
    } catch (error) {
        console.warn('[Generate] Failed to get source image dimensions, using global resolution', error)
    }
    return { width, height }
}

function normalizedPromptParts(params: GenerationParams): Record<string, string> {
    return {
        base: params.promptParts?.base ?? '',
        inpainting: params.promptParts?.inpainting ?? '',
        additional: params.promptParts?.additional ?? '',
        workflow: params.promptParts?.workflow ?? '',
        detail: params.promptParts?.detail ?? '',
        negative: params.promptParts?.negative ?? '',
    }
}

function redactedMainGenerationSemantics(params: GenerationParams): Record<string, unknown> {
    return {
        prompt: params.prompt,
        negative_prompt: params.negative_prompt,
        model: params.model,
        width: params.width,
        height: params.height,
        steps: params.steps,
        cfg_scale: params.cfg_scale,
        cfg_rescale: params.cfg_rescale,
        sampler: params.sampler,
        scheduler: params.scheduler,
        smea: params.smea,
        smea_dyn: params.smea_dyn,
        variety: params.variety,
        seed: params.seed,
        sourceImagePresent: Boolean(params.sourceImage),
        maskPresent: Boolean(params.mask),
        strength: params.strength,
        noise: params.noise,
        characterReferenceCount: params.charImages?.length ?? 0,
        charStrength: params.charStrength ?? [],
        charFidelity: params.charFidelity ?? [],
        charReferenceType: params.charReferenceType ?? [],
        charCacheKeyPresent: params.charCacheKeys?.map(Boolean) ?? [],
        vibeReferenceCount: params.vibeImages?.length ?? 0,
        vibeInfo: params.vibeInfo ?? [],
        vibeStrength: params.vibeStrength ?? [],
        preEncodedVibePresent: params.preEncodedVibes?.map(Boolean) ?? [],
        characterPrompts: params.characterPrompts ?? [],
        characterPositionEnabled: params.characterPositionEnabled,
        qualityToggle: params.qualityToggle,
        ucPreset: params.ucPreset,
        imageFormat: params.imageFormat,
        metadataMode: params.metadataMode,
        promptParts: normalizedPromptParts(params),
        assetModuleRecipeId: params.assetModulePlan?.recipe?.id,
        assetModuleIds: params.assetModulePlan?.modules.map(item => item.module.id) ?? [],
    }
}

interface MainShadowOutputSemantics {
    recipeId: string | null
    directory: string
    filenameTemplate: string
    renderedFileName?: string
    format: 'png' | 'webp'
    metadataMode: GenerationParams['metadataMode']
    useAbsolutePath: boolean
    capabilityFallbackDirectory: string
}

function hasVolatileFilenameTime(template: string): boolean {
    return /\{(?:now|date|time|datetime|timestamp)(?::[^{}]+)?\}/i.test(template)
}

function directMainFilenameTemplate(sourceImage: string | null, mask: string | null): string {
    return mask
        ? 'NAIS_INPAINT_{timestamp}'
        : sourceImage
            ? 'NAIS_I2I_{timestamp}'
            : 'NAIS_{timestamp}'
}

function legacyShadowOutputSemantics(params: {
    modulePlan: AssetModulePlan | null
    settings: ReturnType<typeof useSettingsStore.getState>
    sourceImage: string | null
    mask: string | null
    directRecipeId: string
}): MainShadowOutputSemantics {
    const template = params.modulePlan?.output.filenameTemplate
        ?? (params.modulePlan === null
            ? directMainFilenameTemplate(params.sourceImage, params.mask)
            : '{profile}_{seed}_{datetime:YYYYMMDD-HHmmss}')
    const format = params.settings.imageFormat
    return {
        recipeId: params.modulePlan?.recipeId ?? params.directRecipeId,
        directory: params.modulePlan?.output.directory
            || params.settings.savePath
            || 'NAIS_Output',
        filenameTemplate: template,
        ...(!hasVolatileFilenameTime(template) && params.modulePlan?.output.fileName
            ? { renderedFileName: ensureImageFileExtension(params.modulePlan.output.fileName, format) ?? undefined }
            : {}),
        format,
        metadataMode: params.modulePlan?.output.metadataMode ?? params.settings.metadataMode,
        useAbsolutePath: shouldUseAbsoluteMediaPath(params.settings.useAbsolutePath),
        capabilityFallbackDirectory: params.settings.savePath || 'NAIS_Output',
    }
}

function v2ShadowOutputSemantics(
    plan: ReadonlyCompositionPlan,
    output: MainOutputMaterialization,
): MainShadowOutputSemantics {
    const template = plan.outputPolicy.filenameTemplate
    return {
        recipeId: plan.recipeId ?? null,
        directory: output.directory,
        filenameTemplate: template,
        ...(!hasVolatileFilenameTime(template)
            ? { renderedFileName: ensureImageFileExtension(output.fileName, output.format) ?? undefined }
            : {}),
        format: output.format,
        metadataMode: output.metadataMode,
        useAbsolutePath: shouldUseAbsoluteMediaPath(output.useAbsolutePath),
        capabilityFallbackDirectory: output.capabilityFallbackDirectory,
    }
}

function compareMainGenerationParams(
    legacy: GenerationParams,
    v2: GenerationParams,
    output: {
        legacy: MainShadowOutputSemantics
        v2: MainShadowOutputSemantics
    },
): MainCompositionShadowDiff {
    const legacySemantics = {
        ...redactedMainGenerationSemantics(legacy),
        ...Object.fromEntries(Object.entries(output.legacy).map(([key, value]) => [`output.${key}`, value])),
    }
    const v2Semantics = {
        ...redactedMainGenerationSemantics(v2),
        ...Object.fromEntries(Object.entries(output.v2).map(([key, value]) => [`output.${key}`, value])),
    }
    const fields = [...new Set([
        ...Object.keys(legacySemantics),
        ...Object.keys(v2Semantics),
    ])].sort()
    const differences = fields.flatMap<MainCompositionShadowDifference>(field => {
        const left = legacySemantics[field]
        const right = v2Semantics[field]
        if (JSON.stringify(left) === JSON.stringify(right)) return []
        return [{ path: field, legacy: left, v2: right }]
    })
    return {
        matches: differences.length === 0,
        v2Valid: true,
        differences,
    }
}

interface MainMaterializedReference {
    id: string
    base64: string
    enabled: boolean
    encodedVibe?: string
    thumbnail?: string
    informationExtracted: number
    strength: number
    fidelity: number
    referenceType: 'character' | 'style' | 'character&style'
    cacheKey?: string
}

function mainRuntimeDigest(value: string | null | undefined): string | undefined {
    return value ? `sha256:${sha256Utf8(value)}` : undefined
}

function referenceSnapshots(
    characterImages: readonly MainMaterializedReference[],
    vibeImages: readonly MainMaterializedReference[],
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
            // Persisted thumbnails are non-secret and survive byte hydration/release.
            digest: mainRuntimeDigest(image.thumbnail),
        })),
        ...vibeImages.map(image => ({
            id: image.id,
            enabled: image.enabled !== false,
            kind: 'vibe' as const,
            referenceType: image.referenceType,
            strength: image.strength,
            fidelity: image.fidelity,
            informationExtracted: image.informationExtracted,
            digest: mainRuntimeDigest(image.thumbnail),
        })),
    ]
}

function clonePlanHash(plan: ReadonlyCompositionPlan): GenerationParams['compositionPlanHash'] {
    return {
        version: plan.planHash.version,
        algorithm: plan.planHash.algorithm,
        canonicalization: plan.planHash.canonicalization,
        digest: plan.planHash.digest,
    }
}

function promptGroupsFromResolvedPlan(plan: ReadonlyCompositionPlan): Record<string, string> {
    const groups: Record<string, string> = {
        'main.base': plan.promptParts.base,
        'main.inpainting': plan.promptParts.inpainting,
        'main.additional': plan.promptParts.additional,
        'main.workflow': plan.promptParts.workflow,
        'main.detail': plan.promptParts.detail,
        'main.negative': plan.promptParts.negative,
    }
    for (const [fallbackIndex, character] of plan.characters.entries()) {
        const index = /:(\d+)$/.exec(character.characterId)?.[1] ?? String(fallbackIndex)
        groups[`v4.char.${index}.positive`] = character.positive
        groups[`v4.char.${index}.negative`] = character.negative
    }
    return Object.fromEntries(Object.entries(groups).filter(([, value]) => value.length > 0))
}

function reconcileAssetModulePlan(
    modulePlan: AssetModulePlan | null,
    plan: ReadonlyCompositionPlan,
): AssetModulePlan | null {
    if (modulePlan === null) return null
    const promptGroups = promptGroupsFromResolvedPlan(plan)
    return {
        ...modulePlan,
        promptGroups,
        contributions: modulePlan.contributions.map(contribution => ({
            ...contribution,
            prompt: promptGroups[contribution.target] ?? '',
        })),
        generationParams: {
            ...modulePlan.generationParams,
            seed: plan.params.seed,
            prompt: plan.positivePrompt,
            negative_prompt: plan.negativePrompt,
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

async function buildV2GenerationParams(params: {
    plan: ReadonlyCompositionPlan
    compositionMode: 'shadow' | 'v2'
    modulePlan: AssetModulePlan | null
    sourceImage: string | null
    mask: string | null
    characterImages: readonly MainMaterializedReference[]
    vibeImages: readonly MainMaterializedReference[]
}): Promise<GenerationParams> {
    const materialized = await materializeCharacterResourcesForNai({
        resources: params.plan.resources,
        bindings: [
            ...params.plan.resourceBindings,
            ...params.plan.characters
                .filter(character => character.enabled)
                .flatMap(character => character.resourceBindings),
        ],
        repository: createCharacterStoreResourceRepository(),
    })
    if (!materialized.success && params.compositionMode === 'v2') {
        throw new Error(materialized.errors.map(error => `${error.code}:${error.resourceId}`).join(', '))
    }
    const references = materialized.success
        ? materialized.value
        : {
            charImages: params.characterImages.map(image => image.base64),
            charStrength: params.characterImages.map(image => image.strength),
            charFidelity: params.characterImages.map(image => image.fidelity),
            charReferenceType: params.characterImages.map(image => image.referenceType),
            charCacheKeys: params.characterImages.map(image => image.cacheKey ?? null),
            charInfo: params.characterImages.map(image => image.informationExtracted),
            vibeImages: params.vibeImages.map(image => image.base64),
            vibeInfo: params.vibeImages.map(image => image.informationExtracted),
            vibeStrength: params.vibeImages.map(image => image.strength),
            preEncodedVibes: params.vibeImages.map(image => image.encodedVibe ?? null),
        }

    return {
        prompt: params.plan.positivePrompt,
        negative_prompt: params.plan.negativePrompt,
        model: params.plan.params.model,
        width: params.plan.params.width,
        height: params.plan.params.height,
        steps: params.plan.params.steps,
        cfg_scale: params.plan.params.cfgScale,
        cfg_rescale: params.plan.params.cfgRescale,
        sampler: params.plan.params.sampler,
        scheduler: params.plan.params.scheduler,
        smea: params.plan.params.smea,
        smea_dyn: params.plan.params.smeaDyn,
        variety: params.plan.params.variety,
        seed: params.plan.params.seed,
        ...(params.sourceImage === null ? {} : { sourceImage: params.sourceImage }),
        strength: params.plan.params.strength,
        noise: params.plan.params.noise,
        ...(params.mask === null ? {} : { mask: params.mask }),
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
        characterPrompts: params.plan.characters.filter(character => character.enabled).map(character => ({
            stableId: character.characterId,
            prompt: character.positive,
            negative: character.negative,
            enabled: true,
            position: character.position.mode === 'manual'
                ? { x: character.position.x, y: character.position.y }
                : { x: 0.5, y: 0.5 },
        })),
        characterPositionEnabled: params.plan.params.characterPositionEnabled,
        imageFormat: params.plan.outputPolicy.format,
        metadataMode: params.plan.outputPolicy.metadataMode,
        ...(params.modulePlan === null
            ? {}
            : { assetModulePlan: reconcileAssetModulePlan(params.modulePlan, params.plan) ?? undefined }),
        qualityToggle: params.plan.params.qualityToggle,
        ucPreset: params.plan.params.ucPreset,
        promptParts: {
            base: params.plan.promptParts.base,
            inpainting: params.plan.promptParts.inpainting,
            additional: params.plan.promptParts.additional,
            workflow: params.plan.promptParts.workflow,
            detail: params.plan.promptParts.detail,
            negative: params.plan.promptParts.negative,
        },
        engineVersion: params.plan.engineVersion,
        sourceRevision: params.plan.documentRevision,
        outputPolicySummary: {
            imageFormat: params.plan.outputPolicy.format,
            metadataMode: params.plan.outputPolicy.metadataMode,
            destinationKind: params.plan.outputPolicy.destination.kind === 'filesystem' ? 'custom' : 'default',
            writesSidecar: params.plan.outputPolicy.metadataMode !== 'embedded'
                || params.plan.outputPolicy.format === 'webp',
            writesThumbnail: true,
            filenameTemplateId: params.plan.outputPolicy.filenameTemplate,
            collisionPolicy: params.plan.outputPolicy.collisionPolicy,
        },
        ...(params.plan.outputPolicy.destination.kind === 'filesystem'
            ? {
                portableOutputDirectory: params.plan.outputPolicy.destination.directory.kind === 'standard'
                    ? {
                        kind: 'standard' as const,
                        root: params.plan.outputPolicy.destination.directory.root,
                        segments: [...params.plan.outputPolicy.destination.directory.segments],
                    }
                    : {
                        kind: 'bookmark' as const,
                        bookmarkId: params.plan.outputPolicy.destination.directory.bookmarkId,
                        segments: [...params.plan.outputPolicy.destination.directory.segments],
                    },
            }
            : {}),
        compositionMode: params.compositionMode,
        compositionPlanHash: clonePlanHash(params.plan),
        compositionPlanId: params.plan.planId,
        compositionRecipeId: params.plan.recipeId,
        compositionProvenanceSummary: {
            sourceCount: params.plan.provenance.length,
            promptContributionCount: params.plan.provenanceDetails.prompts.length,
            randomSelectionCount: params.plan.provenanceDetails.randomSelections.length,
        },
        compositionRandomTrace: cloneCompositionRandomTrace(params.plan.randomTrace),
    }
}

export const AVAILABLE_MODELS = [
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated' },
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full' },
    { id: 'nai-diffusion-4-curated-preview', name: 'NAI Diffusion V4 Curated' },
    { id: 'nai-diffusion-4-full', name: 'NAI Diffusion V4 Full' },
] as const

export const DEFAULT_GENERATION_MODEL = 'nai-diffusion-4-5-full'

/**
 * The selectable registry is release authority; preset/history/hydration
 * callers use this boundary so retired model IDs remain readable but cannot
 * silently reactivate an unsupported provider request.
 */
export function normalizeSelectableGenerationModel(model: string): string {
    return AVAILABLE_MODELS.some(candidate => candidate.id === model)
        ? model
        : DEFAULT_GENERATION_MODEL
}

interface GenerationState {
    // Prompt fields
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    negativePrompt: string
    inpaintingPrompt: string

    // Model selection
    model: string

    // Generation settings
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smeaDyn: boolean
    variety: boolean

    seed: number
    previewSeed: number | null
    seedLocked: boolean
    selectedResolution: Resolution

    // Quality settings
    qualityToggle: boolean
    ucPreset: number

    // Batch generation
    batchCount: number
    currentBatch: number

    // I2I & Inpainting
    sourceImage: string | null
    strength: number
    noise: number
    mask: string | null
    i2iMode: 'i2i' | 'inpaint' | null

    // Timing
    lastGenerationTime: number | null  // ms
    estimatedTime: number | null

    // State
    isGenerating: boolean // Deprecated in favor of generatingMode check? Or keep for local main mode state?
    generatingMode: 'main' | 'scene' | 'styleLab' | null
    isCancelled: boolean
    previewImage: string | null
    history: HistoryItem[]

    // AbortController for cancellation
    abortController: AbortController | null

    // Generation session ID (to handle race conditions on cancel/restart)
    generationSessionId: number

    // Streaming progress (0-100)
    streamProgress: number

    // Main Composition v2 rollout and diagnostics
    compositionMode: MainCompositionMode
    selectedRecipeId: string | null
    compositionWarnings: readonly ReadonlyCompositionIssue[]
    compositionErrors: readonly ReadonlyCompositionIssue[]
    lastResolvedPlan: ReadonlyCompositionPlan | null
    compositionShadowDiff: MainCompositionShadowDiff | null
    /** Independent Style Lab request-composition rollback switch. */
    styleLabCompositionMode: StyleLabCompositionMode

    // Actions
    setBasePrompt: (prompt: string) => void
    setAdditionalPrompt: (prompt: string) => void
    setDetailPrompt: (prompt: string) => void
    setNegativePrompt: (prompt: string) => void
    setInpaintingPrompt: (prompt: string) => void

    setModel: (model: string) => void
    setSteps: (steps: number) => void
    setCfgScale: (v: number) => void
    setCfgRescale: (v: number) => void
    setSampler: (v: string) => void
    setScheduler: (v: string) => void
    setSmea: (v: boolean) => void
    setSmeaDyn: (v: boolean) => void
    setVariety: (v: boolean) => void

    setSeed: (seed: number) => void
    setPreviewSeed: (seed: number | null) => void
    setSeedLocked: (locked: boolean) => void
    setSelectedResolution: (resolution: Resolution) => void
    setQualityToggle: (v: boolean) => void
    setUcPreset: (v: number) => void

    setBatchCount: (count: number) => void

    // I2I Actions
    setSourceImage: (img: string | null) => void
    setReferenceImage: (img: string | null) => void
    setStrength: (v: number) => void
    setNoise: (v: number) => void
    setMask: (mask: string | null) => void
    setI2IMode: (mode: 'i2i' | 'inpaint' | null) => void
    resetI2IParams: () => void

    // Batch update for preset loading (avoids multiple IndexedDB writes)
    applyPreset: (preset: {
        basePrompt: string
        additionalPrompt: string
        detailPrompt: string
        negativePrompt: string
        model: string
        steps: number
        cfgScale: number
        cfgRescale: number
        sampler: string
        scheduler: string
        smea: boolean
        smeaDyn: boolean
        variety?: boolean
        qualityToggle?: boolean
        ucPreset?: number
        selectedResolution: Resolution
    }) => void

    generate: (options?: GenerateOptions) => Promise<void>
    cancelGeneration: () => void
    addToHistory: (item: HistoryItem) => void
    clearHistory: () => void
    setPreviewImage: (url: string | null) => void
    setIsGenerating: (v: boolean) => void // Only for Main Mode use ideally
    setGeneratingMode: (mode: 'main' | 'scene' | 'styleLab' | null) => void
    setStreamProgress: (progress: number) => void
    setCompositionMode: (mode: MainCompositionMode) => void
    setStyleLabCompositionMode: (mode: StyleLabCompositionMode) => void
    setSelectedRecipeId: (recipeId: string | null) => void
    
    // Memory cleanup - call when leaving main mode to release large Base64 data
    clearRuntimeData: () => void
}

export const useGenerationStore = create<GenerationState>()(
    persist(
        (set, get) => ({
            // Initial state
            basePrompt: '',
            additionalPrompt: '',
            detailPrompt: '',
            negativePrompt: '',
            inpaintingPrompt: '',

            model: DEFAULT_GENERATION_MODEL,

            steps: 28,
            cfgScale: 5.0,
            cfgRescale: 0.0,
            sampler: 'k_euler_ancestral',
            scheduler: 'karras',
            smea: true,
            smeaDyn: true,
            variety: false,

            seed: Math.floor(Math.random() * 4294967295),
            previewSeed: null,
            seedLocked: false,
            selectedResolution: { label: 'Portrait', width: 832, height: 1216 },

            qualityToggle: true,
            ucPreset: 0,

            batchCount: 1,
            currentBatch: 0,

            // I2I Init
            sourceImage: null,
            strength: 0.7,
            noise: 0.0,
            mask: null,
            i2iMode: null,

            lastGenerationTime: null,
            estimatedTime: null,

            isGenerating: false,
            generatingMode: null,
            isCancelled: false,
            previewImage: null,
            history: [],
            abortController: null,
            generationSessionId: 0,
            streamProgress: 0,
            compositionMode: 'v2',
            selectedRecipeId: null,
            compositionWarnings: [],
            compositionErrors: [],
            lastResolvedPlan: null,
            compositionShadowDiff: null,
            styleLabCompositionMode: 'v2',

            // Actions
            setBasePrompt: (prompt) => set({ basePrompt: prompt }),
            setAdditionalPrompt: (prompt) => set({ additionalPrompt: prompt }),
            setDetailPrompt: (prompt) => set({ detailPrompt: prompt }),
            setNegativePrompt: (prompt) => set({ negativePrompt: prompt }),
            setInpaintingPrompt: (prompt) => set({ inpaintingPrompt: prompt }),

            setModel: (model) => set({ model: normalizeSelectableGenerationModel(model) }),
            setSteps: (steps) => set({ steps }),
            setCfgScale: (cfgScale) => set({ cfgScale }),
            setCfgRescale: (cfgRescale) => set({ cfgRescale }),
            setSampler: (sampler) => set({ sampler }),

            // Batch update - single IndexedDB write instead of 16 separate writes
            applyPreset: (preset) => set({
                basePrompt: preset.basePrompt,
                additionalPrompt: preset.additionalPrompt,
                detailPrompt: preset.detailPrompt,
                negativePrompt: preset.negativePrompt,
                model: normalizeSelectableGenerationModel(preset.model),
                steps: preset.steps,
                cfgScale: preset.cfgScale,
                cfgRescale: preset.cfgRescale,
                sampler: preset.sampler,
                scheduler: preset.scheduler,
                smea: preset.smea,
                smeaDyn: preset.smeaDyn,
                variety: preset.variety ?? false,
                qualityToggle: preset.qualityToggle ?? true,
                ucPreset: preset.ucPreset ?? 0,
                selectedResolution: preset.selectedResolution,
            }),
            setScheduler: (scheduler) => set({ scheduler }),
            setSmea: (smea) => set({ smea }),
            setSmeaDyn: (smeaDyn) => set({ smeaDyn }),
            setVariety: (variety) => set({ variety }),

            setSeed: (seed) => set({ seed }),
            setPreviewSeed: (previewSeed) => set({ previewSeed }),
            setSeedLocked: (locked) => set({ seedLocked: locked }),
            setSelectedResolution: (resolution) => set({ selectedResolution: resolution }),
            setQualityToggle: (qualityToggle) => set({ qualityToggle }),
            setUcPreset: (ucPreset) => set({ ucPreset }),

            setBatchCount: (count) => set({ batchCount: count }),

            setSourceImage: (img) => set({ sourceImage: img }),
            setReferenceImage: (img) => set({ sourceImage: img }), // Alias for now
            setStrength: (v) => set({ strength: v }),
            setNoise: (v) => set({ noise: v }),
            setMask: (mask) => set({ mask }),
            setI2IMode: (mode) => set({ i2iMode: mode }),
            resetI2IParams: () => set({ sourceImage: null, mask: null, strength: 0.7, noise: 0.0, inpaintingPrompt: '', i2iMode: null }),

            // Memory cleanup - release large runtime data (previewImage, sourceImage, mask)
            // Call this when leaving main mode to prevent OOM
            clearRuntimeData: () => {
                console.log('[GenerationStore] Clearing runtime data to free memory')
                set({
                    previewImage: null, 
                    sourceImage: null, 
                    mask: null,
                    streamProgress: 0
                })
            },

            cancelGeneration: () => {
                const { abortController, seedLocked } = get()
                if (abortController) {
                    abortController.abort()
                }
                // Generate new seed if not locked (same as successful generation)
                const newSeed = seedLocked ? undefined : Math.floor(Math.random() * 4294967295)
                // Keep isGenerating=true until current request completes (prevents 429 errors)
                // The finally block in generate() will set isGenerating=false
                set({ 
                    isCancelled: true, 
                    // isGenerating stays true - button remains locked until API response arrives
                    currentBatch: 0,
                    ...(newSeed !== undefined && { seed: newSeed })
                })
                toast({
                    title: i18n.t('toast.generationCancelled.title'),
                    description: i18n.t('toast.generationCancelled.desc'),
                })
            },

            generate: async (options = {}) => {
                const {
                    basePrompt, additionalPrompt, detailPrompt, negativePrompt, inpaintingPrompt,
                    model, steps, cfgScale, cfgRescale, sampler, scheduler, smea, smeaDyn, variety,
                    selectedResolution, batchCount, lastGenerationTime,
                    sourceImage, strength, noise, mask,
                    compositionMode: requestedCompositionMode, selectedRecipeId,
                } = get()
                const compositionMode = effectiveMainCompositionMode(requestedCompositionMode)

                const slot1Token = useAuthStore.getState().getActiveTokens().find((entry) => entry.slot === 1)
                const token = slot1Token?.token

                if (!token && options.capturePrepared === undefined) {
                    useAuthStore.getState().requestCredentialUnlock()
                    toast({
                        title: i18n.t('toast.tokenRequired.title'),
                        description: i18n.t('toast.tokenRequired.desc'),
                        variant: 'destructive',
                    })
                    return
                }

                // Check for cross-mode conflict
                const activeGeneratingMode = get().generatingMode
                if (activeGeneratingMode && activeGeneratingMode !== 'main') {
                    toast({
                        title: i18n.t('common.error'),
                        description: activeGeneratingMode === 'scene'
                            ? i18n.t('generate.conflictScene', '씬 모드에서 생성 중입니다.')
                            : i18n.t('generate.conflictStyleLab', '그림체 연구소에서 생성 중입니다.'),
                        variant: 'destructive',
                    })
                    return
                }

                // Create new AbortController and session ID
                const abortController = new AbortController()
                const sessionId = Date.now()
                
                // MEMORY: Clear previous preview image before starting new generation
                // This helps GC reclaim the previous base64 data (~3-5MB per image)
                set({
                    isGenerating: true,
                    generatingMode: 'main',
                    isCancelled: false,
                    abortController,
                    generationSessionId: sessionId,
                    estimatedTime: lastGenerationTime ? lastGenerationTime * batchCount : null,
                    previewImage: null, // Clear previous preview to free memory
                    streamProgress: 0,  // Reset streaming progress
                    compositionWarnings: [],
                    compositionErrors: [],
                    lastResolvedPlan: null,
                    compositionShadowDiff: null,
                })
                const sourceImageDigest = mainRuntimeDigest(sourceImage)
                const maskDigest = mainRuntimeDigest(mask)

                try {
                    let completedBatchCount = 0
                    for (let i = 0; i < batchCount; i++) {
                        // Check if cancelled or session changed (race condition protection)
                        if (get().isCancelled || get().generationSessionId !== sessionId) {
                            console.log('[Generate] Session invalidated, stopping batch loop')
                            break
                        }

                        set({ currentBatch: i + 1 })

                        const startTime = Date.now()

                        // Get current seed for this generation
                        // Use the current store seed, then immediately set next seed
                        let currentSeed = get().seed
                        if (currentSeed === 0) {
                            currentSeed = Math.floor(Math.random() * 4294967295)
                        }

                        // Immediately advance seed so UI shows next seed at generation start
                        if (!get().seedLocked) {
                            set({ seed: Math.floor(Math.random() * 4294967295) })
                        }

                        const settings = useSettingsStore.getState()
                        const { width: finalWidth, height: finalHeight } = await resolveMainSourceDimensions(
                            sourceImage,
                            selectedResolution,
                        )
                        if (get().isCancelled || get().generationSessionId !== sessionId) break

                        const characterPromptState = useCharacterPromptStore.getState()
                        const referenceStateBeforeLoad = useCharacterStore.getState()
                        let resolvedPlan: ReadonlyCompositionPlan | null = null
                        let resolvedDirectRecipeId: string = MAIN_DIRECT_RECIPE_ID
                        let compositionOutput: MainOutputMaterialization | null = null
                        let sequenceProposal: DeepReadonly<FragmentSequenceCommitProposal> | null = null
                        let shadowParams: GenerationParams | null = null
                        const legacyFragmentSession = compositionMode === 'v2'
                            ? null
                            : createWildcardResolutionSession()

                        if (compositionMode !== 'legacy') {
                            const assetProfile = useAssetModuleStore.getState().profile
                            const { usePresetStore } = await import('./preset-store')
                            const paramsPresetState = usePresetStore.getState()
                            const recipeSelection = resolveMainRecipeSelection(assetProfile, selectedRecipeId)
                            const effectiveAssetRecipe = recipeSelection.isDirect
                                ? undefined
                                : assetProfile.recipes.find(recipe => recipe.id === recipeSelection.recipeId)
                            const effectiveAssetFragmentSources = effectiveAssetRecipe === undefined
                                ? []
                                : collectStringValues({
                                    steps: effectiveAssetRecipe.steps,
                                    modules: effectiveAssetRecipe.steps.map(step => assetProfile.modules[step.moduleId]),
                                })
                            const fragment = await buildMainFragmentInput(
                                compositionMode === 'v2' ? 'generate' : 'preview',
                                [
                                    basePrompt,
                                    inpaintingPrompt,
                                    additionalPrompt,
                                    detailPrompt,
                                    negativePrompt,
                                    ...characterPromptState.characters.flatMap(character => [
                                        character.prompt,
                                        character.negative,
                                    ]),
                                    ...effectiveAssetFragmentSources,
                                ],
                            )
                            if (get().isCancelled || get().generationSessionId !== sessionId) break

                            const engineDefaults: MainCompositionSnapshot['params'] = {
                                model,
                                width: roundTo64(selectedResolution.width),
                                height: roundTo64(selectedResolution.height),
                                steps,
                                cfgScale,
                                cfgRescale,
                                sampler,
                                scheduler,
                                smea,
                                smeaDyn,
                                variety,
                                seed: currentSeed,
                                qualityToggle: get().qualityToggle,
                                ucPreset: get().ucPreset,
                                sourceMode: 'text-to-image',
                                strength,
                                noise,
                                characterPositionEnabled: characterPromptState.positionEnabled,
                            }
                            const snapshot: MainCompositionSnapshot = {
                                profile: assetProfile,
                                selectedRecipeId,
                                prompt: {
                                    base: basePrompt,
                                    inpainting: inpaintingPrompt,
                                    additional: additionalPrompt,
                                    detail: detailPrompt,
                                    negative: negativePrompt,
                                },
                                characters: characterPromptState.characters,
                                characterPresets: characterPromptState.presets,
                                characterGroups: characterPromptState.groups,
                                positionEnabled: characterPromptState.positionEnabled,
                                references: referenceSnapshots(
                                    referenceStateBeforeLoad.characterImages,
                                    referenceStateBeforeLoad.vibeImages,
                                ),
                                paramsPresets: paramsPresetState.presets,
                                activeParamsPresetId: paramsPresetState.activePresetId,
                                params: engineDefaults,
                                output: {
                                    autoSave: settings.autoSave,
                                    savePath: settings.savePath,
                                    useAbsolutePath: settings.useAbsolutePath,
                                    imageFormat: settings.imageFormat,
                                    metadataMode: settings.metadataMode,
                                    portableRoot: runtimeCapabilities.absoluteOutputPath.supported
                                        ? 'pictures'
                                        : 'app-data',
                                },
                                source: {
                                    hasSourceImage: Boolean(sourceImage),
                                    hasMask: Boolean(mask),
                                    sourceImageDigest,
                                    maskDigest,
                                    width: finalWidth,
                                    height: finalHeight,
                                    strength,
                                    noise,
                                },
                            }
                            const composition = resolveMainComposition({
                                snapshot,
                                requestId: `main-request:${sessionId}:${i}`,
                                now: new Date(startTime).toISOString(),
                                seed: currentSeed,
                                fragment,
                            })
                            resolvedDirectRecipeId = composition.directRecipeId
                            const diagnostics = diagnosticsFromMainResolution(composition)
                            set({
                                compositionWarnings: diagnostics.warnings,
                                compositionErrors: diagnostics.errors,
                                lastResolvedPlan: diagnostics.plan,
                            })

                            if (!composition.result.success) {
                                if (compositionMode === 'v2') {
                                    toast({
                                        title: i18n.t('composition.invalidPlan', 'Composition plan is invalid'),
                                        description: composition.result.errors.map(issue => issue.code).join(', '),
                                        variant: 'destructive',
                                    })
                                    break
                                }
                                set({
                                    compositionShadowDiff: {
                                        matches: false,
                                        v2Valid: false,
                                        differences: [{
                                            path: '$plan',
                                            legacy: 'valid',
                                            v2: composition.result.errors.map(issue => issue.code),
                                            ...(composition.result.errors.some(issue => issue.code === 'E_MODULE_REF_MISSING')
                                                ? { approvedRule: 'strict-broken-reference' as const }
                                                : {}),
                                        }],
                                    },
                                })
                            } else {
                                resolvedPlan = composition.result.plan
                                compositionOutput = composition.output
                                sequenceProposal = composition.result.sequenceCommitProposal
                                const portableOutput = composition.output?.portableDirectory
                                if (portableOutput?.kind === 'bookmark'
                                    && portableOutput.bookmarkId === 'main-output:absolute-runtime'
                                    && runtimeCapabilities.absoluteOutputPath.supported
                                    && composition.output?.directory) {
                                    runtimePortablePathTokenRegistry.register({
                                        logicalId: portableOutput.bookmarkId,
                                        platform: runtimeCapabilities.platform,
                                        kind: 'directory',
                                        opaqueToken: composition.output.directory,
                                        displayPath: composition.output.directory,
                                    })
                                }
                                if (compositionMode === 'v2') {
                                    const portableAssessment = assessPortableCompositionPlan(
                                        composition.result.plan,
                                        runtimeCapabilities,
                                        runtimePortablePathTokenRegistry,
                                    )
                                    if (!portableAssessment.readyForGeneration) {
                                        toast({
                                            title: i18n.t(
                                                'composition.resourceRepairRequired',
                                                'Repair output destination before generation',
                                            ),
                                            description: portableAssessment.issues
                                                .map(issue => `${issue.message} ${issue.repairAction.label}`)
                                                .join(' '),
                                            variant: 'destructive',
                                        })
                                        break
                                    }
                                }
                            }
                            if (get().isCancelled || get().generationSessionId !== sessionId) break
                        }

                        let modulePlan: AssetModulePlan | null = null
                        let v2ModulePlan: AssetModulePlan | null = null
                        let legacyParams: GenerationParams | null = null
                        if (compositionMode !== 'v2') {
                            modulePlan = await resolveMainAssetModulePlan(currentSeed, {
                                wildcardProcessor: legacyFragmentSession?.process,
                            })
                            if (compositionMode === 'shadow'
                                && resolvedPlan !== null
                                && resolvedPlan.recipeId !== resolvedDirectRecipeId) {
                                v2ModulePlan = await resolveMainAssetModulePlan(currentSeed, {
                                    recipeId: resolvedPlan.recipeId,
                                    now: new Date(startTime),
                                    wildcardProcessor: prompt => prompt,
                                })
                            }
                        } else if (resolvedPlan?.recipeId !== resolvedDirectRecipeId) {
                            v2ModulePlan = await resolveMainAssetModulePlan(currentSeed, {
                                recipeId: resolvedPlan?.recipeId,
                                now: new Date(startTime),
                                wildcardProcessor: prompt => prompt,
                            })
                        }
                        if (get().isCancelled || get().generationSessionId !== sessionId) break

                        const modulePromptsActive = compositionMode !== 'v2'
                            && hasAssetModulePrompts(modulePlan)
                        let legacyPrompt = ''
                        let legacyNegative = ''
                        if (compositionMode !== 'v2') {
                            if (modulePromptsActive) {
                                legacyPrompt = readStringParam(modulePlan?.generationParams.prompt)
                                legacyNegative = readStringParam(modulePlan?.generationParams.negative_prompt)
                            } else {
                                legacyPrompt = [
                                    removeComments(basePrompt),
                                    removeComments(inpaintingPrompt),
                                    removeComments(additionalPrompt),
                                    removeComments(detailPrompt),
                                ].filter(Boolean).join(', ')
                                legacyPrompt = await legacyFragmentSession!.process(legacyPrompt)
                                legacyNegative = removeComments(negativePrompt)
                            }
                        }
                        if (get().isCancelled || get().generationSessionId !== sessionId) break

                        await useCharacterStore.getState().ensureImagesLoaded()
                        if (get().isCancelled || get().generationSessionId !== sessionId) break
                        const { characterImages: allCharImages, vibeImages: allVibeImages } = useCharacterStore.getState()
                        const characterImages = allCharImages.filter(img => img.enabled !== false && img.base64)
                        const vibeImages = allVibeImages.filter(img => img.enabled !== false && img.base64)

                        if (compositionMode !== 'v2') {
                            const moduleCharacterPrompts = readModuleCharacterPrompts(modulePlan)
                            const processedCharacterPrompts = modulePromptsActive
                                ? moduleCharacterPrompts ?? []
                                : await Promise.all(
                                    characterPromptState.characters.filter(c => c.enabled).map(async c => ({
                                        ...c,
                                        prompt: await legacyFragmentSession!.process(c.prompt),
                                        negative: await legacyFragmentSession!.process(c.negative),
                                    })),
                                )
                            legacyParams = {
                                prompt: legacyPrompt,
                                negative_prompt: legacyNegative,
                                model,
                                width: finalWidth,
                                height: finalHeight,
                                steps,
                                cfg_scale: cfgScale,
                                cfg_rescale: cfgRescale,
                                sampler,
                                scheduler,
                                smea,
                                smea_dyn: smeaDyn,
                                variety,
                                seed: currentSeed,
                                ...(sourceImage ? { sourceImage } : {}),
                                strength,
                                noise,
                                ...(mask ? { mask } : {}),
                                charImages: characterImages.map(img => img.base64),
                                charStrength: characterImages.map(img => img.strength),
                                charFidelity: characterImages.map(img => img.fidelity ?? 0.6),
                                charReferenceType: characterImages.map(img => img.referenceType ?? 'character&style'),
                                charCacheKeys: characterImages.map(img => img.cacheKey || null),
                                vibeImages: vibeImages.map(img => img.base64),
                                vibeInfo: vibeImages.map(img => img.informationExtracted),
                                vibeStrength: vibeImages.map(img => img.strength),
                                preEncodedVibes: vibeImages.map(img => img.encodedVibe || null),
                                characterPrompts: processedCharacterPrompts,
                                characterPositionEnabled: modulePromptsActive && moduleCharacterPrompts
                                    ? true
                                    : characterPromptState.positionEnabled,
                                imageFormat: settings.imageFormat,
                                metadataMode: modulePlan?.output.metadataMode ?? settings.metadataMode,
                                ...(modulePlan === null ? {} : { assetModulePlan: modulePlan }),
                                qualityToggle: get().qualityToggle,
                                ucPreset: get().ucPreset,
                                promptParts: modulePromptsActive
                                    ? {
                                        base: legacyPrompt,
                                        additional: '',
                                        detail: '',
                                        negative: legacyNegative,
                                        inpainting: '',
                                    }
                                    : {
                                        base: basePrompt,
                                        additional: additionalPrompt,
                                        detail: detailPrompt,
                                        negative: negativePrompt,
                                        inpainting: inpaintingPrompt,
                                    },
                            }
                        }

                        if (resolvedPlan !== null) {
                            shadowParams = await buildV2GenerationParams({
                                plan: resolvedPlan,
                                compositionMode: compositionMode === 'shadow' ? 'shadow' : 'v2',
                                modulePlan: v2ModulePlan,
                                sourceImage,
                                mask,
                                characterImages,
                                vibeImages,
                            })
                        }

                        let generationParams: GenerationParams
                        if (compositionMode === 'v2') {
                            if (shadowParams === null) break
                            generationParams = shadowParams
                        } else {
                            if (legacyParams === null) break
                            generationParams = legacyParams
                            if (compositionMode === 'shadow'
                                && shadowParams !== null
                                && resolvedPlan !== null
                                && compositionOutput !== null) {
                                set({
                                    compositionShadowDiff: compareMainGenerationParams(
                                        legacyParams,
                                        shadowParams,
                                        {
                                            legacy: legacyShadowOutputSemantics({
                                                modulePlan,
                                                settings,
                                                sourceImage,
                                                mask,
                                                directRecipeId: resolvedDirectRecipeId,
                                            }),
                                            v2: v2ShadowOutputSemantics(resolvedPlan, compositionOutput),
                                        },
                                    ),
                                })
                                generationParams = {
                                    ...generationParams,
                                    compositionMode: 'shadow',
                                    compositionPlanHash: clonePlanHash(resolvedPlan),
                                    compositionPlanId: resolvedPlan.planId,
                                    compositionRecipeId: resolvedPlan.recipeId,
                                    compositionProvenanceSummary: shadowParams.compositionProvenanceSummary,
                                }
                            }
                        }
                        const finalPrompt = generationParams.prompt
                        const imageFormat = generationParams.imageFormat ?? settings.imageFormat
                        const effectiveMetadataMode = generationParams.metadataMode ?? settings.metadataMode
                        const v2Output = compositionMode === 'v2' ? compositionOutput : null
                        // Reset progress
                        set({ streamProgress: 0 })

                        // Keep source-edit requests on ZIP until stream-final
                        // parity is fixture-proven against server-composited output.
                        const hasSourceEdit = Boolean(generationParams.sourceImage || generationParams.mask)
                        const canUseStreaming = settings.useStreaming && !hasSourceEdit

                        const generationSequenceProposal = compositionMode === 'v2'
                            ? sequenceProposal
                            : legacyFragmentSession!.sequenceCommitProposal
                        const {
                            savePath,
                            autoSave: liveAutoSave,
                            useAbsolutePath,
                        } = useSettingsStore.getState()
                        const autoSave = v2Output?.autoSave ?? liveAutoSave
                        const requestedAbsolutePath = v2Output?.useAbsolutePath ?? useAbsolutePath

                        if (options.capturePrepared !== undefined) {
                            const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
                            const moduleFileName = ensureImageFileExtension(
                                v2Output?.fileName ?? modulePlan?.output.fileName,
                                fileExt,
                            )
                            await options.capturePrepared({
                                params: generationParams,
                                finalPrompt,
                                imageFormat,
                                metadataMode: effectiveMetadataMode,
                                streaming: canUseStreaming,
                                sequenceCommitProposal: generationSequenceProposal,
                                output: {
                                    autoSave,
                                    directory: v2Output?.directory
                                        || modulePlan?.output.directory
                                        || savePath
                                        || 'NAIS_Output',
                                    useAbsolutePath: requestedAbsolutePath,
                                    capabilityFallbackDirectory: v2Output?.capabilityFallbackDirectory
                                        || savePath
                                        || 'NAIS_Output',
                                    ...(v2Output?.portableDirectory === undefined
                                        ? {}
                                        : { portableDirectory: v2Output.portableDirectory }),
                                    ...(moduleFileName === null ? {} : { fileName: moduleFileName }),
                                    collisionPolicy: resolvedPlan?.outputPolicy.collisionPolicy ?? 'unique',
                                },
                            })
                            completedBatchCount += 1
                            continue
                        }

                        if (get().isCancelled || get().generationSessionId !== sessionId) break

                        if (!token) throw new Error('Execution credential is unavailable')

                        let result
                        const streamMimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                        if (canUseStreaming) {
                            console.log('[Generate] Using streaming API...')
                            result = await generateImageStream(token, generationParams, (progress, partialImage) => {
                                if (get().isCancelled || get().generationSessionId !== sessionId) return
                                // Update preview image directly (no null clearing - causes flicker)
                                if (partialImage) {
                                    set({ streamProgress: progress, previewImage: `data:${streamMimeType};base64,${partialImage}` })
                                } else {
                                    set({ streamProgress: progress })
                                }
                            }, abortController.signal)
                            set({ streamProgress: 0 })
                        } else {
                            console.log('[Generate] Using standard API...')
                            result = await generateImage(token, generationParams, abortController.signal)
                        }

                        // Check if cancelled or session changed after API call
                        if (get().isCancelled || get().generationSessionId !== sessionId) {
                            console.log('[Generate] Session invalidated after API call, discarding result')
                            break
                        }

                        const generationTime = Date.now() - startTime
                        set({ lastGenerationTime: generationTime })

                        if (result.success && result.imageData) {
                            const resultParams: GenerationParams = {
                                ...generationParams,
                                sentPayloadSummary: result.sentPayloadSummary,
                            }
                            const mimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                            const imageUrl = `data:${mimeType};base64,${result.imageData}`

                            // Publish filesystem outputs through the transactional writer.
                            const canCommitOutput = (): boolean => (
                                !get().isCancelled && get().generationSessionId === sessionId
                            )
                            let sequenceCommitted = false
                            let sequenceConflict = false
                            let historyCommitted = false
                            let historyId: string | null = null
                            const commitGeneratedSequence = (): boolean => {
                                if (sequenceCommitted) return true
                                if (commitMainFragmentSequenceProposal(generationSequenceProposal)) {
                                    sequenceCommitted = true
                                    return true
                                }
                                set({ previewImage: null, streamProgress: 0 })
                                toast({
                                    title: i18n.t('composition.sequenceConflict', 'Fragment sequence changed'),
                                    description: i18n.t(
                                        'composition.sequenceConflictDesc',
                                        'The generated result was discarded because the fragment counter changed.',
                                    ),
                                    variant: 'destructive',
                                })
                                sequenceConflict = true
                                return false
                            }
                            const commitHistory = (thumbnail: string): void => {
                                historyId = Date.now().toString()
                                const historyItem: HistoryItem = {
                                    id: historyId,
                                    url: thumbnail,
                                    prompt: finalPrompt,
                                    seed: generationParams.seed,
                                    timestamp: new Date(),
                                    sentPayloadSummary: result.sentPayloadSummary,
                                }
                                set(state => ({
                                    history: [historyItem, ...state.history].slice(0, 20),
                                }))
                                historyCommitted = true
                            }
                            const createFallbackThumbnail = async (): Promise<string> => {
                                try {
                                    return await createThumbnail(imageUrl)
                                } catch {
                                    return imageUrl
                                }
                            }

                            if (autoSave) {
                                try {
                                    const binaryString = atob(result.imageData)
                                    const bytes = new Uint8Array(binaryString.length)
                                    for (let j = 0; j < binaryString.length; j++) {
                                        bytes[j] = binaryString.charCodeAt(j)
                                    }

                                    // Determine generation type prefix
                                    let typePrefix = ''
                                    if (mask) {
                                        typePrefix = 'INPAINT_'
                                    } else if (sourceImage) {
                                        typePrefix = 'I2I_'
                                    }
                                    const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
                                    const moduleFileName = ensureImageFileExtension(
                                        v2Output?.fileName ?? modulePlan?.output.fileName,
                                        fileExt,
                                    )
                                    const fileName = moduleFileName ?? `NAIS_${typePrefix}${Date.now()}.${fileExt}`
                                    const plannedOutputDir = v2Output?.directory
                                        || modulePlan?.output.directory
                                        || savePath
                                        || 'NAIS_Output'
                                    const output = await getRuntimeOutputWriter().write({
                                        destination: {
                                            ...(v2Output?.portableDirectory === undefined
                                                ? {}
                                                : { portableDirectory: v2Output.portableDirectory }),
                                            directory: plannedOutputDir,
                                            useAbsolutePath: requestedAbsolutePath,
                                            capabilityFallbackDirectory: v2Output?.capabilityFallbackDirectory
                                                || savePath
                                                || 'NAIS_Output',
                                            workflowDefaultDirectory: 'NAIS_Output',
                                            fileName,
                                            extension: fileExt,
                                            collisionPolicy: resolvedPlan?.outputPolicy.collisionPolicy ?? 'unique',
                                        },
                                        imageBytes: bytes,
                                        imageDataUrl: imageUrl,
                                        metadata: {
                                            params: resultParams,
                                            imageFormat,
                                            metadataMode: effectiveMetadataMode,
                                            includeWebpCompatibilitySidecar: true,
                                        },
                                        generateThumbnail: createThumbnail,
                                        canCommit: canCommitOutput,
                                        commitWorkflow: outputResult => {
                                            if (!canCommitOutput()) {
                                                throw new Error('Main generation session changed before output publication')
                                            }
                                            if (!commitGeneratedSequence()) {
                                                throw new Error('Fragment sequence changed before Main output commit')
                                            }
                                            commitHistory(outputResult.thumbnailDataUrl ?? imageUrl)
                                            publishGeneratedArtifact({ path: outputResult.path })
                                        },
                                        rollbackWorkflow: () => {
                                            if (historyId === null) return
                                            set(state => ({
                                                history: state.history.filter(item => item.id !== historyId),
                                            }))
                                            historyCommitted = false
                                        },
                                    })
                                    if (output.status === 'cancelled') break
                                    if (output.result.capabilityFallbackUsed) {
                                        toast({
                                            title: i18n.t(
                                                'composition.outputCapabilityFallbackTitle',
                                                'Output destination changed for this platform',
                                            ),
                                            description: i18n.t(
                                                'composition.outputCapabilityFallbackDescription',
                                                '{{reason}} Alternative: {{alternative}}',
                                                {
                                                    reason: output.result.capabilityFallbackReason ?? '',
                                                    alternative: output.result.capabilityFallbackAlternative ?? '',
                                                },
                                            ),
                                        })
                                    }
                                } catch (outputError) {
                                    reportDiagnostic(outputError, { operation: 'main.output', stage: 'write' })
                                    if (!canCommitOutput() || sequenceConflict) break
                                    if (historyCommitted) {
                                        // OutputWriter has retained its recovery journal; preserve
                                        // the successfully committed workflow state without logging
                                        // a raw platform error to the console.
                                    } else {
                                        throw outputError
                                    }
                                }
                            } else {
                                const thumbnail = await createFallbackThumbnail()
                                if (!canCommitOutput()) break
                                if (!commitGeneratedSequence()) break
                                commitHistory(thumbnail)
                                const memExt = imageFormat === 'webp' ? 'webp' : 'png'
                                const memoryFileName = ensureImageFileExtension(
                                    v2Output?.fileName ?? modulePlan?.output.fileName,
                                    memExt,
                                ) ?? `NAIS_${Date.now()}.${memExt}`
                                const memoryPath = `memory://${memoryFileName}`
                                publishGeneratedArtifact({ path: memoryPath, data: imageUrl })
                            }
                            set({ previewImage: imageUrl })

                            // Existing encoded caches are only updated after the
                            // generation and deferred fragment commit both succeed.
                            if (result.encodedVibes && result.encodedVibes.length > 0) {
                                const { vibeImages, updateVibeImage } = useCharacterStore.getState()
                                let encodedIndex = 0
                                for (let vi = 0; vi < vibeImages.length && encodedIndex < result.encodedVibes.length; vi++) {
                                    if (!vibeImages[vi].encodedVibe) {
                                        updateVibeImage(vibeImages[vi].id, { encodedVibe: result.encodedVibes[encodedIndex] })
                                        encodedIndex++
                                    }
                                }
                            }

                            // Refresh Anlas balance
                            useAuthStore.getState().refreshAnlas(1)
                            completedBatchCount++

                            // Seed already advanced at generation start

                            // Apply generation delay between batches (not after the last one)
                            const { generationDelay } = useSettingsStore.getState()
                            if (i < batchCount - 1 && generationDelay > 0) {
                                await new Promise(resolve => setTimeout(resolve, generationDelay))
                            }
                        } else {
                            const termination = result.termination
                            const diagnostic = reportDiagnostic(new Error(result.error || 'Main generation failed'), {
                                operation: 'main.generate',
                                stage: termination === 'timeout'
                                    ? 'transport-timeout'
                                    : termination === 'cancelled'
                                        ? 'transport-cancelled'
                                        : canUseStreaming ? 'stream' : 'request',
                                prompt: generationParams.prompt,
                                cancelled: termination === 'cancelled',
                                timeout: termination === 'timeout',
                            })
                            toast({
                                title: i18n.t('toast.generationFailed.title'),
                                description: diagnostic.userSummary,
                                variant: 'destructive',
                            })
                            break
                        }
                    }

                    // Show completion toast for batch
                    if (!get().isCancelled && batchCount > 1 && completedBatchCount === batchCount) {
                        toast({
                            title: i18n.t('toast.batchComplete.title'),
                            description: i18n.t('toast.batchComplete.desc', { count: batchCount }),
                            variant: 'success',
                        })
                    }

                } catch (error) {
                    if (get().isCancelled) {
                        return
                    }
                    const diagnostic = reportDiagnostic(error, { operation: 'main.generate', stage: 'request' })
                    toast({
                        title: i18n.t('toast.errorOccurred.title'),
                        description: diagnostic.userSummary,
                        variant: 'destructive',
                    })
                } finally {
                    set({ isGenerating: false, generatingMode: null, currentBatch: 0, abortController: null })
                    // Release character/vibe base64 from memory after generation (~30-60MB)
                    // They will be reloaded from files on next generation
                    useCharacterStore.getState().releaseImageData()
                }
            },

            addToHistory: (item) => set(state => ({
                history: [item, ...state.history].slice(0, 20)
            })),

            clearHistory: () => set({ history: [] }),

            setPreviewImage: (url) => set({ previewImage: url }),
            setIsGenerating: (v) => set({ isGenerating: v, generatingMode: v ? 'main' : null }),
            setGeneratingMode: (mode) => set({ generatingMode: mode }),
            setStreamProgress: (progress) => set({ streamProgress: progress }),
            setCompositionMode: (compositionMode) => set({
                compositionMode,
                compositionWarnings: [],
                compositionErrors: [],
                lastResolvedPlan: null,
                compositionShadowDiff: null,
            }),
            setStyleLabCompositionMode: (styleLabCompositionMode) => set({ styleLabCompositionMode }),
            setSelectedRecipeId: (selectedRecipeId) => set({
                selectedRecipeId,
                compositionWarnings: [],
                compositionErrors: [],
                lastResolvedPlan: null,
                compositionShadowDiff: null,
            }),
        }),
        {
            name: 'nais2-generation',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                // Prompts
                basePrompt: state.basePrompt,
                additionalPrompt: state.additionalPrompt,
                detailPrompt: state.detailPrompt,
                negativePrompt: state.negativePrompt,
                // Model & Parameters
                model: state.model,
                steps: state.steps,
                cfgScale: state.cfgScale,
                cfgRescale: state.cfgRescale,
                sampler: state.sampler,
                scheduler: state.scheduler,
                smea: state.smea,
                smeaDyn: state.smeaDyn,
                variety: state.variety,
                qualityToggle: state.qualityToggle,
                ucPreset: state.ucPreset,
                // Seed - only save if locked
                ...(state.seedLocked ? { seed: state.seed } : {}),
                seedLocked: state.seedLocked,
                selectedResolution: state.selectedResolution,
                // Batch
                batchCount: state.batchCount,
                // Timing (for estimated time)
                lastGenerationTime: state.lastGenerationTime,
                // Main Composition rollout switch and explicit recipe selection
                compositionMode: state.compositionMode,
                styleLabCompositionMode: state.styleLabCompositionMode,
                selectedRecipeId: state.selectedRecipeId,
                // I2I & Inpainting state - DO NOT persist sourceImage/mask (large Base64 data, 1MB+ each)
                // Only persist lightweight settings
                i2iMode: state.i2iMode,
                strength: state.strength,
                noise: state.noise,
                inpaintingPrompt: state.inpaintingPrompt,
                // History - limit to 20 items to prevent memory issues
                history: state.history.slice(0, 20),
            }),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    reportDiagnostic(error, {
                        operation: 'generation-store.hydration',
                        stage: 'rehydrate',
                        category: 'persistence',
                    })
                    return
                }
                // Trim history to 20 items on load to prevent OOM
                if (state && state.history && state.history.length > 20) {
                    console.log(`[GenerationStore] Trimming history from ${state.history.length} to 20 items`)
                    state.history = state.history.slice(0, 20)
                }
                if (state) {
                    state.model = normalizeSelectableGenerationModel(state.model)
                    if (state.styleLabCompositionMode !== 'legacy'
                        && state.styleLabCompositionMode !== 'v2') {
                        state.styleLabCompositionMode = 'v2'
                    }
                    console.log('[GenerationStore] Hydrated successfully')
                }
            },
        }
    )
)
