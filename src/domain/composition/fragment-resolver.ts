import {
    createDeterministicRandom,
    deriveScopedSeed,
    normalizeGenerationSeed,
    type DeterministicRandomStream,
    type RandomSelectionOption,
} from './random'
import type {
    EntityId,
    ProvenanceRef,
    RandomTraceEntry,
} from './types'

export const DEFAULT_FRAGMENT_MAX_RECURSION = 10

export type FragmentResolutionMode = 'preview' | 'generate'
export type FragmentStrictnessPolicy = 'compatible' | 'strict'

export interface FragmentSelectionSourceContext {
    ruleId: EntityId
    streamKey: string
    optionCount: number
}

/**
 * Optional compatibility input. The default resolver path never uses it and is
 * deterministic from seed + scope. Legacy facades may inject a draw source so
 * grammar interpretation still stays on this single resolver implementation.
 */
export interface FragmentSelectionSource {
    algorithm: string
    nextFloat(context: FragmentSelectionSourceContext): number
}

export interface FragmentDefinitionSnapshot {
    id: EntityId
    /** Canonical folder/name path. Basename lookup remains compatible with NAIS2. */
    path: string
    lines: readonly string[]
}

export interface FragmentLookup {
    getFragment(path: string): FragmentDefinitionSnapshot | null | undefined
}

export interface FragmentSequenceSnapshot {
    /** Persistence revision used by a future compare-and-swap boundary. */
    revision: number
    /** Counters are keyed by stable fragment ID, never by an alias path. */
    counters: Readonly<Record<EntityId, number>>
}

export interface FragmentSequenceCounterChange {
    fragmentId: EntityId
    fragmentPath: string
    expectedCounter: number
    nextCounter: number
}

export interface FragmentSequenceCommitProposal {
    expectedRevision: number
    changes: FragmentSequenceCounterChange[]
}

export type FragmentResolutionIssueCode =
    | 'W_FRAGMENT_MISSING'
    | 'E_FRAGMENT_MISSING'
    | 'E_FRAGMENT_RECURSION_LIMIT'
    | 'E_FRAGMENT_LOOKUP_FAILED'

export interface FragmentResolutionIssue {
    code: FragmentResolutionIssueCode
    severity: 'warning' | 'error'
    messageKey: string
    sourceRef: ProvenanceRef
    fieldPath: Array<string | number>
    fragmentId?: EntityId
    fragmentPath?: string
    fragmentStack: EntityId[]
    repairHintKey: string
    actionId: string
    blocking: boolean
}

export interface ResolveFragmentsInput {
    text: string
    seed: number
    scope: string
    lookup: FragmentLookup
    sequenceSnapshot: FragmentSequenceSnapshot
    mode: FragmentResolutionMode
    maxRecursion: number
    strictness: FragmentStrictnessPolicy
    sourceRef?: ProvenanceRef
    selectionSource?: FragmentSelectionSource
}

export interface ResolveFragmentsResult {
    success: boolean
    resolvedText: string
    randomTrace: RandomTraceEntry[]
    warnings: FragmentResolutionIssue[]
    errors: FragmentResolutionIssue[]
    /** Null until a successful generate resolve stages at least one counter change. */
    sequenceCommitProposal: FragmentSequenceCommitProposal | null
    usedFragmentIds: EntityId[]
}

interface UsableFragmentLine {
    sourceIndex: number
    text: string
}

interface StagedSequenceChange {
    fragmentId: EntityId
    fragmentPath: string
    expectedCounter: number
    nextCounter: number
}

interface ResolverState {
    input: ResolveFragmentsInput
    generationSeed: number
    maxRecursion: number
    sourceRef: ProvenanceRef
    randomStreams: Map<string, DeterministicRandomStream>
    selectionSourceDrawIndex: number
    syntaxOccurrences: Map<string, number>
    sequenceCounters: Map<EntityId, number>
    stagedSequenceChanges: Map<EntityId, StagedSequenceChange>
    randomTrace: RandomTraceEntry[]
    warnings: FragmentResolutionIssue[]
    errors: FragmentResolutionIssue[]
    usedFragmentIds: EntityId[]
    usedFragmentIdSet: Set<EntityId>
}

function compareStableText(left: string, right: string): number {
    if (left < right) return -1
    if (left > right) return 1
    return 0
}

/**
 * Accepts both NAIS2 path conveniences and NAIS3's spaces-around-slash form.
 * Lookup is case-insensitive, while the returned fragment ID remains unchanged.
 */
export function normalizeFragmentLookupPath(path: string): string {
    return path
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .replace(/\s*\/\s*/g, '/')
        .toLowerCase()
}

/**
 * Builds a pure in-memory lookup with current first-entry-wins basename
 * compatibility. Full canonical paths always remain independently addressable.
 */
export function createFragmentLookup(
    fragments: readonly FragmentDefinitionSnapshot[],
): FragmentLookup {
    const byPath = new Map<string, FragmentDefinitionSnapshot>()

    // Reserve every canonical path first so an earlier basename alias can
    // never shadow a later root fragment with the same name.
    for (const fragment of fragments) {
        const path = normalizeFragmentLookupPath(fragment.path)
        if (path.length === 0) continue
        if (!byPath.has(path)) byPath.set(path, fragment)
    }

    for (const fragment of fragments) {
        const path = normalizeFragmentLookupPath(fragment.path)
        if (path.length === 0) continue
        const basename = path.slice(path.lastIndexOf('/') + 1)
        if (!byPath.has(basename)) byPath.set(basename, fragment)
    }

    return {
        getFragment: path => byPath.get(normalizeFragmentLookupPath(path)),
    }
}

/** Grammar-only detection shared by the compatibility facade and UI hints. */
export function hasFragmentSyntax(text: string): boolean {
    if (text.length === 0) return false
    if (/<[^<>]+>/.test(text)) return true
    if (/\([^()]+\/[^()]+\)/.test(text)) return true

    return text
        .split('\n')
        .some(line => line.split(',').some(tag => {
            const trimmed = tag.trim()
            return trimmed.includes('/')
                && !trimmed.startsWith('http')
                && !trimmed.includes('://')
                && !trimmed.includes(' ')
        }))
}

/** Fragment content filtering mirrors the editor/import behavior at resolve time. */
export function filterFragmentLines(lines: readonly string[]): UsableFragmentLine[] {
    const result: UsableFragmentLine[] = []

    lines.forEach((line, sourceIndex) => {
        const text = line.trim()
        if (text.length === 0 || text.startsWith('#')) return
        result.push({ sourceIndex, text })
    })

    return result
}

function normalizeCounter(value: number | undefined): number {
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) return 0
    return value
}

function normalizeMaxRecursion(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) return DEFAULT_FRAGMENT_MAX_RECURSION
    return value
}

function appendUsedFragment(state: ResolverState, fragmentId: EntityId): void {
    if (state.usedFragmentIdSet.has(fragmentId)) return
    state.usedFragmentIdSet.add(fragmentId)
    state.usedFragmentIds.push(fragmentId)
}

function issueFor(
    state: ResolverState,
    code: FragmentResolutionIssueCode,
    options: {
        offset: number
        fragmentStack: readonly EntityId[]
        fragmentId?: EntityId
        fragmentPath?: string
    },
): FragmentResolutionIssue {
    const isWarning = code === 'W_FRAGMENT_MISSING'
    const missing = code === 'W_FRAGMENT_MISSING' || code === 'E_FRAGMENT_MISSING'

    return {
        code,
        severity: isWarning ? 'warning' : 'error',
        messageKey: missing
            ? 'composition.issue.fragmentMissing'
            : code === 'E_FRAGMENT_RECURSION_LIMIT'
                ? 'composition.issue.fragmentRecursionLimit'
                : 'composition.issue.fragmentLookupFailed',
        sourceRef: state.sourceRef,
        fieldPath: ['text', options.offset],
        ...(options.fragmentId === undefined ? {} : { fragmentId: options.fragmentId }),
        ...(options.fragmentPath === undefined ? {} : { fragmentPath: options.fragmentPath }),
        fragmentStack: [...options.fragmentStack],
        repairHintKey: missing
            ? 'composition.repair.restoreFragment'
            : code === 'E_FRAGMENT_RECURSION_LIMIT'
                ? 'composition.repair.breakFragmentCycle'
                : 'composition.repair.reviewFragmentLookup',
        actionId: missing
            ? 'restore-fragment'
            : code === 'E_FRAGMENT_RECURSION_LIMIT'
                ? 'break-fragment-cycle'
                : 'review-fragment-lookup',
        blocking: !isWarning,
    }
}

function recordMissing(
    state: ResolverState,
    fragmentPath: string,
    offset: number,
    fragmentStack: readonly EntityId[],
    fragmentId?: EntityId,
): void {
    const code = state.input.strictness === 'strict'
        ? 'E_FRAGMENT_MISSING'
        : 'W_FRAGMENT_MISSING'
    const issue = issueFor(state, code, { offset, fragmentStack, fragmentId, fragmentPath })
    if (issue.severity === 'warning') state.warnings.push(issue)
    else state.errors.push(issue)
}

function streamFor(state: ResolverState, streamKey: string): DeterministicRandomStream {
    const existing = state.randomStreams.get(streamKey)
    if (existing !== undefined) return existing

    const stream = createDeterministicRandom(state.generationSeed, streamKey)
    state.randomStreams.set(streamKey, stream)
    return stream
}

function selectFromStream(
    state: ResolverState,
    streamKey: string,
    ruleId: EntityId,
    options: readonly RandomSelectionOption<string>[],
): string {
    const selectionSource = state.input.selectionSource
    if (selectionSource !== undefined) {
        const rawFloat = selectionSource.nextFloat({
            ruleId,
            streamKey,
            optionCount: options.length,
        })
        const normalizedFloat = Number.isFinite(rawFloat)
            ? Math.min(Math.max(rawFloat, 0), 1 - Number.EPSILON)
            : 0
        const index = Math.floor(normalizedFloat * options.length)
        const selected = options[index]
        state.randomTrace.push({
            ruleId,
            streamKey,
            drawIndex: state.selectionSourceDrawIndex,
            seed: state.generationSeed,
            result: selected.value,
            ...(selected.id === undefined ? {} : { selectedOptionIds: [selected.id] }),
            provenance: state.sourceRef,
            extensions: {
                algorithm: selectionSource.algorithm,
                rawFloat: normalizedFloat,
                optionCount: options.length,
            },
        })
        state.selectionSourceDrawIndex += 1
        return selected.value
    }

    const stream = streamFor(state, streamKey)
    const selection = state.input.mode === 'preview'
        ? stream.peekSelect(options, { ruleId, provenance: state.sourceRef })
        : stream.select(options, { ruleId, provenance: state.sourceRef })
    state.randomTrace.push(selection.trace)
    return selection.value
}

function syntaxSelectionKey(
    state: ResolverState,
    kind: 'inline' | 'parenthesis' | 'slash',
    raw: string,
): { ruleId: EntityId; streamKey: string } {
    const identity = `${kind}:${raw}`
    const ordinal = state.syntaxOccurrences.get(identity) ?? 0
    state.syntaxOccurrences.set(identity, ordinal + 1)
    const fingerprint = deriveScopedSeed(0, identity).toString(16).padStart(8, '0')
    const localKey = `${kind}:${fingerprint}:${ordinal}`

    return {
        ruleId: `fragment-${localKey}`,
        streamKey: `${state.input.scope}/${localKey}`,
    }
}

function selectSyntaxOption(
    state: ResolverState,
    kind: 'inline' | 'parenthesis' | 'slash',
    raw: string,
    options: readonly string[],
): string {
    const { ruleId, streamKey } = syntaxSelectionKey(state, kind, raw)
    return selectFromStream(
        state,
        streamKey,
        ruleId,
        options.map((value, index) => ({ value, id: `${ruleId}:option:${index}` })),
    )
}

function selectSequentialLine(
    state: ResolverState,
    fragment: FragmentDefinitionSnapshot,
    fragmentPath: string,
    lines: readonly UsableFragmentLine[],
): string {
    const snapshotCounter = normalizeCounter(state.input.sequenceSnapshot.counters[fragment.id])
    const currentCounter = state.sequenceCounters.get(fragment.id) ?? snapshotCounter
    const line = lines[currentCounter % lines.length]
    const streamKey = `${state.input.scope}/fragment-sequence:${fragment.id}`
    const ruleId = `fragment-sequential:${fragment.id}`

    state.randomTrace.push({
        ruleId,
        streamKey,
        drawIndex: currentCounter,
        seed: state.generationSeed,
        result: line.text,
        selectedOptionIds: [`${fragment.id}:line:${line.sourceIndex}`],
        provenance: state.sourceRef,
        extensions: {
            algorithm: 'sequential-counter-v1',
            streamSeed: deriveScopedSeed(state.generationSeed, streamKey),
            fragmentPath,
            sourceLineIndex: line.sourceIndex,
            sequenceRevision: state.input.sequenceSnapshot.revision,
        },
    })

    if (state.input.mode === 'generate') {
        const nextCounter = currentCounter + 1
        state.sequenceCounters.set(fragment.id, nextCounter)
        const existing = state.stagedSequenceChanges.get(fragment.id)
        state.stagedSequenceChanges.set(fragment.id, {
            fragmentId: fragment.id,
            fragmentPath: existing?.fragmentPath ?? fragmentPath,
            expectedCounter: existing?.expectedCounter ?? snapshotCounter,
            nextCounter,
        })
    }

    return line.text
}

function selectNamedFragmentLine(
    state: ResolverState,
    fragment: FragmentDefinitionSnapshot,
    lines: readonly UsableFragmentLine[],
): string {
    const ruleId = `fragment-random:${fragment.id}`
    const streamKey = `${state.input.scope}/fragment:${fragment.id}`

    return selectFromStream(
        state,
        streamKey,
        ruleId,
        lines.map(line => ({
            value: line.text,
            id: `${fragment.id}:line:${line.sourceIndex}`,
        })),
    )
}

function resolveAngleSyntax(
    text: string,
    state: ResolverState,
    depth: number,
    fragmentStack: readonly EntityId[],
): string {
    const anglePattern = /<([^<>]+)>/g

    return text.replace(anglePattern, (match, content: string, offset: number) => {
        const trimmed = content.trim()

        // Inline pipe syntax has precedence over sequential/named lookup.
        if (trimmed.includes('|')) {
            const options = trimmed
                .split('|')
                .map(option => option.trim())
                .filter(option => option.length > 0)
            if (options.length === 0) return match
            return selectSyntaxOption(state, 'inline', match, options)
        }

        const sequential = trimmed.startsWith('*')
        const fragmentPath = normalizeFragmentLookupPath(sequential ? trimmed.slice(1) : trimmed)
        if (fragmentPath.length === 0) return match

        if (depth >= state.maxRecursion) {
            state.errors.push(issueFor(state, 'E_FRAGMENT_RECURSION_LIMIT', {
                offset,
                fragmentPath,
                fragmentStack,
            }))
            return match
        }

        let fragment: FragmentDefinitionSnapshot | null | undefined
        try {
            fragment = state.input.lookup.getFragment(fragmentPath)
        } catch {
            state.errors.push(issueFor(state, 'E_FRAGMENT_LOOKUP_FAILED', {
                offset,
                fragmentPath,
                fragmentStack,
            }))
            return match
        }

        if (fragment === null || fragment === undefined) {
            recordMissing(state, fragmentPath, offset, fragmentStack)
            return match
        }

        const lines = filterFragmentLines(fragment.lines)
        if (lines.length === 0) {
            recordMissing(state, fragmentPath, offset, fragmentStack, fragment.id)
            return match
        }

        appendUsedFragment(state, fragment.id)
        const selectedLine = sequential
            ? selectSequentialLine(state, fragment, fragmentPath, lines)
            : selectNamedFragmentLine(state, fragment, lines)

        return resolveAngleSyntax(
            selectedLine,
            state,
            depth + 1,
            [...fragmentStack, fragment.id],
        )
    })
}

function resolveParenthesisSyntax(text: string, state: ResolverState): string {
    const parenthesisPattern = /\(([^()]+\/[^()]+)\)/g

    return text.replace(parenthesisPattern, (match, content: string) => {
        const options = content
            .split('/')
            .map(option => option.trim())
            .filter(option => option.length > 0)
        if (options.length <= 1) return content
        return selectSyntaxOption(state, 'parenthesis', match, options)
    })
}

/**
 * Simple slash choices are processed per line. This keeps NAIS2's grammar but
 * adopts NAIS3's newline-preserving fix instead of collapsing prompt comments.
 */
function resolveSimpleSlashSyntax(text: string, state: ResolverState): string {
    return text
        .split('\n')
        .map(line => line
            .split(',')
            .map(tag => {
                const trimmed = tag.trim()
                if (
                    !trimmed.includes('/')
                    || trimmed.includes('<')
                    || trimmed.includes('>')
                    || trimmed.startsWith('http')
                    || trimmed.includes('://')
                    || trimmed.includes(' ')
                ) {
                    return trimmed
                }

                const options = trimmed
                    .split('/')
                    .map(option => option.trim())
                    .filter(option => option.length > 0)
                if (options.length <= 1) return trimmed
                return selectSyntaxOption(state, 'slash', trimmed, options)
            })
            .join(', '))
        .join('\n')
}

function commitProposal(state: ResolverState): FragmentSequenceCommitProposal | null {
    if (
        state.input.mode !== 'generate'
        || state.errors.length > 0
        || state.stagedSequenceChanges.size === 0
    ) {
        return null
    }

    return {
        expectedRevision: state.input.sequenceSnapshot.revision,
        changes: [...state.stagedSequenceChanges.values()]
            .sort((left, right) => compareStableText(left.fragmentId, right.fragmentId)),
    }
}

/**
 * Pure three-pass resolver. It never reads a store, mutates the supplied
 * snapshot, persists counters, or consults ambient randomness. A caller commits the CAS
 * proposal only after generation succeeds and its session/cancel guard passes.
 */
export function resolveFragments(input: ResolveFragmentsInput): ResolveFragmentsResult {
    const sourceRef = input.sourceRef ?? {
        kind: 'external',
        source: `composition.fragment-resolver:${input.scope}`,
    }
    const state: ResolverState = {
        input,
        generationSeed: normalizeGenerationSeed(input.seed),
        maxRecursion: normalizeMaxRecursion(input.maxRecursion),
        sourceRef,
        randomStreams: new Map(),
        selectionSourceDrawIndex: 0,
        syntaxOccurrences: new Map(),
        sequenceCounters: new Map(),
        stagedSequenceChanges: new Map(),
        randomTrace: [],
        warnings: [],
        errors: [],
        usedFragmentIds: [],
        usedFragmentIdSet: new Set(),
    }

    let resolvedText = resolveAngleSyntax(input.text, state, 0, [])
    resolvedText = resolveParenthesisSyntax(resolvedText, state)
    resolvedText = resolveSimpleSlashSyntax(resolvedText, state)

    return {
        success: state.errors.length === 0,
        resolvedText,
        randomTrace: state.randomTrace,
        warnings: state.warnings,
        errors: state.errors,
        sequenceCommitProposal: commitProposal(state),
        usedFragmentIds: state.usedFragmentIds,
    }
}
