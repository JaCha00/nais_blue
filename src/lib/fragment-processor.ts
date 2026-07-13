import {
    createFragmentLookup,
    hasFragmentSyntax,
    normalizeFragmentLookupPath,
    resolveFragments,
    type FragmentDefinitionSnapshot,
    type FragmentLookup,
    type FragmentResolutionMode,
    type FragmentSequenceCommitProposal,
    type FragmentSelectionSource,
    type FragmentStrictnessPolicy,
    type ResolveFragmentsResult,
} from '@/domain/composition/fragment-resolver'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type { ProvenanceRef } from '@/domain/composition/types'
import {
    useFragmentStore,
    type FragmentLookupRepository,
    type FragmentSequenceLease,
} from '@/stores/fragment-store'

const DEFAULT_COMPATIBILITY_SCOPE = 'compatibility:fragment-processor'
export const LEGACY_FRAGMENT_SELECTION_ALGORITHM = 'legacy-math-random-v1' as const

export interface WildcardResolutionOptions {
    /** Composition generation seed. Omitted deferred resolutions use zero. */
    seed?: number
    scope?: string
    mode?: FragmentResolutionMode
    strictness?: FragmentStrictnessPolicy
    maxRecursion?: number
    sourceRef?: ProvenanceRef
    selectionSource?: FragmentSelectionSource
    /** Injectable for tests and non-default storage boundaries. */
    repository?: FragmentLookupRepository
}

export interface ProcessWildcardsOptions extends WildcardResolutionOptions {
    /**
     * Legacy calls commit immediately. Generation code that can fail or be
     * cancelled must use prepareWildcardResolution() and commit after success.
     */
    commitSequence?: boolean
}

export type WildcardResolutionStatus = 'pending' | 'committed' | 'discarded' | 'conflict'

export interface PreparedWildcardResolution {
    readonly result: ResolveFragmentsResult
    readonly resolvedText: string
    readonly status: WildcardResolutionStatus
    /** One-shot CAS commit. Returns false after preview, failure, discard, or conflict. */
    commitSequence(): boolean
    /** Marks failed/cancelled work complete without touching sequence state. */
    discard(): void
}

export interface WildcardResolutionSession {
    /** Serialized so multiple prompt fields share one in-memory sequence view. */
    process(prompt: string): Promise<string>
    readonly status: WildcardResolutionStatus
    readonly sequenceCommitProposal: DeepReadonly<FragmentSequenceCommitProposal> | null
    /** One-shot CAS commit after every generation/output success guard passes. */
    commitSequence(): Promise<boolean>
    /** Failed or cancelled work is discarded without mutating the store. */
    discard(): void
}

interface MaterializedFragmentRepository {
    definitions: FragmentDefinitionSnapshot[]
    failedPaths: Set<string>
}

export function createLegacyFragmentSelectionSource(
    random: () => number = Math.random,
): FragmentSelectionSource {
    return {
        algorithm: LEGACY_FRAGMENT_SELECTION_ALGORITHM,
        nextFloat: () => random(),
    }
}

/** Extracts only named/sequential references; inline pipe syntax needs no repository. */
export function referencedFragmentPaths(text: string): string[] {
    const paths: string[] = []
    for (const match of text.matchAll(/<([^<>]+)>/g)) {
        const token = match[1].trim()
        if (token.includes('|')) continue
        const path = normalizeFragmentLookupPath(token.startsWith('*') ? token.slice(1) : token)
        if (path.length > 0) paths.push(path)
    }
    return paths
}

async function materializeReachableFragments(
    texts: readonly string[],
    repository: FragmentLookupRepository,
): Promise<MaterializedFragmentRepository> {
    const pending = texts.flatMap(referencedFragmentPaths)
    const visitedPaths = new Set<string>()
    const loadedIds = new Set<string>()
    const definitions: FragmentDefinitionSnapshot[] = []
    const failedPaths = new Set<string>()

    while (pending.length > 0) {
        const requestedPath = pending.shift()
        if (requestedPath === undefined || visitedPaths.has(requestedPath)) continue
        visitedPaths.add(requestedPath)

        let definition: FragmentDefinitionSnapshot | null
        try {
            definition = await repository.loadDefinitionByPath(requestedPath)
        } catch {
            failedPaths.add(requestedPath)
            continue
        }
        if (definition === null || loadedIds.has(definition.id)) continue

        loadedIds.add(definition.id)
        const snapshot: FragmentDefinitionSnapshot = {
            id: definition.id,
            path: definition.path,
            lines: [...definition.lines],
        }
        definitions.push(snapshot)
        for (const line of snapshot.lines) {
            pending.push(...referencedFragmentPaths(line))
        }
    }

    return { definitions, failedPaths }
}

export interface StoreFragmentResolverInput {
    lookup: FragmentLookup
    sequenceSnapshot: ReturnType<FragmentLookupRepository['getSequenceSnapshot']>
    mode: FragmentResolutionMode
    strictness: FragmentStrictnessPolicy
    maxRecursion: number
}

/**
 * Captures metadata, separately stored content, and ID-keyed counters at one
 * revision. A concurrent edit retries instead of pairing stale content with a
 * newer sequence snapshot.
 */
export async function createStoreFragmentResolverInput(
    sourceTexts: readonly string[],
    options: Pick<WildcardResolutionOptions,
        'mode' | 'strictness' | 'maxRecursion' | 'repository'> = {},
): Promise<StoreFragmentResolverInput> {
    const repository = options.repository ?? useFragmentStore.getState().getLookupRepository()
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const sequenceSnapshot = repository.getSequenceSnapshot()
        const materialized = await materializeReachableFragments(sourceTexts, repository)
        if (repository.getSequenceSnapshot().revision !== sequenceSnapshot.revision) continue
        return {
            lookup: lookupWithMaterializationFailures(materialized),
            sequenceSnapshot,
            mode: options.mode ?? 'generate',
            strictness: options.strictness ?? 'compatible',
            maxRecursion: options.maxRecursion ?? 10,
        }
    }
    throw new Error('Fragment store changed while materializing a resolver snapshot')
}

export function commitWildcardSequenceProposal(
    proposal: DeepReadonly<FragmentSequenceCommitProposal> | null,
    repository: FragmentLookupRepository = useFragmentStore.getState().getLookupRepository(),
): boolean {
    if (proposal === null) return true
    return repository.commitSequenceProposal({
        expectedRevision: proposal.expectedRevision,
        changes: proposal.changes.map(change => ({ ...change })),
    })
}

export function reserveWildcardSequenceProposal(
    proposal: DeepReadonly<FragmentSequenceCommitProposal> | null,
): FragmentSequenceLease | null {
    return useFragmentStore.getState().reserveSequenceProposal(proposal === null
        ? null
        : {
            expectedRevision: proposal.expectedRevision,
            changes: proposal.changes.map(change => ({ ...change })),
        })
}

function lookupWithMaterializationFailures(
    materialized: MaterializedFragmentRepository,
): FragmentLookup {
    const lookup = createFragmentLookup(materialized.definitions)
    return {
        getFragment: path => {
            const normalizedPath = normalizeFragmentLookupPath(path)
            if (materialized.failedPaths.has(normalizedPath)) {
                throw new Error(`Fragment content lookup failed: ${normalizedPath}`)
            }
            return lookup.getFragment(normalizedPath)
        },
    }
}

/**
 * Store-aware compatibility boundary around the pure resolver. Sequence changes
 * remain staged until commitSequence() is called after a successful generation.
 */
export async function prepareWildcardResolution(
    prompt: string,
    options: WildcardResolutionOptions = {},
): Promise<PreparedWildcardResolution> {
    const repository = options.repository ?? useFragmentStore.getState().getLookupRepository()
    const mode = options.mode ?? 'generate'
    const fragment = await createStoreFragmentResolverInput([prompt], {
        repository,
        mode,
        strictness: options.strictness,
        maxRecursion: options.maxRecursion,
    })
    const result = resolveFragments({
        text: prompt,
        seed: options.seed ?? 0,
        scope: options.scope ?? DEFAULT_COMPATIBILITY_SCOPE,
        lookup: fragment.lookup,
        sequenceSnapshot: fragment.sequenceSnapshot,
        mode,
        maxRecursion: options.maxRecursion ?? 10,
        strictness: options.strictness ?? 'compatible',
        ...(options.sourceRef === undefined ? {} : { sourceRef: options.sourceRef }),
        ...(options.selectionSource === undefined
            ? {}
            : { selectionSource: options.selectionSource }),
    })

    let status: WildcardResolutionStatus = 'pending'
    return {
        result,
        resolvedText: result.resolvedText,
        get status() {
            return status
        },
        commitSequence() {
            if (status !== 'pending') return false
            if (mode !== 'generate' || !result.success) {
                status = 'discarded'
                return false
            }
            const committed = commitWildcardSequenceProposal(result.sequenceCommitProposal, repository)
            status = committed ? 'committed' : 'conflict'
            return committed
        },
        discard() {
            if (status === 'pending') status = 'discarded'
        },
    }
}

/**
 * Deferred compatibility session for legacy generation paths that resolve more
 * than one prompt field. Each call sees the counters staged by earlier calls,
 * while the persisted store remains untouched until the caller commits.
 */
export function createWildcardResolutionSession(
    options: WildcardResolutionOptions = {},
): WildcardResolutionSession {
    const repository = options.repository ?? useFragmentStore.getState().getLookupRepository()
    const mode = options.mode ?? 'generate'
    const selectionSource = options.selectionSource ?? (
        options.seed === undefined && mode === 'generate'
            ? createLegacyFragmentSelectionSource()
            : undefined
    )
    let status: WildcardResolutionStatus = 'pending'
    let failed = false
    let pendingCount = 0
    let baseRevision: number | null = null
    let localCounters: Record<string, number> = {}
    const stagedChanges = new Map<string, FragmentSequenceCommitProposal['changes'][number]>()
    let queue: Promise<void> = Promise.resolve()

    const resolveOne = async (prompt: string): Promise<string> => {
        if (status !== 'pending') {
            throw new Error(`Wildcard resolution session is already ${status}`)
        }
        if (!prompt || !hasFragmentSyntax(prompt)) return prompt

        try {
            const fragment = await createStoreFragmentResolverInput([prompt], {
                repository,
                mode,
                strictness: options.strictness,
                maxRecursion: options.maxRecursion,
            })
            if (baseRevision === null) {
                baseRevision = fragment.sequenceSnapshot.revision
                localCounters = { ...fragment.sequenceSnapshot.counters }
            } else if (fragment.sequenceSnapshot.revision !== baseRevision) {
                throw new Error('Fragment store changed during deferred wildcard resolution')
            }

            const result = resolveFragments({
                text: prompt,
                seed: options.seed ?? 0,
                scope: options.scope ?? DEFAULT_COMPATIBILITY_SCOPE,
                lookup: fragment.lookup,
                sequenceSnapshot: {
                    revision: baseRevision,
                    counters: { ...localCounters },
                },
                mode,
                maxRecursion: options.maxRecursion ?? 10,
                strictness: options.strictness ?? 'compatible',
                ...(options.sourceRef === undefined ? {} : { sourceRef: options.sourceRef }),
                ...(selectionSource === undefined ? {} : { selectionSource }),
            })
            if (!result.success) failed = true
            for (const change of result.sequenceCommitProposal?.changes ?? []) {
                const existing = stagedChanges.get(change.fragmentId)
                stagedChanges.set(change.fragmentId, {
                    ...change,
                    fragmentPath: existing?.fragmentPath ?? change.fragmentPath,
                    expectedCounter: existing?.expectedCounter ?? change.expectedCounter,
                })
                localCounters[change.fragmentId] = change.nextCounter
            }
            return result.resolvedText
        } catch (error) {
            failed = true
            throw error
        }
    }

    const process = (prompt: string): Promise<string> => {
        pendingCount += 1
        const result = queue.then(() => resolveOne(prompt))
        queue = result.then(() => undefined, () => undefined)
        return result.finally(() => {
            pendingCount -= 1
        })
    }

    const proposal = (): FragmentSequenceCommitProposal | null => {
        if (
            status !== 'pending'
            || mode !== 'generate'
            || failed
            || pendingCount !== 0
            || baseRevision === null
            || stagedChanges.size === 0
        ) return null
        return {
            expectedRevision: baseRevision,
            changes: [...stagedChanges.values()]
                .sort((left, right) => (
                    left.fragmentId < right.fragmentId ? -1 : left.fragmentId > right.fragmentId ? 1 : 0
                )),
        }
    }

    return {
        process,
        get status() {
            return status
        },
        get sequenceCommitProposal() {
            return proposal()
        },
        async commitSequence() {
            await queue
            if (status !== 'pending') return false
            if (mode !== 'generate' || failed) {
                status = 'discarded'
                return false
            }
            const committed = commitWildcardSequenceProposal(proposal(), repository)
            status = committed ? 'committed' : 'conflict'
            return committed
        },
        discard() {
            if (status === 'pending') status = 'discarded'
        },
    }
}

/**
 * Existing string-in/string-out signature. It still commits sequential counters
 * immediately for callers that cannot carry a lifecycle token. New generation
 * paths should use prepareWildcardResolution() so failure/cancel can discard.
 */
export async function processWildcards(
    prompt: string,
    options: ProcessWildcardsOptions = {},
): Promise<string> {
    if (!prompt || !hasFragmentSyntax(prompt)) return prompt

    const mode = options.mode ?? 'generate'
    const compatibilitySelectionSource = options.selectionSource ?? (
        options.seed === undefined && mode === 'generate'
            ? createLegacyFragmentSelectionSource()
            : undefined
    )
    const prepared = await prepareWildcardResolution(prompt, {
        ...options,
        seed: options.seed ?? 0,
        mode,
        ...(compatibilitySelectionSource === undefined
            ? {}
            : { selectionSource: compatibilitySelectionSource }),
    })
    if (mode === 'generate' && (options.commitSequence ?? true)) {
        prepared.commitSequence()
    } else {
        prepared.discard()
    }
    return prepared.resolvedText
}

export function hasWildcards(prompt: string): boolean {
    return hasFragmentSyntax(prompt)
}
