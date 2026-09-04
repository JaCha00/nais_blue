import {
    STYLE_LAB_RANDOM_ALGORITHM,
    deriveStyleLabSeed,
} from '@/domain/style-lab/random'
import {
    styleCombinationIdentity,
    type StyleCombinationLifecycle,
    type StyleIdentityTag,
} from '@/domain/style-lab/identity'
import {
    createEvolutionLineage,
    isEvolutionLineage,
    type EvolutionLineage,
} from '@/domain/style-lab/evolution'

// Persistence migrations are pure data transforms; keeping them outside the
// Zustand store layer lets the store depend on a neutral compatibility seam.
export const STYLE_LAB_STORE_VERSION = 3 as const
export const STYLE_LAB_STORE_SCHEMA_VERSION = 3 as const

export interface StyleLabRandomState {
    algorithm: typeof STYLE_LAB_RANDOM_ALGORITHM
    seed: number
    sequence: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function migratedSeed(state: Record<string, unknown>): number {
    const combinations = Array.isArray(state.combinations) ? state.combinations : []
    const ids = combinations
        .map(candidate => isRecord(candidate) && typeof candidate.id === 'string' ? candidate.id : '')
        .filter(Boolean)
        .join('|')
    return deriveStyleLabSeed(0x4e414953, `persist-migration:${ids || 'empty'}`)
}

function migrateRandomState(
    state: Record<string, unknown>,
): StyleLabRandomState {
    const candidate = isRecord(state.randomState) ? state.randomState : null
    if (candidate?.algorithm === STYLE_LAB_RANDOM_ALGORITHM
        && Number.isSafeInteger(candidate.seed)
        && (candidate.seed as number) >= 0
        && (candidate.seed as number) <= 0xffffffff
        && Number.isSafeInteger(candidate.sequence)
        && (candidate.sequence as number) >= 0) {
        return {
            algorithm: STYLE_LAB_RANDOM_ALGORITHM,
            seed: candidate.seed as number,
            sequence: candidate.sequence as number,
        }
    }
    return {
        algorithm: STYLE_LAB_RANDOM_ALGORITHM,
        seed: migratedSeed(state),
        sequence: 0,
    }
}

function migratedIdentity(candidate: Record<string, unknown>) {
    const tags = Array.isArray(candidate.tags)
        ? candidate.tags.filter(isRecord).map(tag => ({
            tag: typeof tag.tag === 'string' ? tag.tag : '',
            kind: typeof tag.kind === 'string' ? tag.kind : undefined,
            weight: typeof tag.weight === 'number' ? tag.weight : undefined,
        } satisfies StyleIdentityTag))
        : []
    return styleCombinationIdentity(tags)
}

function migratedLifecycle(candidate: Record<string, unknown>): StyleCombinationLifecycle {
    if (candidate.lifecycle === 'draft'
        || candidate.lifecycle === 'previewed'
        || candidate.lifecycle === 'eligible'
        || candidate.lifecycle === 'archived') return candidate.lifecycle
    if (typeof candidate.previewContextId === 'string' && Number.isSafeInteger(candidate.previewSeed)) {
        return 'eligible'
    }
    if (typeof candidate.previewPath === 'string'
        || typeof candidate.previewThumbnail === 'string'
        || typeof candidate.previewImage === 'string') return 'previewed'
    return 'draft'
}

function migratedLineage(candidate: Record<string, unknown>): EvolutionLineage | undefined {
    if (isEvolutionLineage(candidate.lineage)) return candidate.lineage
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) return undefined
    const generation = typeof candidate.generation === 'number' ? candidate.generation : 0
    const createdAt = typeof candidate.createdAt === 'number' && Number.isSafeInteger(candidate.createdAt)
        ? Math.max(0, candidate.createdAt)
        : 0
    return createEvolutionLineage({
        childId: candidate.id,
        parentIds: [],
        operator: 'legacy-import',
        diff: ['legacy provenance unavailable'],
        rngSeed: deriveStyleLabSeed(0x4e414953, `legacy-lineage:${candidate.id}`),
        generation,
        createdAt,
    })
}

/**
 * Zustand calls this pure boundary before hydration. It preserves legacy candidate
 * data, installs the versioned RNG cursor, and deliberately clears the old persisted
 * Arena selection because it has no immutable EvaluationContext to prove fairness.
 */
export function migrateStyleLabPersistedState(
    persistedState: unknown,
    _persistedVersion = 0,
): Record<string, unknown> {
    const state = isRecord(persistedState) ? persistedState : {}
    const combinations = (Array.isArray(state.combinations) ? state.combinations : []).map(candidate => {
        if (!isRecord(candidate)) return candidate
        const elo = typeof candidate.elo === 'number' && Number.isFinite(candidate.elo) ? candidate.elo : 1200
        const battles = typeof candidate.battles === 'number' && Number.isFinite(candidate.battles)
            ? Math.max(0, Math.floor(candidate.battles))
            : 0
        const identity = migratedIdentity(candidate)
        return {
            ...candidate,
            semanticHash: typeof candidate.semanticHash === 'string' && candidate.semanticHash
                ? candidate.semanticHash
                : identity.semanticHash,
            renderHash: typeof candidate.renderHash === 'string' && candidate.renderHash
                ? candidate.renderHash
                : identity.renderHash,
            lifecycle: migratedLifecycle(candidate),
            lineage: migratedLineage(candidate),
            legacyElo: typeof candidate.legacyElo === 'number' && Number.isFinite(candidate.legacyElo)
                ? candidate.legacyElo
                : elo,
            legacyBattles: typeof candidate.legacyBattles === 'number' && Number.isFinite(candidate.legacyBattles)
                ? Math.max(0, Math.floor(candidate.legacyBattles))
                : battles,
            legacyFavorite: typeof candidate.legacyFavorite === 'boolean'
                ? candidate.legacyFavorite
                : candidate.favorite === true,
            ties: typeof candidate.ties === 'number' && Number.isFinite(candidate.ties)
                ? Math.max(0, Math.floor(candidate.ties))
                : 0,
        }
    })
    return {
        ...state,
        combinations,
        schemaVersion: STYLE_LAB_STORE_SCHEMA_VERSION,
        randomState: migrateRandomState(state),
        activeBattlePair: null,
        activeEvaluationContext: null,
    }
}
