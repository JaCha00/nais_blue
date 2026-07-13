import { hashCanonicalValue, sha256Utf8 } from '@/domain/composition/canonical-serialize'
import {
    CompositionEngine,
    type CompositionEngineOverrideLayer,
    type CompositionEngineResolveResult,
} from '@/domain/composition/engine'
import { createExternalProvenanceRef } from '@/domain/composition/provenance'
import { normalizeGenerationSeed } from '@/domain/composition/random'
import type {
    ChoiceRandomRule,
    CompositionDocument,
    CompositionModule,
    CompositionRecipe,
    ParamsOverride,
    PromptContribution,
    RandomTraceEntry,
    RecipeStep,
    ResolveRequest,
    ResolvedGenerationParams,
} from '@/domain/composition/types'
import {
    MAIN_DIRECT_SELECTION_ID,
    buildMainResolveRequest,
    type BuildMainCompositionInput,
} from '@/lib/composition/main-adapter'
import {
    STYLE_LAB_ARTIST_PLACEHOLDER,
    STYLE_LAB_DEFAULT_TEMPLATE,
    formatWeightedPromptTags,
    normalizePromptTag,
    type WeightedPromptTag,
} from '@/lib/style-lab'

export const STYLE_LAB_OUTPUT_FILENAME_TEMPLATE = 'NAIS_STYLELAB_{seed}' as const

const STYLE_LAB_TEMPLATE_PLACEHOLDERS = Object.freeze({
    [STYLE_LAB_ARTIST_PLACEHOLDER]: 'artist-tags',
    '{{basePrompt}}': 'base',
    '{{inpaintingPrompt}}': 'inpainting',
    '{{additionalPrompt}}': 'additional',
    '{{detailPrompt}}': 'detail',
} as const)

type StyleLabTemplateToken = typeof STYLE_LAB_TEMPLATE_PLACEHOLDERS[keyof typeof STYLE_LAB_TEMPLATE_PLACEHOLDERS]

export interface StyleLabCombinationSnapshot {
    /** Stable Style Lab store identity. Preview timestamps are intentionally absent. */
    id: string
    tags: readonly WeightedPromptTag[]
}

export interface BuildStyleLabCompositionInput extends BuildMainCompositionInput {
    combination: StyleLabCombinationSnapshot
    promptTemplate: string
    /** Test/recovery hook. The production default is the injected temporary recipe. */
    selectedRecipeId?: string
    /** Legacy workflow recipe values; live Main params still win at workflow-runtime precedence. */
    recipeParamsOverride?: ParamsOverride
}

export interface StyleLabCombinationProvenance {
    combinationId: string
    orderedTagDigest: string
    normalizedTags: WeightedPromptTag[]
    moduleId: string
    recipeId: string
    stepId: string
    randomRuleId: string
}

export interface BuiltStyleLabResolveRequest {
    request: ResolveRequest
    engineDefaults: ResolvedGenerationParams
    workflowRuntimeOverride: CompositionEngineOverrideLayer
    transportDerivedOverride: CompositionEngineOverrideLayer
    selectedRecipeId: string
    combination: StyleLabCombinationProvenance
}

export interface StyleLabCompositionResolution {
    result: CompositionEngineResolveResult
    selectedRecipeId: string
    combination: StyleLabCombinationProvenance
}

interface TemplateSegment {
    text: string
    separator: PromptContribution['separator']
    token?: StyleLabTemplateToken
}

function revisionFields(recipe: CompositionRecipe) {
    return {
        revision: recipe.revision,
        createdAt: recipe.createdAt,
        createdBy: recipe.createdBy,
        updatedAt: recipe.updatedAt,
        updatedBy: recipe.updatedBy,
    }
}

function normalizeCombination(combination: StyleLabCombinationSnapshot): {
    normalizedTags: WeightedPromptTag[]
    orderedTagDigest: string
    identityDigest: string
} {
    const normalizedTags = combination.tags
        .map(tag => normalizePromptTag({ ...tag }))
        .filter(tag => tag.tag.length > 0)
    const orderedTagDigest = `sha256:${hashCanonicalValue(normalizedTags.map(tag => ({
        tag: tag.tag,
        kind: tag.kind,
        weight: tag.weight,
        ...(tag.artist === undefined ? {} : { artist: tag.artist }),
    })))}`

    return {
        normalizedTags,
        orderedTagDigest,
        identityDigest: sha256Utf8(combination.id),
    }
}

function templateValue(
    token: StyleLabTemplateToken,
    input: BuildStyleLabCompositionInput,
    artistTags: string,
): string {
    switch (token) {
        case 'artist-tags':
            return artistTags
        case 'base':
            return input.snapshot.prompt.base
        case 'inpainting':
            return input.snapshot.source.hasMask ? input.snapshot.prompt.inpainting : ''
        case 'additional':
            return input.snapshot.prompt.additional
        case 'detail':
            return input.snapshot.prompt.detail
    }
}

/**
 * Keeps template literals and raw prompt parts separate so the engine owns
 * full-line comment removal and wildcard resolution for every source token.
 */
function templateSegments(input: BuildStyleLabCompositionInput, artistTags: string): TemplateSegment[] {
    const rawTemplate = input.promptTemplate.trim() || STYLE_LAB_DEFAULT_TEMPLATE
    const template = rawTemplate.includes(STYLE_LAB_ARTIST_PLACEHOLDER)
        ? rawTemplate
        : `${rawTemplate}, ${STYLE_LAB_ARTIST_PLACEHOLDER}`
    const placeholders = Object.keys(STYLE_LAB_TEMPLATE_PLACEHOLDERS)
        .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')
    const pieces = template.split(new RegExp(`(${placeholders})`, 'g'))
    const result: TemplateSegment[] = []
    let pendingSpace = false

    for (const piece of pieces) {
        if (piece.length === 0) continue
        const token = STYLE_LAB_TEMPLATE_PLACEHOLDERS[
            piece as keyof typeof STYLE_LAB_TEMPLATE_PLACEHOLDERS
        ]
        const rawText = token === undefined ? piece : templateValue(token, input, artistTags)
        const text = rawText.trim()
        const beginsWithWhitespace = /^\s/.test(piece)
        const separator: PromptContribution['separator'] = pendingSpace || beginsWithWhitespace
            ? 'space'
            : 'none'

        if (text.length > 0) result.push({ text, separator, ...(token === undefined ? {} : { token }) })

        // Template whitespace, rather than whitespace inside a raw prompt part,
        // controls how the next token is joined.
        pendingSpace = token === undefined && /\s$/.test(piece)
    }

    return result
}

function contribution(
    baseRecipe: CompositionRecipe,
    id: string,
    order: number,
    segment: TemplateSegment,
    combinationSource: ReturnType<typeof createExternalProvenanceRef>,
): PromptContribution {
    return {
        ...revisionFields(baseRecipe),
        id,
        orderKey: `style-lab:${String(order).padStart(6, '0')}`,
        enabled: true,
        target: { kind: 'positive', slot: 'workflow' },
        text: segment.text,
        merge: 'append',
        separator: segment.separator,
        ...(segment.token === 'artist-tags' ? { provenance: [combinationSource] } : {}),
    }
}

function sourceParams(input: BuildStyleLabCompositionInput): ParamsOverride {
    const source = input.snapshot.source
    return {
        width: source.width,
        height: source.height,
        sourceMode: source.hasMask
            ? 'inpaint'
            : source.hasSourceImage
                ? 'image-to-image'
                : 'text-to-image',
        ...(source.hasSourceImage ? { sourceImageResourceId: 'main-resource:source-image' } : {}),
        ...(source.hasMask ? { maskResourceId: 'main-resource:mask' } : {}),
        strength: source.strength,
        noise: source.noise,
    }
}

function documentEntityIds(document: CompositionDocument): Set<string> {
    const ids = new Set<string>([document.id])
    const addContributionIds = (items: readonly PromptContribution[]): void => {
        items.forEach(item => ids.add(item.id))
    }

    for (const profile of document.profiles) {
        ids.add(profile.id)
        addContributionIds(profile.contributions)
    }
    for (const module of document.modules) {
        ids.add(module.id)
        addContributionIds(module.contributions)
    }
    for (const recipe of document.recipes) {
        ids.add(recipe.id)
        for (const step of recipe.steps) {
            ids.add(step.id)
            addContributionIds(step.contributions)
        }
    }
    document.characters.forEach(item => ids.add(item.id))
    document.paramsPresets.forEach(item => ids.add(item.id))
    document.resources.forEach(item => ids.add(item.id))
    for (const rule of document.randomRules) {
        ids.add(rule.id)
        if (rule.kind === 'choice') rule.options.forEach(option => ids.add(option.id))
    }
    return ids
}

function allocateEntityId(base: string, usedIds: Set<string>): string {
    let candidate = base
    let suffix = 1
    while (usedIds.has(candidate)) {
        candidate = `${base}:${suffix}`
        suffix += 1
    }
    usedIds.add(candidate)
    return candidate
}

export function buildStyleLabResolveRequest(input: BuildStyleLabCompositionInput): BuiltStyleLabResolveRequest {
    // Style Lab always starts from Main's direct document. Asset recipes remain
    // available in the source profile but do not leak their prompt workflow into
    // an artist preview.
    const main = buildMainResolveRequest({
        ...input,
        snapshot: { ...input.snapshot, selectedRecipeId: MAIN_DIRECT_SELECTION_ID },
    })
    const directRecipe = main.request.document.recipes.find(recipe => recipe.id === main.directRecipeId)
    if (directRecipe === undefined || directRecipe.outputPolicy === undefined) {
        throw new Error('Main direct recipe and output policy are required for the Style Lab workflow adapter')
    }

    const normalized = normalizeCombination(input.combination)
    const idSuffix = normalized.identityDigest
    const usedIds = documentEntityIds(main.request.document)
    const moduleId = allocateEntityId(`style-lab:module:${idSuffix}`, usedIds)
    const recipeId = allocateEntityId(`style-lab:recipe:${idSuffix}`, usedIds)
    const stepId = allocateEntityId(`style-lab:step:${idSuffix}`, usedIds)
    const randomRuleId = allocateEntityId(`style-lab:combination-rule:${idSuffix}`, usedIds)
    const optionId = allocateEntityId(`style-lab:combination-option:${idSuffix}`, usedIds)
    const streamKey = `style-lab:${input.combination.id}/artist-combination`
    const combinationSource = createExternalProvenanceRef(
        `style-lab:artist-combination:${input.combination.id}`,
        { digest: normalized.orderedTagDigest },
    )
    const artistTags = formatWeightedPromptTags(normalized.normalizedTags)
    const contributions = templateSegments(input, artistTags).map((segment, index) => {
        const id = allocateEntityId(
            `style-lab:prompt:${idSuffix}:${String(index).padStart(6, '0')}`,
            usedIds,
        )
        return contribution(directRecipe, id, index, segment, combinationSource)
    })
    const replayTrace: RandomTraceEntry = {
        ruleId: randomRuleId,
        streamKey,
        drawIndex: 0,
        seed: normalizeGenerationSeed(input.seed),
        result: input.combination.id,
        selectedOptionIds: [optionId],
        provenance: combinationSource,
    }
    const randomRule: ChoiceRandomRule = {
        ...revisionFields(directRecipe),
        id: randomRuleId,
        orderKey: 'style-lab:combination',
        kind: 'choice',
        enabled: true,
        streamKey,
        scope: 'generation-seed',
        source: { mode: 'replay', entries: [replayTrace] },
        options: [{
            id: optionId,
            orderKey: 'style-lab:selected',
            value: input.combination.id,
            weight: 1,
        }],
        pickCount: 1,
        withoutReplacement: true,
    }
    const module: CompositionModule = {
        ...revisionFields(directRecipe),
        id: moduleId,
        orderKey: 'style-lab:module',
        name: `Style Lab ${input.combination.id}`,
        enabled: true,
        kind: 'prompt',
        contributions,
        characterPatches: [],
        resourceBindings: [],
        randomRuleIds: [randomRuleId],
    }
    const step: RecipeStep = {
        ...revisionFields(directRecipe),
        id: stepId,
        orderKey: 'style-lab:step',
        moduleId,
        enabled: true,
        contributions: [],
        characterPatches: [],
        resourceBindings: [],
        randomRuleIds: [],
    }
    const recipe: CompositionRecipe = {
        ...revisionFields(directRecipe),
        id: recipeId,
        orderKey: 'style-lab:recipe',
        name: `Style Lab ${input.combination.id}`,
        enabled: true,
        steps: [step],
        ...(input.recipeParamsOverride === undefined
            ? {}
            : { paramsOverride: { ...input.recipeParamsOverride } }),
        outputPolicy: {
            ...directRecipe.outputPolicy,
            filenameTemplate: STYLE_LAB_OUTPUT_FILENAME_TEMPLATE,
        },
    }
    const selectedRecipeId = input.selectedRecipeId ?? recipeId
    const document = main.request.document
    const request: ResolveRequest = {
        ...main.request,
        recipeId: selectedRecipeId,
        document: {
            ...document,
            profiles: document.profiles.map(profile => (
                profile.id === main.request.profileId
                    ? {
                        ...profile,
                        moduleIds: [...profile.moduleIds, moduleId],
                        recipeIds: [...profile.recipeIds, recipeId],
                    }
                    : profile
            )),
            modules: [...document.modules, module],
            recipes: [...document.recipes, recipe],
            randomRules: [...document.randomRules, randomRule],
        },
        // Positive Main parts are represented by the ordered workflow module;
        // negative request text remains a direct engine-owned contribution.
        contributions: main.request.contributions.filter(item => item.target.kind === 'negative'),
    }

    const runtimeParams: ParamsOverride = { ...input.snapshot.params }
    delete runtimeParams.seed
    delete runtimeParams.seedLocked

    return {
        request,
        engineDefaults: main.engineDefaults,
        workflowRuntimeOverride: {
            params: runtimeParams,
            sourceRef: createExternalProvenanceRef('style-lab:workflow-runtime'),
        },
        transportDerivedOverride: {
            params: sourceParams(input),
            sourceRef: createExternalProvenanceRef('style-lab:transport-derived'),
        },
        selectedRecipeId,
        combination: {
            combinationId: input.combination.id,
            orderedTagDigest: normalized.orderedTagDigest,
            normalizedTags: normalized.normalizedTags,
            moduleId,
            recipeId,
            stepId,
            randomRuleId,
        },
    }
}

export function resolveStyleLabComposition(
    input: BuildStyleLabCompositionInput,
): StyleLabCompositionResolution {
    const built = buildStyleLabResolveRequest(input)
    const result = CompositionEngine.resolve({
        request: built.request,
        now: input.now,
        engineDefaults: built.engineDefaults,
        fragment: {
            ...input.fragment,
            mode: input.fragmentMode ?? input.fragment.mode,
        },
        referencePolicy: 'strict',
        dedupePolicy: 'none',
        randomScope: `style-lab:${input.combination.id}`,
        workflowRuntimeOverride: built.workflowRuntimeOverride,
        transportDerivedOverride: built.transportDerivedOverride,
    })

    return {
        result,
        selectedRecipeId: built.selectedRecipeId,
        combination: built.combination,
    }
}
