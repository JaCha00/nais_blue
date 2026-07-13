import { canonicalSerialize } from './canonical-serialize'
import { safeParseCompositionDocument, type CompositionSchemaIssue } from './schema'
import type {
    ActorRef,
    CompositionChange,
    CompositionChangeSet,
    CompositionDocument,
    CompositionEntityKind,
    JsonValue,
    PromptContribution,
    RecipeStep,
    RevisionedEntity,
    ResolutionIssue,
} from './types'
import { validateCompositionSemantics } from './validation'

export type CompositionAuthoringErrorCode =
    | 'E_CHANGESET_DOCUMENT_MISMATCH'
    | 'E_CHANGESET_REVISION_INVALID'
    | 'E_CHANGESET_TARGET_MISSING'
    | 'E_CHANGESET_VALIDATION_FAILED'

export class CompositionAuthoringError extends Error {
    constructor(
        readonly code: CompositionAuthoringErrorCode,
        message: string,
        readonly validation?: CompositionAuthoringValidation,
    ) {
        super(message)
        this.name = 'CompositionAuthoringError'
    }
}

export interface CompositionAuthoringValidation {
    valid: boolean
    schemaIssues: readonly CompositionSchemaIssue[]
    semanticIssues: readonly ResolutionIssue[]
    blockingIssues: readonly ResolutionIssue[]
}

export interface CreateCompositionChangeSetInput {
    document: Readonly<CompositionDocument>
    id: string
    updatedAt: string
    updatedBy: ActorRef
    changes: readonly CompositionChange[]
}

export interface CompositionAuthoringApplyResult {
    document: CompositionDocument
    validation: CompositionAuthoringValidation
    inverseChangeSet: CompositionChangeSet
}

export type CompositionMergePath = readonly (string | number)[]

export interface CompositionMergeResolution {
    path: CompositionMergePath
    choice: 'local' | 'external'
}

export interface CompositionMergeConflict {
    path: CompositionMergePath
    base?: JsonValue
    local?: JsonValue
    external?: JsonValue
    basePresent: boolean
    localPresent: boolean
    externalPresent: boolean
    resolution: 'unresolved' | 'local' | 'external'
}

export interface MergeCompositionDocumentsInput {
    base: Readonly<CompositionDocument>
    local: Readonly<CompositionDocument>
    external: Readonly<CompositionDocument>
    resolutions?: readonly CompositionMergeResolution[]
}

export interface CompositionMergeResult {
    document: CompositionDocument | null
    value: unknown
    conflicts: readonly CompositionMergeConflict[]
    validation: CompositionAuthoringValidation
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

export function createCompositionChangeSet(input: CreateCompositionChangeSetInput): CompositionChangeSet {
    return {
        schemaVersion: input.document.schemaVersion,
        id: input.id,
        documentId: input.document.id,
        baseRevision: input.document.revision,
        revision: input.document.revision + 1,
        updatedAt: input.updatedAt,
        updatedBy: clone(input.updatedBy),
        changes: clone([...input.changes]),
    }
}

export function validateCompositionAuthoringDocument(value: unknown): CompositionAuthoringValidation {
    const parsed = safeParseCompositionDocument(value)
    if (!parsed.success) {
        return {
            valid: false,
            schemaIssues: parsed.issues,
            semanticIssues: [],
            blockingIssues: [],
        }
    }

    const semanticIssues = validateCompositionSemantics(parsed.data)
    const blockingIssues = semanticIssues.filter(issue => issue.blocking)
    return {
        valid: blockingIssues.length === 0,
        schemaIssues: [],
        semanticIssues,
        blockingIssues,
    }
}

function stampedEntity<T extends RevisionedEntity>(
    value: T,
    previous: T | undefined,
    changeSet: CompositionChangeSet,
): T {
    return {
        ...clone(value),
        revision: previous === undefined ? 0 : previous.revision + 1,
        createdAt: previous?.createdAt ?? changeSet.updatedAt,
        createdBy: clone(previous?.createdBy ?? changeSet.updatedBy),
        updatedAt: changeSet.updatedAt,
        updatedBy: clone(changeSet.updatedBy),
    }
}

function upsertEntity<T extends RevisionedEntity>(
    collection: readonly T[],
    value: T,
    changeSet: CompositionChangeSet,
): { collection: T[]; previous?: T; current: T } {
    const index = collection.findIndex(entity => entity.id === value.id)
    const previous = index < 0 ? undefined : collection[index]
    const current = stampedEntity(value, previous, changeSet)
    const next = collection.map(clone)
    if (index < 0) next.push(current)
    else next[index] = current
    return { collection: next, ...(previous === undefined ? {} : { previous: clone(previous) }), current }
}

function inverseForUpsert<T extends RevisionedEntity>(
    kind: CompositionChange['kind'],
    current: T,
    previous: T | undefined,
    changeSet: CompositionChangeSet,
): CompositionChange {
    if (previous === undefined) {
        const entityKind = kind.slice('upsert-'.length) as CompositionEntityKind
        return {
            kind: 'tombstone',
            entityKind,
            entityId: current.id,
            deletedAt: changeSet.updatedAt,
        }
    }
    return { kind, value: previous } as unknown as CompositionChange
}

function tombstoneTopLevel<T extends RevisionedEntity>(
    collection: readonly T[],
    entityId: string,
    changeSet: CompositionChangeSet,
    deletedAt: string,
): { collection: T[]; previous: T } {
    const index = collection.findIndex(entity => entity.id === entityId)
    if (index < 0) {
        throw new CompositionAuthoringError(
            'E_CHANGESET_TARGET_MISSING',
            `Cannot tombstone missing entity ${entityId}`,
        )
    }
    const previous = clone(collection[index])
    const current = stampedEntity({ ...previous, deletedAt }, previous, changeSet)
    const next = collection.map(clone)
    next[index] = current
    return { collection: next, previous }
}

function tombstoneRecipeStep(
    document: CompositionDocument,
    entityId: string,
    parentId: string | undefined,
    changeSet: CompositionChangeSet,
    deletedAt: string,
): RecipeStep {
    for (let recipeIndex = 0; recipeIndex < document.recipes.length; recipeIndex += 1) {
        const recipe = document.recipes[recipeIndex]
        if (parentId !== undefined && recipe.id !== parentId) continue
        const stepIndex = recipe.steps.findIndex(step => step.id === entityId)
        if (stepIndex < 0) continue
        const previous = clone(recipe.steps[stepIndex])
        const steps = recipe.steps.map(clone)
        steps[stepIndex] = stampedEntity({ ...previous, deletedAt }, previous, changeSet)
        document.recipes[recipeIndex] = stampedEntity({ ...recipe, steps }, recipe, changeSet)
        return previous
    }
    throw new CompositionAuthoringError(
        'E_CHANGESET_TARGET_MISSING',
        `Cannot tombstone missing recipe step ${entityId}`,
    )
}

interface ContributionOwner {
    parentId: string
    contributions: PromptContribution[]
    replace: (contributions: PromptContribution[]) => void
}

function contributionOwners(document: CompositionDocument, changeSet: CompositionChangeSet): ContributionOwner[] {
    const owners: ContributionOwner[] = []
    document.profiles.forEach((profile, index) => owners.push({
        parentId: profile.id,
        contributions: profile.contributions,
        replace: contributions => {
            document.profiles[index] = stampedEntity({ ...profile, contributions }, profile, changeSet)
        },
    }))
    document.modules.forEach((module, index) => owners.push({
        parentId: module.id,
        contributions: module.contributions,
        replace: contributions => {
            document.modules[index] = stampedEntity({ ...module, contributions }, module, changeSet)
        },
    }))
    document.recipes.forEach((recipe, recipeIndex) => recipe.steps.forEach((step, stepIndex) => owners.push({
        parentId: step.id,
        contributions: step.contributions,
        replace: contributions => {
            const currentRecipe = document.recipes[recipeIndex]
            const steps = currentRecipe.steps.map(clone)
            steps[stepIndex] = stampedEntity({ ...step, contributions }, step, changeSet)
            document.recipes[recipeIndex] = stampedEntity({ ...currentRecipe, steps }, currentRecipe, changeSet)
        },
    })))
    return owners
}

function tombstonePromptContribution(
    document: CompositionDocument,
    entityId: string,
    parentId: string | undefined,
    changeSet: CompositionChangeSet,
    deletedAt: string,
): PromptContribution {
    for (const owner of contributionOwners(document, changeSet)) {
        if (parentId !== undefined && owner.parentId !== parentId) continue
        const index = owner.contributions.findIndex(contribution => contribution.id === entityId)
        if (index < 0) continue
        const previous = clone(owner.contributions[index])
        const contributions = owner.contributions.map(clone)
        contributions[index] = stampedEntity({ ...previous, deletedAt }, previous, changeSet)
        owner.replace(contributions)
        return previous
    }
    throw new CompositionAuthoringError(
        'E_CHANGESET_TARGET_MISSING',
        `Cannot tombstone missing prompt contribution ${entityId}`,
    )
}

function applyTombstone(
    document: CompositionDocument,
    change: Extract<CompositionChange, { kind: 'tombstone' }>,
    changeSet: CompositionChangeSet,
): CompositionChange {
    const inverse = (value: RevisionedEntity, kind: CompositionChange['kind']): CompositionChange => (
        { kind, value } as unknown as CompositionChange
    )
    switch (change.entityKind) {
        case 'profile': {
            const result = tombstoneTopLevel(document.profiles, change.entityId, changeSet, change.deletedAt)
            document.profiles = result.collection
            return inverse(result.previous, 'upsert-profile')
        }
        case 'module': {
            const result = tombstoneTopLevel(document.modules, change.entityId, changeSet, change.deletedAt)
            document.modules = result.collection
            return inverse(result.previous, 'upsert-module')
        }
        case 'recipe': {
            const result = tombstoneTopLevel(document.recipes, change.entityId, changeSet, change.deletedAt)
            document.recipes = result.collection
            return inverse(result.previous, 'upsert-recipe')
        }
        case 'character': {
            const result = tombstoneTopLevel(document.characters, change.entityId, changeSet, change.deletedAt)
            document.characters = result.collection
            return inverse(result.previous, 'upsert-character')
        }
        case 'params-preset': {
            const result = tombstoneTopLevel(document.paramsPresets, change.entityId, changeSet, change.deletedAt)
            document.paramsPresets = result.collection
            return inverse(result.previous, 'upsert-params-preset')
        }
        case 'resource': {
            const result = tombstoneTopLevel(document.resources, change.entityId, changeSet, change.deletedAt)
            document.resources = result.collection
            return inverse(result.previous, 'upsert-resource')
        }
        case 'random-rule': {
            const result = tombstoneTopLevel(document.randomRules, change.entityId, changeSet, change.deletedAt)
            document.randomRules = result.collection
            return inverse(result.previous, 'upsert-random-rule')
        }
        case 'recipe-step': {
            const previous = tombstoneRecipeStep(
                document,
                change.entityId,
                change.parentId,
                changeSet,
                change.deletedAt,
            )
            const recipe = document.recipes.find(candidate => candidate.steps.some(step => step.id === change.entityId))
            if (recipe === undefined) throw new Error('Tombstoned recipe step owner disappeared')
            return { kind: 'upsert-recipe', value: { ...recipe, steps: recipe.steps.map(step => (
                step.id === previous.id ? previous : step
            )) } }
        }
        case 'prompt-contribution': {
            const previous = tombstonePromptContribution(
                document,
                change.entityId,
                change.parentId,
                changeSet,
                change.deletedAt,
            )
            const ownerRecipe = document.recipes.find(recipe => recipe.steps.some(step => (
                step.id === change.parentId || step.contributions.some(item => item.id === change.entityId)
            )))
            if (ownerRecipe !== undefined) {
                return { kind: 'upsert-recipe', value: {
                    ...ownerRecipe,
                    steps: ownerRecipe.steps.map(step => ({
                        ...step,
                        contributions: step.contributions.map(item => item.id === previous.id ? previous : item),
                    })),
                } }
            }
            const ownerModule = document.modules.find(module => module.contributions.some(item => item.id === change.entityId))
            if (ownerModule !== undefined) {
                return { kind: 'upsert-module', value: {
                    ...ownerModule,
                    contributions: ownerModule.contributions.map(item => item.id === previous.id ? previous : item),
                } }
            }
            const ownerProfile = document.profiles.find(profile => profile.contributions.some(item => item.id === change.entityId))
            if (ownerProfile !== undefined) {
                return { kind: 'upsert-profile', value: {
                    ...ownerProfile,
                    contributions: ownerProfile.contributions.map(item => item.id === previous.id ? previous : item),
                } }
            }
            throw new Error('Tombstoned contribution owner disappeared')
        }
    }
}

export function applyCompositionChangeSet(
    source: Readonly<CompositionDocument>,
    changeSet: Readonly<CompositionChangeSet>,
): CompositionAuthoringApplyResult {
    if (source.id !== changeSet.documentId || source.schemaVersion !== changeSet.schemaVersion) {
        throw new CompositionAuthoringError(
            'E_CHANGESET_DOCUMENT_MISMATCH',
            `Change set ${changeSet.id} does not target document ${source.id}`,
        )
    }
    if (source.revision !== changeSet.baseRevision || changeSet.revision !== changeSet.baseRevision + 1) {
        throw new CompositionAuthoringError(
            'E_CHANGESET_REVISION_INVALID',
            `Change set ${changeSet.id} expected document revision ${changeSet.baseRevision}; current revision is ${source.revision}`,
        )
    }

    const document = clone(source) as CompositionDocument
    const inverseChanges: CompositionChange[] = []
    for (const change of changeSet.changes) {
        switch (change.kind) {
            case 'upsert-profile': {
                const result = upsertEntity(document.profiles, change.value, changeSet)
                document.profiles = result.collection
                inverseChanges.unshift(inverseForUpsert(change.kind, result.current, result.previous, changeSet))
                break
            }
            case 'upsert-module': {
                const result = upsertEntity(document.modules, change.value, changeSet)
                document.modules = result.collection
                inverseChanges.unshift(inverseForUpsert(change.kind, result.current, result.previous, changeSet))
                break
            }
            case 'upsert-recipe': {
                const result = upsertEntity(document.recipes, change.value, changeSet)
                document.recipes = result.collection
                inverseChanges.unshift(inverseForUpsert(change.kind, result.current, result.previous, changeSet))
                break
            }
            case 'upsert-character': {
                const result = upsertEntity(document.characters, change.value, changeSet)
                document.characters = result.collection
                inverseChanges.unshift(inverseForUpsert(change.kind, result.current, result.previous, changeSet))
                break
            }
            case 'upsert-params-preset': {
                const result = upsertEntity(document.paramsPresets, change.value, changeSet)
                document.paramsPresets = result.collection
                inverseChanges.unshift(inverseForUpsert(change.kind, result.current, result.previous, changeSet))
                break
            }
            case 'upsert-resource': {
                const result = upsertEntity(document.resources, change.value, changeSet)
                document.resources = result.collection
                inverseChanges.unshift(inverseForUpsert(change.kind, result.current, result.previous, changeSet))
                break
            }
            case 'upsert-random-rule': {
                const result = upsertEntity(document.randomRules, change.value, changeSet)
                document.randomRules = result.collection
                inverseChanges.unshift(inverseForUpsert(change.kind, result.current, result.previous, changeSet))
                break
            }
            case 'tombstone':
                inverseChanges.unshift(applyTombstone(document, change, changeSet))
                break
        }
    }

    document.revision = changeSet.revision
    document.updatedAt = changeSet.updatedAt
    document.updatedBy = clone(changeSet.updatedBy)
    const validation = validateCompositionAuthoringDocument(document)
    if (!validation.valid) {
        throw new CompositionAuthoringError(
            'E_CHANGESET_VALIDATION_FAILED',
            `Change set ${changeSet.id} produced an invalid composition document`,
            validation,
        )
    }
    const parsed = safeParseCompositionDocument(document)
    if (!parsed.success) throw new Error('Validated composition document unexpectedly failed schema parsing')

    return {
        document: parsed.data,
        validation,
        inverseChangeSet: {
            schemaVersion: changeSet.schemaVersion,
            id: `undo:${changeSet.id}`,
            documentId: changeSet.documentId,
            baseRevision: changeSet.revision,
            revision: changeSet.revision + 1,
            updatedAt: changeSet.updatedAt,
            updatedBy: clone(changeSet.updatedBy),
            changes: inverseChanges,
        },
    }
}

const MISSING = Symbol('composition-merge-missing')
type MergeValue = JsonValue | typeof MISSING

function isRecord(value: MergeValue): value is { [key: string]: JsonValue } {
    return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function equalValue(left: MergeValue, right: MergeValue): boolean {
    if (left === MISSING || right === MISSING) return left === right
    return canonicalSerialize(left) === canonicalSerialize(right)
}

function asConflictValue(value: MergeValue): JsonValue | undefined {
    return value === MISSING ? undefined : clone(value)
}

function entityArray(value: MergeValue): value is Array<{ id: string; [key: string]: JsonValue }> {
    return Array.isArray(value) && value.every(item => (
        isRecord(item) && typeof item.id === 'string' && item.id.length > 0
    ))
}

function resolutionKey(path: CompositionMergePath): string {
    return canonicalSerialize(path)
}

function mergeValue(
    base: MergeValue,
    local: MergeValue,
    external: MergeValue,
    path: readonly (string | number)[],
    resolutions: ReadonlyMap<string, 'local' | 'external'>,
    conflicts: CompositionMergeConflict[],
): MergeValue {
    if (equalValue(local, external)) return cloneMergeValue(local)
    if (equalValue(local, base)) return cloneMergeValue(external)
    if (equalValue(external, base)) return cloneMergeValue(local)

    const field = path[path.length - 1]
    if (field === 'revision' || field === 'updatedAt' || field === 'updatedBy') {
        return cloneMergeValue(external === MISSING ? local : external)
    }

    if (isRecord(base) && isRecord(local) && isRecord(external)) {
        const result: { [key: string]: JsonValue } = {}
        const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(external)])
        for (const key of [...keys].sort()) {
            const merged = mergeValue(
                Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
                Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING,
                Object.prototype.hasOwnProperty.call(external, key) ? external[key] : MISSING,
                [...path, key],
                resolutions,
                conflicts,
            )
            if (merged !== MISSING) result[key] = merged
        }
        return result
    }

    if (entityArray(base) && entityArray(local) && entityArray(external)) {
        const baseMap = new Map(base.map(item => [item.id, item]))
        const localMap = new Map(local.map(item => [item.id, item]))
        const externalMap = new Map(external.map(item => [item.id, item]))
        const ids = [
            ...base.map(item => item.id),
            ...local.map(item => item.id),
            ...external.map(item => item.id),
        ].filter((id, index, all) => all.indexOf(id) === index)
        const result: JsonValue[] = []
        for (const id of ids) {
            const merged = mergeValue(
                baseMap.get(id) ?? MISSING,
                localMap.get(id) ?? MISSING,
                externalMap.get(id) ?? MISSING,
                [...path, id],
                resolutions,
                conflicts,
            )
            if (merged !== MISSING) result.push(merged)
        }
        return result
    }

    const choice = resolutions.get(resolutionKey(path))
    conflicts.push({
        path: [...path],
        ...(base === MISSING ? {} : { base: asConflictValue(base) }),
        ...(local === MISSING ? {} : { local: asConflictValue(local) }),
        ...(external === MISSING ? {} : { external: asConflictValue(external) }),
        basePresent: base !== MISSING,
        localPresent: local !== MISSING,
        externalPresent: external !== MISSING,
        resolution: choice ?? 'unresolved',
    })
    return cloneMergeValue(choice === 'external' ? external : local)
}

function cloneMergeValue(value: MergeValue): MergeValue {
    return value === MISSING ? MISSING : clone(value)
}

export function mergeCompositionDocuments(input: MergeCompositionDocumentsInput): CompositionMergeResult {
    const resolutions = new Map(
        (input.resolutions ?? []).map(resolution => [resolutionKey(resolution.path), resolution.choice]),
    )
    const conflicts: CompositionMergeConflict[] = []
    const value = mergeValue(
        clone(input.base) as unknown as JsonValue,
        clone(input.local) as unknown as JsonValue,
        clone(input.external) as unknown as JsonValue,
        [],
        resolutions,
        conflicts,
    )
    const mergedValue = value === MISSING ? null : value
    const validation = validateCompositionAuthoringDocument(mergedValue)
    const parsed = safeParseCompositionDocument(mergedValue)
    return {
        document: parsed.success ? parsed.data : null,
        value: mergedValue,
        conflicts,
        validation,
    }
}
