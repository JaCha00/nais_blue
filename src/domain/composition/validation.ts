import type {
    CharacterSlotPatch,
    CharacterPosition,
    CompositionDocument,
    CompositionEntityKind,
    EntityId,
    Extensions,
    ParamsOverride,
    PromptContribution,
    ProvenanceRef,
    ResourceBinding,
    ResolutionIssue,
    ResolutionIssueCode,
    ResolutionIssueEntityRef,
} from './types'

export interface ResolutionIssueDefinition {
    severity: ResolutionIssue['severity']
    messageKey: string
    repairHintKey: string
    actionId: string
    blocking: boolean
}

/**
 * Stable, serialized issue contract. Message text is intentionally represented
 * by a key so that the pure domain layer has no locale or UI dependency.
 */
export const RESOLUTION_ISSUE_DEFINITIONS = {
    E_PROFILE_MISSING: {
        severity: 'error',
        messageKey: 'composition.issue.profileMissing',
        repairHintKey: 'composition.repair.selectProfile',
        actionId: 'select-profile',
        blocking: true,
    },
    E_RECIPE_MISSING: {
        severity: 'error',
        messageKey: 'composition.issue.recipeMissing',
        repairHintKey: 'composition.repair.selectRecipe',
        actionId: 'select-recipe',
        blocking: true,
    },
    E_MODULE_REF_MISSING: {
        severity: 'error',
        messageKey: 'composition.issue.moduleReferenceMissing',
        repairHintKey: 'composition.repair.repairModuleReference',
        actionId: 'repair-module-reference',
        blocking: true,
    },
    E_PARAMS_PRESET_MISSING: {
        severity: 'error',
        messageKey: 'composition.issue.paramsPresetMissing',
        repairHintKey: 'composition.repair.repairReference',
        actionId: 'repair-reference',
        blocking: true,
    },
    E_CHARACTER_REF_MISSING: {
        severity: 'error',
        messageKey: 'composition.issue.characterReferenceMissing',
        repairHintKey: 'composition.repair.repairReference',
        actionId: 'repair-reference',
        blocking: true,
    },
    E_RANDOM_RULE_REF_MISSING: {
        severity: 'error',
        messageKey: 'composition.issue.randomRuleReferenceMissing',
        repairHintKey: 'composition.repair.repairReference',
        actionId: 'repair-reference',
        blocking: true,
    },
    E_RESOURCE_REF_MISSING: {
        severity: 'error',
        messageKey: 'composition.issue.resourceReferenceMissing',
        repairHintKey: 'composition.repair.repairReference',
        actionId: 'repair-reference',
        blocking: true,
    },
    E_PARAM_OUT_OF_RANGE: {
        severity: 'error',
        messageKey: 'composition.issue.paramOutOfRange',
        repairHintKey: 'composition.repair.adjustParameter',
        actionId: 'adjust-parameter',
        blocking: true,
    },
    E_CHAR_POSITION_MODE_MIXED: {
        severity: 'error',
        messageKey: 'composition.issue.characterPositionModeMixed',
        repairHintKey: 'composition.repair.chooseCharacterPositionMode',
        actionId: 'choose-character-position-mode',
        blocking: true,
    },
    W_FRAGMENT_MISSING: {
        severity: 'warning',
        messageKey: 'composition.issue.fragmentMissing',
        repairHintKey: 'composition.repair.restoreFragment',
        actionId: 'restore-fragment',
        blocking: false,
    },
    W_MODULE_DISABLED: {
        severity: 'warning',
        messageKey: 'composition.issue.moduleDisabled',
        repairHintKey: 'composition.repair.enableModule',
        actionId: 'enable-module',
        blocking: false,
    },
    W_UNKNOWN_EXTENSION: {
        severity: 'warning',
        messageKey: 'composition.issue.unknownExtension',
        repairHintKey: 'composition.repair.reviewExtension',
        actionId: 'review-extension',
        blocking: false,
    },
    W_PAYLOAD_PARITY_UNVERIFIED_MODEL: {
        severity: 'warning',
        messageKey: 'composition.issue.payloadParityUnverifiedModel',
        repairHintKey: 'composition.repair.selectVerifiedModel',
        actionId: 'select-verified-model',
        blocking: false,
    },
    W_PATH_CAPABILITY_FALLBACK: {
        severity: 'warning',
        messageKey: 'composition.issue.pathCapabilityFallback',
        repairHintKey: 'composition.repair.reviewOutputPath',
        actionId: 'review-output-path',
        blocking: false,
    },
} as const satisfies Record<ResolutionIssueCode, ResolutionIssueDefinition>

export const RESOLUTION_ISSUE_CODE_ORDER = [
    'E_PROFILE_MISSING',
    'E_RECIPE_MISSING',
    'E_MODULE_REF_MISSING',
    'E_PARAMS_PRESET_MISSING',
    'E_CHARACTER_REF_MISSING',
    'E_RANDOM_RULE_REF_MISSING',
    'E_RESOURCE_REF_MISSING',
    'E_PARAM_OUT_OF_RANGE',
    'E_CHAR_POSITION_MODE_MIXED',
    'W_FRAGMENT_MISSING',
    'W_MODULE_DISABLED',
    'W_UNKNOWN_EXTENSION',
    'W_PAYLOAD_PARITY_UNVERIFIED_MODEL',
    'W_PATH_CAPABILITY_FALLBACK',
] as const satisfies readonly ResolutionIssueCode[]

export interface ResolutionIssueContext {
    sourceRef: ProvenanceRef
    entityRef?: ResolutionIssueEntityRef
    fieldPath?: readonly (string | number)[]
}

export interface CreateResolutionIssueInput extends ResolutionIssueContext {
    repairHintKey?: string
    actionId?: string
    extensions?: Extensions
}

/** Creates a serializable issue without embedding localized display text. */
export function createResolutionIssue(
    code: ResolutionIssueCode,
    input: CreateResolutionIssueInput,
): ResolutionIssue {
    const definition = RESOLUTION_ISSUE_DEFINITIONS[code]

    return {
        code,
        severity: definition.severity,
        messageKey: definition.messageKey,
        sourceRef: input.sourceRef,
        ...(input.entityRef === undefined ? {} : { entityRef: input.entityRef }),
        fieldPath: [...(input.fieldPath ?? [])],
        repairHintKey: input.repairHintKey ?? definition.repairHintKey,
        actionId: input.actionId ?? definition.actionId,
        blocking: definition.blocking,
        ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
    }
}

type NumericParamsField =
    | 'width'
    | 'height'
    | 'steps'
    | 'cfgScale'
    | 'cfgRescale'
    | 'seed'
    | 'ucPreset'
    | 'strength'
    | 'noise'

export interface NumericParamRange {
    minimum: number
    maximum?: number
    integer?: boolean
}

/**
 * Domain-level ranges only. Model/capability-specific maxima remain the final
 * clamp layer in precedence and are deliberately not encoded here.
 */
export const PARAM_RANGE_RULES = {
    width: { minimum: 1, integer: true },
    height: { minimum: 1, integer: true },
    steps: { minimum: 1, integer: true },
    cfgScale: { minimum: 0 },
    cfgRescale: { minimum: 0, maximum: 1 },
    seed: { minimum: 0, maximum: 0xffff_ffff, integer: true },
    ucPreset: { minimum: 0, integer: true },
    strength: { minimum: 0, maximum: 1 },
    noise: { minimum: 0, maximum: 1 },
} as const satisfies Record<NumericParamsField, NumericParamRange>

function isInRange(value: number, range: NumericParamRange): boolean {
    if (!Number.isFinite(value)) return false
    if (range.integer === true && !Number.isSafeInteger(value)) return false
    if (value < range.minimum) return false
    return range.maximum === undefined || value <= range.maximum
}

function appendFieldPath(
    context: ResolutionIssueContext,
    ...segments: readonly (string | number)[]
): Array<string | number> {
    return [...(context.fieldPath ?? []), ...segments]
}

function compareStableText(left: string, right: string): number {
    if (left < right) return -1
    if (left > right) return 1
    return 0
}

/**
 * Validates values that are model-independent. Explicit zero remains valid for
 * the fields whose range starts at zero.
 */
export function validateParamsRanges(
    params: Readonly<ParamsOverride>,
    context: ResolutionIssueContext,
): ResolutionIssue[] {
    const issues: ResolutionIssue[] = []

    for (const field of Object.keys(PARAM_RANGE_RULES) as NumericParamsField[]) {
        const value = params[field]
        if (value === undefined || isInRange(value, PARAM_RANGE_RULES[field])) continue

        issues.push(createResolutionIssue('E_PARAM_OUT_OF_RANGE', {
            ...context,
            fieldPath: appendFieldPath(context, field),
        }))
    }

    const hasWidth = params.width !== undefined
    const hasHeight = params.height !== undefined
    if (hasWidth !== hasHeight) {
        issues.push(createResolutionIssue('E_PARAM_OUT_OF_RANGE', {
            ...context,
            fieldPath: appendFieldPath(context, hasWidth ? 'height' : 'width'),
        }))
    }

    return issues
}

export interface CharacterPositionSubject {
    characterId: EntityId
    position: CharacterPosition
    enabled?: boolean
}

export interface CharacterPositionValidationInput extends ResolutionIssueContext {
    characters: readonly CharacterPositionSubject[]
    /** When supplied, it must agree with every enabled character position. */
    characterPositionEnabled?: boolean
}

/**
 * NovelAI exposes one coordinate-mode switch for the request. A request cannot
 * faithfully represent both AI-chosen and manual positions at the same time.
 */
export function validateCharacterPositionModes(
    input: CharacterPositionValidationInput,
): ResolutionIssue[] {
    const enabledCharacters = input.characters.filter(character => character.enabled !== false)
    const hasAiChoice = enabledCharacters.some(character => character.position.mode === 'ai-choice')
    const hasManual = enabledCharacters.some(character => character.position.mode === 'manual')
    const modesAreMixed = hasAiChoice && hasManual
    const flagConflicts = input.characterPositionEnabled === true
        ? hasAiChoice
        : input.characterPositionEnabled === false && hasManual

    if (!modesAreMixed && !flagConflicts) return []

    return [createResolutionIssue('E_CHAR_POSITION_MODE_MIXED', {
        sourceRef: input.sourceRef,
        ...(input.entityRef === undefined ? {} : { entityRef: input.entityRef }),
        fieldPath: appendFieldPath(input, 'position'),
    })]
}

export interface UnknownExtensionsValidationInput extends ResolutionIssueContext {
    extensions?: Readonly<Extensions>
    knownKeys?: readonly string[]
}

/** Unknown keys are preserved by schema, but remain inert and observable. */
export function validateUnknownExtensions(
    input: UnknownExtensionsValidationInput,
): ResolutionIssue[] {
    const knownKeys = new Set(input.knownKeys ?? [])

    return Object.keys(input.extensions ?? {})
        .filter(key => !knownKeys.has(key))
        .sort(compareStableText)
        .map(key => createResolutionIssue('W_UNKNOWN_EXTENSION', {
            sourceRef: input.sourceRef,
            ...(input.entityRef === undefined ? {} : { entityRef: input.entityRef }),
            fieldPath: appendFieldPath(input, key),
        }))
}

function entitySourceRef(
    entityKind: CompositionEntityKind,
    entity: { id: EntityId; revision: number },
): ProvenanceRef {
    return {
        kind: 'entity',
        entityKind,
        entityId: entity.id,
        revision: entity.revision,
    }
}

function entityRef(kind: CompositionEntityKind, id: EntityId): ResolutionIssueEntityRef {
    return { kind, id }
}

function activeById<T extends { id: EntityId; deletedAt?: string }>(items: readonly T[]): Map<EntityId, T> {
    return new Map(items.filter(item => item.deletedAt === undefined).map(item => [item.id, item]))
}

type BlockingReferenceIssueCode =
    | 'E_PROFILE_MISSING'
    | 'E_RECIPE_MISSING'
    | 'E_MODULE_REF_MISSING'
    | 'E_PARAMS_PRESET_MISSING'
    | 'E_CHARACTER_REF_MISSING'
    | 'E_RANDOM_RULE_REF_MISSING'
    | 'E_RESOURCE_REF_MISSING'

function missingReferenceIssue(
    code: BlockingReferenceIssueCode,
    context: ResolutionIssueContext,
    ...fieldPath: readonly (string | number)[]
): ResolutionIssue {
    return createResolutionIssue(code, {
        ...context,
        fieldPath,
    })
}

function validateResourceBindingReferences(
    bindings: readonly ResourceBinding[],
    resources: ReadonlyMap<EntityId, unknown>,
    context: ResolutionIssueContext,
    fieldPath: readonly (string | number)[],
): ResolutionIssue[] {
    return bindings.flatMap((binding, index) => (
        binding.enabled && !resources.has(binding.resourceId)
            ? [missingReferenceIssue(
                'E_RESOURCE_REF_MISSING',
                context,
                ...fieldPath,
                index,
                'resourceId',
            )]
            : []
    ))
}

function validateParamsResourceReferences(
    params: Readonly<ParamsOverride> | undefined,
    resources: ReadonlyMap<EntityId, unknown>,
    context: ResolutionIssueContext,
    fieldPath: readonly (string | number)[],
): ResolutionIssue[] {
    if (params === undefined) return []
    const issues: ResolutionIssue[] = []
    for (const field of ['sourceImageResourceId', 'maskResourceId'] as const) {
        const resourceId = params[field]
        if (resourceId !== undefined && !resources.has(resourceId)) {
            issues.push(missingReferenceIssue(
                'E_RESOURCE_REF_MISSING',
                context,
                ...fieldPath,
                field,
            ))
        }
    }
    return issues
}

function validateRandomRuleReferences(
    randomRuleIds: readonly EntityId[],
    randomRules: ReadonlyMap<EntityId, unknown>,
    context: ResolutionIssueContext,
    fieldPath: readonly (string | number)[],
): ResolutionIssue[] {
    return randomRuleIds.flatMap((randomRuleId, index) => (
        randomRules.has(randomRuleId)
            ? []
            : [missingReferenceIssue(
                'E_RANDOM_RULE_REF_MISSING',
                context,
                ...fieldPath,
                index,
            )]
    ))
}

function validateContributionReferences(
    contributions: readonly PromptContribution[],
    characters: ReadonlyMap<EntityId, unknown>,
    randomRules: ReadonlyMap<EntityId, unknown>,
    context: ResolutionIssueContext,
    fieldPath: readonly (string | number)[],
): ResolutionIssue[] {
    const issues = validateContributionCharacterReferences(
        contributions,
        characters,
        context,
        fieldPath,
    )
    contributions.forEach((contribution, index) => {
        if (contribution.deletedAt !== undefined || !contribution.enabled) return
        if (contribution.randomRuleId !== undefined
            && !randomRules.has(contribution.randomRuleId)) {
            issues.push(missingReferenceIssue(
                'E_RANDOM_RULE_REF_MISSING',
                context,
                ...fieldPath,
                index,
                'randomRuleId',
            ))
        }
    })
    return issues
}

function validateContributionCharacterReferences(
    contributions: readonly PromptContribution[],
    selectedCharacters: ReadonlyMap<EntityId, unknown>,
    context: ResolutionIssueContext,
    fieldPath: readonly (string | number)[],
): ResolutionIssue[] {
    return contributions.flatMap((contribution, index) => (
        contribution.deletedAt === undefined
        && contribution.enabled
        && contribution.target.kind === 'character'
        && !selectedCharacters.has(contribution.target.characterId)
            ? [missingReferenceIssue(
                'E_CHARACTER_REF_MISSING',
                context,
                ...fieldPath,
                index,
                'target',
                'characterId',
            )]
            : []
    ))
}

function validateCharacterPatchTargetReferences(
    patches: readonly CharacterSlotPatch[],
    selectedCharacters: ReadonlyMap<EntityId, unknown>,
    context: ResolutionIssueContext,
    fieldPath: readonly (string | number)[],
): ResolutionIssue[] {
    return patches.flatMap((patch, index) => (
        selectedCharacters.has(patch.characterId)
            ? []
            : [missingReferenceIssue(
                'E_CHARACTER_REF_MISSING',
                context,
                ...fieldPath,
                index,
                'characterId',
            )]
    ))
}

function validateCharacterPatchReferences(
    patches: readonly CharacterSlotPatch[],
    characters: ReadonlyMap<EntityId, unknown>,
    resources: ReadonlyMap<EntityId, unknown>,
    context: ResolutionIssueContext,
    fieldPath: readonly (string | number)[],
): ResolutionIssue[] {
    const issues = validateCharacterPatchTargetReferences(
        patches,
        characters,
        context,
        fieldPath,
    )
    patches.forEach((patch, index) => {
        issues.push(...validateResourceBindingReferences(
            patch.resourceBindings ?? [],
            resources,
            context,
            [...fieldPath, index, 'resourceBindings'],
        ))
    })
    return issues
}

const ISSUE_CODE_INDEX = new Map<ResolutionIssueCode, number>(
    RESOLUTION_ISSUE_CODE_ORDER.map((code, index) => [code, index]),
)

function provenanceSortKey(sourceRef: ProvenanceRef): string {
    switch (sourceRef.kind) {
        case 'entity':
            return `entity:${sourceRef.entityKind}:${sourceRef.entityId}:${sourceRef.revision}`
        case 'request':
            return `request:${sourceRef.requestId}`
        case 'external':
            return `external:${sourceRef.source}:${sourceRef.digest ?? ''}`
    }
}

/** Returns a new array in a deterministic order without mutating caller data. */
export function sortResolutionIssues(issues: readonly ResolutionIssue[]): ResolutionIssue[] {
    return [...issues].sort((left, right) => {
        const codeDifference = (ISSUE_CODE_INDEX.get(left.code) ?? Number.MAX_SAFE_INTEGER)
            - (ISSUE_CODE_INDEX.get(right.code) ?? Number.MAX_SAFE_INTEGER)
        if (codeDifference !== 0) return codeDifference

        const sourceDifference = compareStableText(
            provenanceSortKey(left.sourceRef),
            provenanceSortKey(right.sourceRef),
        )
        if (sourceDifference !== 0) return sourceDifference

        const entityDifference = compareStableText(
            `${left.entityRef?.kind ?? ''}:${left.entityRef?.id ?? ''}`,
            `${right.entityRef?.kind ?? ''}:${right.entityRef?.id ?? ''}`,
        )
        if (entityDifference !== 0) return entityDifference

        return compareStableText(JSON.stringify(left.fieldPath), JSON.stringify(right.fieldPath))
    })
}

/**
 * Performs document-level semantic checks that runtime shape validation cannot:
 * reference existence, disabled referenced modules, and portable param ranges.
 */
export function validateCompositionSemantics(document: Readonly<CompositionDocument>): ResolutionIssue[] {
    const issues: ResolutionIssue[] = []
    const profiles = activeById(document.profiles)
    const recipes = activeById(document.recipes)
    const modules = activeById(document.modules)
    const characters = activeById(document.characters)
    const paramsPresets = activeById(document.paramsPresets)
    const resources = activeById(document.resources)
    const randomRules = activeById(document.randomRules)

    if (document.activeProfileId !== undefined) {
        const activeProfile = profiles.get(document.activeProfileId)
        if (activeProfile === undefined || !activeProfile.enabled) {
            issues.push(createResolutionIssue('E_PROFILE_MISSING', {
                sourceRef: {
                    kind: 'external',
                    source: 'composition-document',
                    digest: document.id,
                },
                fieldPath: ['activeProfileId'],
            }))
        }
    }

    document.profiles.forEach((profile, profileIndex) => {
        if (profile.deletedAt !== undefined || !profile.enabled) return

        const sourceRef = entitySourceRef('profile', profile)
        const sourceEntityRef = entityRef('profile', profile.id)
        const context = { sourceRef, entityRef: sourceEntityRef } satisfies ResolutionIssueContext

        profile.recipeIds.forEach((recipeId, recipeIndex) => {
            if (!recipes.has(recipeId)) {
                issues.push(missingReferenceIssue(
                    'E_RECIPE_MISSING',
                    context,
                    'profiles',
                    profileIndex,
                    'recipeIds',
                    recipeIndex,
                ))
            }
        })
        if (profile.defaultRecipeId !== undefined) {
            const defaultRecipe = recipes.get(profile.defaultRecipeId)
            if (defaultRecipe === undefined
                || !defaultRecipe.enabled
                || !profile.recipeIds.includes(defaultRecipe.id)) {
                issues.push(missingReferenceIssue(
                    'E_RECIPE_MISSING',
                    context,
                    'profiles',
                    profileIndex,
                    'defaultRecipeId',
                ))
            }
        }

        profile.moduleIds.forEach((moduleId, moduleIndex) => {
            const module = modules.get(moduleId)
            const moduleContext = {
                sourceRef,
                entityRef: sourceEntityRef,
                fieldPath: ['profiles', profileIndex, 'moduleIds', moduleIndex],
            } satisfies ResolutionIssueContext

            if (module === undefined) {
                issues.push(createResolutionIssue('E_MODULE_REF_MISSING', moduleContext))
            } else if (!module.enabled) {
                issues.push(createResolutionIssue('W_MODULE_DISABLED', moduleContext))
            }
        })

        profile.characterIds.forEach((characterId, characterIndex) => {
            if (!characters.has(characterId)) {
                issues.push(missingReferenceIssue(
                    'E_CHARACTER_REF_MISSING',
                    context,
                    'profiles',
                    profileIndex,
                    'characterIds',
                    characterIndex,
                ))
            }
        })
        profile.paramsPresetIds.forEach((presetId, presetIndex) => {
            if (!paramsPresets.has(presetId)) {
                issues.push(missingReferenceIssue(
                    'E_PARAMS_PRESET_MISSING',
                    context,
                    'profiles',
                    profileIndex,
                    'paramsPresetIds',
                    presetIndex,
                ))
            }
        })
        if (profile.defaultParamsPresetId !== undefined) {
            const defaultPreset = paramsPresets.get(profile.defaultParamsPresetId)
            if (defaultPreset === undefined
                || !defaultPreset.enabled
                || !profile.paramsPresetIds.includes(defaultPreset.id)) {
                issues.push(missingReferenceIssue(
                    'E_PARAMS_PRESET_MISSING',
                    context,
                    'profiles',
                    profileIndex,
                    'defaultParamsPresetId',
                ))
            }
        }

        issues.push(...validateResourceBindingReferences(
            profile.resourceBindings,
            resources,
            context,
            ['profiles', profileIndex, 'resourceBindings'],
        ))
        issues.push(...validateRandomRuleReferences(
            profile.randomRuleIds,
            randomRules,
            context,
            ['profiles', profileIndex, 'randomRuleIds'],
        ))
        const selectedCharacters = new Map(
            profile.characterIds.flatMap(characterId => {
                const character = characters.get(characterId)
                return character === undefined ? [] : [[characterId, character] as const]
            }),
        )
        issues.push(...validateContributionReferences(
            profile.contributions,
            selectedCharacters,
            randomRules,
            context,
            ['profiles', profileIndex, 'contributions'],
        ))
        issues.push(...validateCharacterPatchReferences(
            profile.characterPatches,
            selectedCharacters,
            resources,
            context,
            ['profiles', profileIndex, 'characterPatches'],
        ))

        const validateSelectedCharacterOwners = (
            contributions: readonly PromptContribution[],
            patches: readonly CharacterSlotPatch[],
            fieldPath: readonly (string | number)[],
        ): void => {
            issues.push(...validateContributionCharacterReferences(
                contributions,
                selectedCharacters,
                context,
                [...fieldPath, 'contributions'],
            ))
            issues.push(...validateCharacterPatchTargetReferences(
                patches,
                selectedCharacters,
                context,
                [...fieldPath, 'characterPatches'],
            ))
        }
        profile.moduleIds.forEach((moduleId, moduleIndex) => {
            const module = modules.get(moduleId)
            if (module === undefined || !module.enabled) return
            validateSelectedCharacterOwners(
                module.contributions,
                module.characterPatches,
                ['profiles', profileIndex, 'moduleIds', moduleIndex],
            )
        })
        profile.recipeIds.forEach((recipeId, recipeReferenceIndex) => {
            const recipe = recipes.get(recipeId)
            if (recipe === undefined || !recipe.enabled) return
            recipe.steps.forEach((step, stepIndex) => {
                if (step.deletedAt !== undefined || !step.enabled) return
                const module = modules.get(step.moduleId)
                if (module === undefined || !module.enabled) return
                const stepPath = [
                    'profiles',
                    profileIndex,
                    'recipeIds',
                    recipeReferenceIndex,
                    'steps',
                    stepIndex,
                ] as const
                validateSelectedCharacterOwners(
                    step.contributions,
                    step.characterPatches,
                    stepPath,
                )
                validateSelectedCharacterOwners(
                    module.contributions,
                    module.characterPatches,
                    [...stepPath, 'module'],
                )
            })
        })

        if (profile.paramsOverride !== undefined) {
            const paramsContext = {
                ...context,
                fieldPath: ['profiles', profileIndex, 'paramsOverride'],
            } satisfies ResolutionIssueContext
            issues.push(...validateParamsRanges(profile.paramsOverride, paramsContext))
            issues.push(...validateParamsResourceReferences(
                profile.paramsOverride,
                resources,
                context,
                ['profiles', profileIndex, 'paramsOverride'],
            ))
        }
    })

    document.modules.forEach((module, moduleIndex) => {
        if (module.deletedAt !== undefined || !module.enabled) return
        const context = {
            sourceRef: entitySourceRef('module', module),
            entityRef: entityRef('module', module.id),
        } satisfies ResolutionIssueContext
        issues.push(...validateContributionReferences(
            module.contributions,
            characters,
            randomRules,
            context,
            ['modules', moduleIndex, 'contributions'],
        ))
        issues.push(...validateCharacterPatchReferences(
            module.characterPatches,
            characters,
            resources,
            context,
            ['modules', moduleIndex, 'characterPatches'],
        ))
        issues.push(...validateResourceBindingReferences(
            module.resourceBindings,
            resources,
            context,
            ['modules', moduleIndex, 'resourceBindings'],
        ))
        issues.push(...validateRandomRuleReferences(
            module.randomRuleIds,
            randomRules,
            context,
            ['modules', moduleIndex, 'randomRuleIds'],
        ))
        if (module.paramsOverride !== undefined) {
            issues.push(...validateParamsRanges(module.paramsOverride, {
                ...context,
                fieldPath: ['modules', moduleIndex, 'paramsOverride'],
            }))
            issues.push(...validateParamsResourceReferences(
                module.paramsOverride,
                resources,
                context,
                ['modules', moduleIndex, 'paramsOverride'],
            ))
        }
    })

    document.recipes.forEach((recipe, recipeIndex) => {
        if (recipe.deletedAt !== undefined || !recipe.enabled) return
        const recipeSourceRef = entitySourceRef('recipe', recipe)
        const recipeEntityRef = entityRef('recipe', recipe.id)

        if (recipe.paramsOverride !== undefined) {
            issues.push(...validateParamsRanges(recipe.paramsOverride, {
                sourceRef: recipeSourceRef,
                entityRef: recipeEntityRef,
                fieldPath: ['recipes', recipeIndex, 'paramsOverride'],
            }))
            issues.push(...validateParamsResourceReferences(
                recipe.paramsOverride,
                resources,
                { sourceRef: recipeSourceRef, entityRef: recipeEntityRef },
                ['recipes', recipeIndex, 'paramsOverride'],
            ))
        }

        recipe.steps.forEach((step, stepIndex) => {
            if (step.deletedAt !== undefined || !step.enabled) return
            const module = modules.get(step.moduleId)
            const stepSourceRef = entitySourceRef('recipe-step', step)
            const stepEntityRef = entityRef('recipe-step', step.id)
            const moduleContext = {
                sourceRef: stepSourceRef,
                entityRef: stepEntityRef,
                fieldPath: ['recipes', recipeIndex, 'steps', stepIndex, 'moduleId'],
            } satisfies ResolutionIssueContext

            if (module === undefined) {
                issues.push(createResolutionIssue('E_MODULE_REF_MISSING', moduleContext))
            } else if (!module.enabled) {
                issues.push(createResolutionIssue('W_MODULE_DISABLED', moduleContext))
            }

            if (step.paramsOverride !== undefined) {
                issues.push(...validateParamsRanges(step.paramsOverride, {
                    sourceRef: stepSourceRef,
                    entityRef: stepEntityRef,
                    fieldPath: ['recipes', recipeIndex, 'steps', stepIndex, 'paramsOverride'],
                }))
                issues.push(...validateParamsResourceReferences(
                    step.paramsOverride,
                    resources,
                    { sourceRef: stepSourceRef, entityRef: stepEntityRef },
                    ['recipes', recipeIndex, 'steps', stepIndex, 'paramsOverride'],
                ))
            }
            const stepContext = {
                sourceRef: stepSourceRef,
                entityRef: stepEntityRef,
            } satisfies ResolutionIssueContext
            issues.push(...validateContributionReferences(
                step.contributions,
                characters,
                randomRules,
                stepContext,
                ['recipes', recipeIndex, 'steps', stepIndex, 'contributions'],
            ))
            issues.push(...validateCharacterPatchReferences(
                step.characterPatches,
                characters,
                resources,
                stepContext,
                ['recipes', recipeIndex, 'steps', stepIndex, 'characterPatches'],
            ))
            issues.push(...validateResourceBindingReferences(
                step.resourceBindings,
                resources,
                stepContext,
                ['recipes', recipeIndex, 'steps', stepIndex, 'resourceBindings'],
            ))
            issues.push(...validateRandomRuleReferences(
                step.randomRuleIds,
                randomRules,
                stepContext,
                ['recipes', recipeIndex, 'steps', stepIndex, 'randomRuleIds'],
            ))
        })
    })

    document.characters.forEach((character, characterIndex) => {
        if (character.deletedAt !== undefined || !character.enabled) return
        issues.push(...validateResourceBindingReferences(
            character.resourceBindings,
            resources,
            {
                sourceRef: entitySourceRef('character', character),
                entityRef: entityRef('character', character.id),
            },
            ['characters', characterIndex, 'resourceBindings'],
        ))
    })

    document.paramsPresets.forEach((preset, presetIndex) => {
        if (preset.deletedAt !== undefined || !preset.enabled) return
        const context = {
            sourceRef: entitySourceRef('params-preset', preset),
            entityRef: entityRef('params-preset', preset.id),
        } satisfies ResolutionIssueContext
        issues.push(...validateParamsRanges(preset.params, {
            ...context,
            fieldPath: ['paramsPresets', presetIndex, 'params'],
        }))
        issues.push(...validateParamsResourceReferences(
            preset.params,
            resources,
            context,
            ['paramsPresets', presetIndex, 'params'],
        ))
    })

    return sortResolutionIssues(issues)
}
