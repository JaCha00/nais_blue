import {
    CORE_PARAMS_FIELDS,
    PARAMS_PRECEDENCE_ORDER,
    type CoreParamsField,
    type ParamsPrecedenceSource,
} from './precedence'
import type {
    CompositionEntityKind,
    EntityId,
    PositivePromptSlot,
    PromptContribution,
    PromptTarget,
    ProvenanceRef,
    RandomTraceEntry,
} from './types'

export const COMPOSITION_PROVENANCE_VERSION = 'composition-provenance-v1' as const

export type CompositionProvenanceVersion = typeof COMPOSITION_PROVENANCE_VERSION

export type DeepReadonly<T> = T extends string | number | boolean | null | undefined
    ? T
    : T extends readonly (infer Item)[]
        ? readonly DeepReadonly<Item>[]
        : T extends object
            ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
            : T

/**
 * The prompt chain is kept in resolution/apply order. The contribution itself
 * is separate from its owners so that module, step, recipe, and request/runtime
 * sources remain distinguishable.
 */
export interface PromptContributionProvenance {
    contributionId: EntityId
    contributionRevision: number
    target: PromptTarget
    operation: PromptContribution['merge']
    orderKey: string
    applicationIndex: number
    /** True when the operation survives the target's final replace stage. */
    retainedAfterReplace: boolean
    /** The later replace operation that superseded this contribution. */
    supersededByContributionId?: EntityId
    sourceChain: ProvenanceRef[]
}

export interface ParamsLayerProvenance {
    layer: ParamsPrecedenceSource
    sourceRef: ProvenanceRef
}

/** Each params field records both the winning layer and its ordered candidate chain. */
export interface ParamsFieldProvenance {
    field: CoreParamsField
    winner: ParamsLayerProvenance
    sourceChain: ParamsLayerProvenance[]
}

export type CharacterProvenanceField = 'positive' | 'negative' | 'position'

export interface CharacterFieldProvenance {
    characterId: EntityId
    field: CharacterProvenanceField
    winnerSource: ProvenanceRef
    sourceChain: ProvenanceRef[]
}

/** A path supports both whole-policy and nested destination ownership. */
export interface OutputPolicyFieldProvenance {
    fieldPath: Array<string | number>
    winnerSource: ProvenanceRef
    sourceChain: ProvenanceRef[]
}

export interface RandomSelectionProvenance {
    trace: RandomTraceEntry
    sourceChain: ProvenanceRef[]
}

export interface CompositionProvenance {
    version: CompositionProvenanceVersion
    prompts: PromptContributionProvenance[]
    params: ParamsFieldProvenance[]
    characters: CharacterFieldProvenance[]
    outputPolicy: OutputPolicyFieldProvenance[]
    randomSelections: RandomSelectionProvenance[]
}

export interface PromptContributionProvenanceInput {
    contribution: Readonly<PromptContribution>
    applicationIndex: number
    retainedAfterReplace?: boolean
    supersededByContributionId?: EntityId
    /** Ordered origin/owner chain, for example module -> step -> recipe -> request. */
    sourceChain?: readonly ProvenanceRef[]
}

export interface ParamsFieldProvenanceInput {
    field: CoreParamsField
    winner: Readonly<ParamsLayerProvenance>
    /** Candidate sources; canonical precedence is applied by the builder. */
    sourceChain?: readonly ParamsLayerProvenance[]
}

export interface CharacterFieldProvenanceInput {
    characterId: EntityId
    field: CharacterProvenanceField
    winnerSource: Readonly<ProvenanceRef>
    /** Ordered base/patch/runtime chain. */
    sourceChain?: readonly ProvenanceRef[]
}

export interface OutputPolicyFieldProvenanceInput {
    fieldPath: readonly (string | number)[]
    winnerSource: Readonly<ProvenanceRef>
    /** Ordered default/module/step/recipe/runtime chain. */
    sourceChain?: readonly ProvenanceRef[]
}

export interface RandomSelectionProvenanceInput {
    trace: Readonly<RandomTraceEntry>
    /** Rule/fragment/contribution context in resolution order. */
    sourceChain?: readonly ProvenanceRef[]
}

export interface CompositionProvenanceInput {
    prompts?: readonly PromptContributionProvenanceInput[]
    params?: readonly ParamsFieldProvenanceInput[]
    characters?: readonly CharacterFieldProvenanceInput[]
    outputPolicy?: readonly OutputPolicyFieldProvenanceInput[]
    randomSelections?: readonly RandomSelectionProvenanceInput[]
}

function cloneSerializable<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value

    if (Array.isArray(value)) {
        return value.map(item => cloneSerializable(item)) as T
    }

    const clone: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
        Object.defineProperty(clone, key, {
            value: cloneSerializable((value as Record<string, unknown>)[key]),
            enumerable: true,
            configurable: true,
            writable: true,
        })
    }
    return clone as T
}

function cloneAndFreeze(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value

    if (Array.isArray(value)) {
        return Object.freeze(value.map(item => cloneAndFreeze(item)))
    }

    const clone: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
        Object.defineProperty(clone, key, {
            value: cloneAndFreeze((value as Record<string, unknown>)[key]),
            enumerable: true,
            configurable: true,
            writable: true,
        })
    }
    return Object.freeze(clone)
}

/** Creates a recursively frozen defensive copy of a serializable domain value. */
export function createImmutableSerializableSnapshot<T>(value: T): DeepReadonly<T> {
    return cloneAndFreeze(value) as DeepReadonly<T>
}

export function createEntityProvenanceRef(
    entityKind: CompositionEntityKind,
    entity: Readonly<{ id: EntityId; revision: number }>,
    path?: readonly (string | number)[],
): ProvenanceRef {
    return {
        kind: 'entity',
        entityKind,
        entityId: entity.id,
        revision: entity.revision,
        ...(path === undefined ? {} : { path: [...path] }),
    }
}

export function createRequestProvenanceRef(
    requestId: EntityId,
    path?: readonly (string | number)[],
): ProvenanceRef {
    return {
        kind: 'request',
        requestId,
        ...(path === undefined ? {} : { path: [...path] }),
    }
}

export function createExternalProvenanceRef(
    source: string,
    options: Readonly<{ digest?: string; path?: readonly (string | number)[] }> = {},
): ProvenanceRef {
    return {
        kind: 'external',
        source,
        ...(options.digest === undefined ? {} : { digest: options.digest }),
        ...(options.path === undefined ? {} : { path: [...options.path] }),
    }
}

function compareStableText(left: string, right: string): number {
    if (left < right) return -1
    if (left > right) return 1
    return 0
}

function pathKey(path: readonly (string | number)[] | undefined): string {
    return JSON.stringify(path ?? [])
}

/** Extensions are descriptive and intentionally do not change source identity. */
export function provenanceRefIdentity(sourceRef: DeepReadonly<ProvenanceRef>): string {
    switch (sourceRef.kind) {
        case 'entity':
            return JSON.stringify([
                'entity',
                sourceRef.entityKind,
                sourceRef.entityId,
                sourceRef.revision,
                sourceRef.path ?? [],
            ])
        case 'request':
            return JSON.stringify(['request', sourceRef.requestId, sourceRef.path ?? []])
        case 'external':
            return JSON.stringify([
                'external',
                sourceRef.source,
                sourceRef.digest ?? '',
                sourceRef.path ?? [],
            ])
    }
}

/** Preserves the first occurrence and never mutates the caller's references. */
export function dedupeProvenanceChain(
    sourceChain: readonly DeepReadonly<ProvenanceRef>[],
): ProvenanceRef[] {
    const seen = new Set<string>()
    const result: ProvenanceRef[] = []

    for (const sourceRef of sourceChain) {
        const identity = provenanceRefIdentity(sourceRef)
        if (seen.has(identity)) continue
        seen.add(identity)
        result.push(cloneSerializable(sourceRef) as ProvenanceRef)
    }

    return result
}

function mergeSourceChain(
    primary: readonly DeepReadonly<ProvenanceRef>[] | undefined,
    fallback: DeepReadonly<ProvenanceRef>,
): ProvenanceRef[] {
    return dedupeProvenanceChain([...(primary ?? []), fallback])
}

export function createPromptContributionProvenance(
    input: PromptContributionProvenanceInput,
): PromptContributionProvenance {
    return {
        contributionId: input.contribution.id,
        contributionRevision: input.contribution.revision,
        target: cloneSerializable(input.contribution.target),
        operation: input.contribution.merge,
        orderKey: input.contribution.orderKey,
        applicationIndex: input.applicationIndex,
        retainedAfterReplace: input.retainedAfterReplace ?? true,
        ...(input.supersededByContributionId === undefined
            ? {}
            : { supersededByContributionId: input.supersededByContributionId }),
        sourceChain: dedupeProvenanceChain([
            ...(input.contribution.provenance ?? []),
            ...(input.sourceChain ?? []),
        ]),
    }
}

const PRECEDENCE_INDEX = new Map<ParamsPrecedenceSource, number>(
    PARAMS_PRECEDENCE_ORDER.map((source, index) => [source, index]),
)

function cloneParamsLayerSource(source: Readonly<ParamsLayerProvenance>): ParamsLayerProvenance {
    return {
        layer: source.layer,
        sourceRef: cloneSerializable(source.sourceRef) as ProvenanceRef,
    }
}

function paramsLayerIdentity(source: Readonly<ParamsLayerProvenance>): string {
    return `${source.layer}:${provenanceRefIdentity(source.sourceRef)}`
}

function canonicalParamsChain(
    sourceChain: readonly Readonly<ParamsLayerProvenance>[],
): ParamsLayerProvenance[] {
    const seen = new Set<string>()

    return sourceChain
        .map(cloneParamsLayerSource)
        .sort((left, right) => (
            (PRECEDENCE_INDEX.get(left.layer) ?? Number.MAX_SAFE_INTEGER)
            - (PRECEDENCE_INDEX.get(right.layer) ?? Number.MAX_SAFE_INTEGER)
        ))
        .filter(source => {
            const identity = paramsLayerIdentity(source)
            if (seen.has(identity)) return false
            seen.add(identity)
            return true
        })
}

export function createParamsFieldProvenance(
    input: ParamsFieldProvenanceInput,
): ParamsFieldProvenance {
    const winner = cloneParamsLayerSource(input.winner)
    const sourceChain = canonicalParamsChain([...(input.sourceChain ?? []), winner])

    return {
        field: input.field,
        winner,
        sourceChain,
    }
}

export function createCharacterFieldProvenance(
    input: CharacterFieldProvenanceInput,
): CharacterFieldProvenance {
    return {
        characterId: input.characterId,
        field: input.field,
        winnerSource: cloneSerializable(input.winnerSource) as ProvenanceRef,
        sourceChain: mergeSourceChain(input.sourceChain, input.winnerSource),
    }
}

export function createOutputPolicyFieldProvenance(
    input: OutputPolicyFieldProvenanceInput,
): OutputPolicyFieldProvenance {
    return {
        fieldPath: [...input.fieldPath],
        winnerSource: cloneSerializable(input.winnerSource) as ProvenanceRef,
        sourceChain: mergeSourceChain(input.sourceChain, input.winnerSource),
    }
}

export function createRandomSelectionProvenance(
    input: RandomSelectionProvenanceInput,
): RandomSelectionProvenance {
    const trace = cloneSerializable(input.trace) as RandomTraceEntry
    const traceSource = trace.provenance

    return {
        trace,
        sourceChain: traceSource === undefined
            ? dedupeProvenanceChain(input.sourceChain ?? [])
            : mergeSourceChain(input.sourceChain, traceSource),
    }
}

const CORE_FIELD_INDEX = new Map<CoreParamsField, number>(
    CORE_PARAMS_FIELDS.map((field, index) => [field, index]),
)

const CHARACTER_FIELD_INDEX: Readonly<Record<CharacterProvenanceField, number>> = {
    positive: 0,
    negative: 1,
    position: 2,
}

const POSITIVE_SLOT_INDEX: Readonly<Record<PositivePromptSlot, number>> = {
    base: 0,
    inpainting: 1,
    additional: 2,
    workflow: 3,
    scene: 3,
    style: 3,
    quality: 3,
    detail: 4,
}

function promptTargetKey(target: Readonly<PromptTarget>): string {
    switch (target.kind) {
        case 'positive':
            return `0:${POSITIVE_SLOT_INDEX[target.slot]}`
        case 'negative':
            return '1'
        case 'character':
            return `2:${target.characterId}:${target.polarity === 'positive' ? 0 : 1}`
    }
}

function comparePromptProvenance(
    left: PromptContributionProvenance,
    right: PromptContributionProvenance,
): number {
    return compareStableText(promptTargetKey(left.target), promptTargetKey(right.target))
        || left.applicationIndex - right.applicationIndex
        || compareStableText(left.orderKey, right.orderKey)
        || compareStableText(left.contributionId, right.contributionId)
}

function compareParamsProvenance(left: ParamsFieldProvenance, right: ParamsFieldProvenance): number {
    return (CORE_FIELD_INDEX.get(left.field) ?? Number.MAX_SAFE_INTEGER)
        - (CORE_FIELD_INDEX.get(right.field) ?? Number.MAX_SAFE_INTEGER)
}

function compareCharacterProvenance(
    left: CharacterFieldProvenance,
    right: CharacterFieldProvenance,
): number {
    return compareStableText(left.characterId, right.characterId)
        || CHARACTER_FIELD_INDEX[left.field] - CHARACTER_FIELD_INDEX[right.field]
}

function compareOutputProvenance(
    left: OutputPolicyFieldProvenance,
    right: OutputPolicyFieldProvenance,
): number {
    return compareStableText(pathKey(left.fieldPath), pathKey(right.fieldPath))
}

function compareRandomProvenance(
    left: RandomSelectionProvenance,
    right: RandomSelectionProvenance,
): number {
    return compareStableText(left.trace.streamKey, right.trace.streamKey)
        || left.trace.drawIndex - right.trace.drawIndex
        || compareStableText(left.trace.ruleId, right.trace.ruleId)
}

export function collectCompositionProvenance(
    input: CompositionProvenanceInput,
): DeepReadonly<CompositionProvenance> {
    const provenance: CompositionProvenance = {
        version: COMPOSITION_PROVENANCE_VERSION,
        prompts: (input.prompts ?? [])
            .map(createPromptContributionProvenance)
            .sort(comparePromptProvenance),
        params: (input.params ?? [])
            .map(createParamsFieldProvenance)
            .sort(compareParamsProvenance),
        characters: (input.characters ?? [])
            .map(createCharacterFieldProvenance)
            .sort(compareCharacterProvenance),
        outputPolicy: (input.outputPolicy ?? [])
            .map(createOutputPolicyFieldProvenance)
            .sort(compareOutputProvenance),
        randomSelections: (input.randomSelections ?? [])
            .map(createRandomSelectionProvenance)
            .sort(compareRandomProvenance),
    }

    return createImmutableSerializableSnapshot(provenance)
}

export class CompositionProvenanceCollector {
    private readonly prompts: PromptContributionProvenanceInput[] = []
    private readonly params: ParamsFieldProvenanceInput[] = []
    private readonly characters: CharacterFieldProvenanceInput[] = []
    private readonly outputPolicy: OutputPolicyFieldProvenanceInput[] = []
    private readonly randomSelections: RandomSelectionProvenanceInput[] = []

    recordPrompt(input: PromptContributionProvenanceInput): this {
        this.prompts.push(cloneSerializable(input))
        return this
    }

    recordParam(input: ParamsFieldProvenanceInput): this {
        this.params.push(cloneSerializable(input))
        return this
    }

    recordCharacter(input: CharacterFieldProvenanceInput): this {
        this.characters.push(cloneSerializable(input))
        return this
    }

    recordOutputPolicy(input: OutputPolicyFieldProvenanceInput): this {
        this.outputPolicy.push(cloneSerializable(input))
        return this
    }

    recordRandomSelection(input: RandomSelectionProvenanceInput): this {
        this.randomSelections.push(cloneSerializable(input))
        return this
    }

    snapshot(): DeepReadonly<CompositionProvenance> {
        return collectCompositionProvenance({
            prompts: this.prompts,
            params: this.params,
            characters: this.characters,
            outputPolicy: this.outputPolicy,
            randomSelections: this.randomSelections,
        })
    }
}

function collectRefsFromSnapshot(
    provenance: DeepReadonly<CompositionProvenance>,
): Array<DeepReadonly<ProvenanceRef>> {
    return [
        ...provenance.prompts.flatMap(entry => [
            createEntityProvenanceRef('prompt-contribution', {
                id: entry.contributionId,
                revision: entry.contributionRevision,
            }),
            ...entry.sourceChain,
        ]),
        ...provenance.params.flatMap(entry => [
            ...entry.sourceChain.map(source => source.sourceRef),
            entry.winner.sourceRef,
        ]),
        ...provenance.characters.flatMap(entry => [...entry.sourceChain, entry.winnerSource]),
        ...provenance.outputPolicy.flatMap(entry => [...entry.sourceChain, entry.winnerSource]),
        ...provenance.randomSelections.flatMap(entry => [
            ...entry.sourceChain,
            ...(entry.trace.provenance === undefined ? [] : [entry.trace.provenance]),
        ]),
    ]
}

/** Compatibility bridge for the existing ResolvedGenerationPlan.provenance field. */
export function flattenProvenanceRefs(
    provenance: DeepReadonly<CompositionProvenance>,
): ProvenanceRef[] {
    return dedupeProvenanceChain(collectRefsFromSnapshot(provenance))
}
