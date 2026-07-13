import {
    type FragmentResolutionMode,
    type FragmentSequenceCommitProposal,
} from '@/domain/composition/fragment-resolver'
import type { DeepReadonly } from '@/domain/composition/provenance'
import {
    createStoreFragmentResolverInput,
    reserveWildcardSequenceProposal,
} from '@/lib/fragment-processor'
import type { FragmentSequenceLease } from '@/stores/fragment-store'

export function collectSceneFragmentSourceTexts(value: unknown, seen = new Set<object>()): string[] {
    if (typeof value === 'string') return [value]
    if (value === null || typeof value !== 'object' || seen.has(value)) return []
    seen.add(value)
    if (Array.isArray(value)) return value.flatMap(item => collectSceneFragmentSourceTexts(item, seen))
    return Object.values(value).flatMap(item => collectSceneFragmentSourceTexts(item, seen))
}

export async function buildSceneFragmentInput(
    mode: FragmentResolutionMode,
    sourceTexts: readonly string[],
) {
    return createStoreFragmentResolverInput(sourceTexts, {
        mode,
        strictness: 'compatible',
        maxRecursion: 10,
    })
}

export function reserveSceneFragmentSequenceProposal(
    proposal: DeepReadonly<FragmentSequenceCommitProposal> | null,
): FragmentSequenceLease | null {
    return reserveWildcardSequenceProposal(proposal)
}
