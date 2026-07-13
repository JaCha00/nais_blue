// Compile-only fixtures. This module is intentionally not imported by runtime callers;
// root `tsc` includes it so the v2 contracts and negative type assertions stay executable.
import type {
    ActorRef,
    CharacterDefinition,
    CharacterPosition,
    CharacterSlotPatch,
    CompositionChangeSet,
    CompositionDocument,
    CompositionModule,
    CompositionProfile,
    CompositionRecipe,
    EntityId,
    OutputPolicy,
    ParamsOverride,
    ParamsPreset,
    PortablePathRef,
    PromptContribution,
    PromptTarget,
    ProvenanceRef,
    RandomRule,
    RandomTraceEntry,
    RecipeStep,
    ResolveRequest,
    ResolvedGenerationPlan,
    ResolutionIssue,
    ResourceBinding,
    ResourceRef,
    RevisionMeta,
} from './types'

export const typeFixtureEntityId: EntityId = 'entity:type-fixture'

export const typeFixtureActor = {
    kind: 'agent',
    id: 'actor:type-fixture',
    displayName: 'Type Fixture',
} satisfies ActorRef

export const typeFixtureRevision = {
    revision: 0,
    createdAt: '2026-07-11T00:00:00.000Z',
    createdBy: typeFixtureActor,
    updatedAt: '2026-07-11T00:00:00.000Z',
    updatedBy: typeFixtureActor,
} satisfies RevisionMeta

export const typeFixturePath = {
    kind: 'standard',
    root: 'pictures',
    segments: ['NAIS', 'Composition'],
} satisfies PortablePathRef

export const typeFixtureOutput = {
    destination: { kind: 'filesystem', directory: typeFixturePath },
    format: 'png',
    filenameTemplate: '{profile}_{seed}',
    metadataMode: 'embedded',
    collisionPolicy: 'unique',
} satisfies OutputPolicy

export const typeFixturePosition = {
    mode: 'manual',
    x: 0,
    y: 1,
} satisfies CharacterPosition

export const typeFixtureCharacter = {
    ...typeFixtureRevision,
    id: 'character:hero',
    orderKey: 'a0',
    name: 'Hero',
    enabled: false,
    positivePrompt: 'silver hair',
    negativePrompt: 'hat',
    position: typeFixturePosition,
    resourceBindings: [],
} satisfies CharacterDefinition

export const typeFixtureTarget = {
    kind: 'character',
    characterId: typeFixtureCharacter.id,
    polarity: 'positive',
} satisfies PromptTarget

export const typeFixtureWorkflowTarget = {
    kind: 'positive',
    slot: 'workflow',
} satisfies PromptTarget

export const typeFixtureProvenance = {
    kind: 'entity',
    entityKind: 'character',
    entityId: typeFixtureCharacter.id,
    revision: typeFixtureCharacter.revision,
} satisfies ProvenanceRef

export const typeFixtureContribution = {
    ...typeFixtureRevision,
    id: 'contribution:hero-positive',
    orderKey: 'a0',
    enabled: true,
    target: typeFixtureTarget,
    text: 'blue eyes',
    merge: 'append',
    separator: 'comma-space',
    weight: 0,
    provenance: [typeFixtureProvenance],
} satisfies PromptContribution

export const typeFixtureCharacterPatch = {
    characterId: typeFixtureCharacter.id,
    enabled: false,
    position: { mode: 'manual', x: 0, y: 0 },
    resourceBindings: [],
} satisfies CharacterSlotPatch

export const typeFixtureParams = {
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
    seedLocked: true,
    qualityToggle: false,
    ucPreset: 0,
    sourceMode: 'text-to-image',
    strength: 0,
    noise: 0,
    characterPositionEnabled: false,
} satisfies ParamsOverride

export const typeFixturePreset = {
    ...typeFixtureRevision,
    id: 'params-preset:default',
    orderKey: 'a0',
    name: 'Default',
    enabled: true,
    params: typeFixtureParams,
} satisfies ParamsPreset

export const typeFixtureResource = {
    ...typeFixtureRevision,
    id: 'resource-ref:hero',
    orderKey: 'a0',
    kind: 'managed',
    enabled: false,
    resourceId: 'managed-resource:hero',
    role: 'character-reference',
    mimeType: 'image/png',
} satisfies ResourceRef

export const typeFixtureResourceBinding = {
    resourceId: typeFixtureResource.id,
    enabled: false,
    referenceType: 'character&style',
    strength: 0,
    fidelity: 0,
    informationExtracted: 0,
} satisfies ResourceBinding

export const typeFixtureTrace = {
    ruleId: 'random-rule:prompt',
    streamKey: 'prompt.main',
    drawIndex: 0,
    seed: 0,
    result: 'blue eyes',
    selectedOptionIds: ['random-option:blue'],
    provenance: typeFixtureProvenance,
} satisfies RandomTraceEntry

export const typeFixtureRandomRule = {
    ...typeFixtureRevision,
    id: typeFixtureTrace.ruleId,
    orderKey: 'a0',
    kind: 'choice',
    enabled: true,
    streamKey: typeFixtureTrace.streamKey,
    scope: 'prompt-wildcard',
    source: { mode: 'replay', entries: [typeFixtureTrace] },
    options: [{ id: 'random-option:blue', orderKey: 'a0', value: 'blue eyes', weight: 1 }],
    pickCount: 1,
    withoutReplacement: true,
} satisfies RandomRule

export const typeFixtureModule = {
    ...typeFixtureRevision,
    id: 'module:hero',
    orderKey: 'a0',
    name: 'Hero prompt',
    enabled: true,
    kind: 'composite',
    contributions: [typeFixtureContribution],
    characterPatches: [typeFixtureCharacterPatch],
    paramsOverride: typeFixtureParams,
    outputPolicy: typeFixtureOutput,
    resourceBindings: [typeFixtureResourceBinding],
    randomRuleIds: [typeFixtureRandomRule.id],
} satisfies CompositionModule

export const typeFixtureStep = {
    ...typeFixtureRevision,
    id: 'recipe-step:hero',
    orderKey: 'a0',
    moduleId: typeFixtureModule.id,
    enabled: true,
    contributions: [],
    characterPatches: [],
    resourceBindings: [],
    randomRuleIds: [],
} satisfies RecipeStep

export const typeFixtureRecipe = {
    ...typeFixtureRevision,
    id: 'recipe:default',
    orderKey: 'a0',
    name: 'Default recipe',
    enabled: true,
    steps: [typeFixtureStep],
} satisfies CompositionRecipe

export const typeFixtureProfile = {
    ...typeFixtureRevision,
    id: 'profile:default',
    orderKey: 'a0',
    name: 'Default profile',
    enabled: true,
    moduleIds: [typeFixtureModule.id],
    recipeIds: [typeFixtureRecipe.id],
    characterIds: [typeFixtureCharacter.id],
    paramsPresetIds: [typeFixturePreset.id],
    resourceBindings: [typeFixtureResourceBinding],
    randomRuleIds: [typeFixtureRandomRule.id],
    defaultRecipeId: typeFixtureRecipe.id,
    defaultParamsPresetId: typeFixturePreset.id,
    contributions: [],
    characterPatches: [],
    paramsOverride: typeFixtureParams,
    outputPolicy: typeFixtureOutput,
} satisfies CompositionProfile

export const typeFixtureDocument = {
    ...typeFixtureRevision,
    schemaVersion: 2,
    id: 'composition-document:type-fixture',
    profiles: [typeFixtureProfile],
    modules: [typeFixtureModule],
    recipes: [typeFixtureRecipe],
    characters: [typeFixtureCharacter],
    paramsPresets: [typeFixturePreset],
    resources: [typeFixtureResource],
    randomRules: [typeFixtureRandomRule],
    activeProfileId: typeFixtureProfile.id,
    extensions: { future: { retained: true } },
} satisfies CompositionDocument

export const typeFixtureRequest = {
    schemaVersion: 2,
    requestId: 'resolve-request:type-fixture',
    requestedAt: '2026-07-11T00:00:00.000Z',
    requestedBy: typeFixtureActor,
    document: typeFixtureDocument,
    profileId: typeFixtureProfile.id,
    recipeId: typeFixtureRecipe.id,
    paramsPresetId: typeFixturePreset.id,
    contributions: [],
    characterPatches: [],
    paramsOverride: typeFixtureParams,
    outputPolicy: typeFixtureOutput,
    resourceBindings: [typeFixtureResourceBinding],
    randomSeed: 0,
} satisfies ResolveRequest

export const typeFixtureIssue = {
    code: 'W_PATH_CAPABILITY_FALLBACK',
    severity: 'warning',
    messageKey: 'composition.issue.pathCapabilityFallback',
    sourceRef: typeFixtureProvenance,
    entityRef: { kind: 'recipe', id: typeFixtureRecipe.id },
    fieldPath: ['recipes', 0],
    actionId: 'review-output-path',
    blocking: false,
} satisfies ResolutionIssue

export const typeFixturePlan = {
    schemaVersion: 2,
    planId: 'resolved-plan:type-fixture',
    requestId: typeFixtureRequest.requestId,
    documentId: typeFixtureDocument.id,
    documentRevision: typeFixtureDocument.revision,
    profileId: typeFixtureProfile.id,
    recipeId: typeFixtureRecipe.id,
    positivePrompt: 'silver hair, blue eyes',
    negativePrompt: 'hat',
    promptParts: {
        base: 'silver hair',
        inpainting: '',
        additional: 'blue eyes',
        workflow: '',
        detail: '',
        negative: 'hat',
    },
    contributions: [typeFixtureContribution],
    characters: [{
        characterId: typeFixtureCharacter.id,
        positive: 'silver hair, blue eyes',
        negative: 'hat',
        enabled: false,
        position: typeFixturePosition,
        resourceBindings: [],
    }],
    params: {
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
    },
    outputPolicy: typeFixtureOutput,
    resources: [typeFixtureResource],
    resourceBindings: [typeFixtureResourceBinding],
    issues: [typeFixtureIssue],
    provenance: [typeFixtureProvenance],
    randomTrace: [typeFixtureTrace],
} satisfies ResolvedGenerationPlan

export const typeFixtureChangeSet = {
    schemaVersion: 2,
    id: 'change-set:type-fixture',
    documentId: typeFixtureDocument.id,
    baseRevision: 0,
    revision: 1,
    updatedAt: '2026-07-11T00:01:00.000Z',
    updatedBy: typeFixtureActor,
    changes: [
        { kind: 'upsert-profile', value: typeFixtureProfile },
        {
            kind: 'tombstone',
            entityKind: 'module',
            entityId: typeFixtureModule.id,
            deletedAt: '2026-07-11T00:01:00.000Z',
        },
    ],
} satisfies CompositionChangeSet

// @ts-expect-error Character targets must use a stable characterId, never an array index.
export const invalidIndexedTarget: PromptTarget = { kind: 'character', index: 0, polarity: 'positive' }

// @ts-expect-error Legacy coordinate objects must choose an explicit position mode.
export const invalidLegacyPosition: CharacterPosition = { x: 0.5, y: 0.5 }

// @ts-expect-error Generation numeric fields are not string-coerced in the v2 domain.
export const invalidStringCfg: ParamsOverride = { cfgScale: '0' }

// @ts-expect-error updatedBy is an ActorRef, not the legacy plain string.
export const invalidStringActor: RevisionMeta = { ...typeFixtureRevision, updatedBy: 'agent' }
