import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import {
    STYLE_EVOLUTION_ALGORITHM_VERSION,
    STYLE_EVOLUTION_LINEAGE_SCHEMA_VERSION,
    type EvolutionLineage,
    type StyleEvolutionOperator,
} from './types'

const EVOLUTION_OPERATORS = new Set<StyleEvolutionOperator>([
    'tag-add', 'tag-delete', 'tag-replace', 'weight-jitter', 'weight-mix',
    'order-swap', 'order-move', 'parent-splice', 'legacy-import',
])

export function createEvolutionLineage(input: {
    childId: string
    boardId?: string | null
    parentIds: readonly string[]
    operator: StyleEvolutionOperator
    diff: readonly string[]
    rngSeed: number
    generation: number
    createdAt: number
}): EvolutionLineage {
    if (!input.childId.trim() || input.parentIds.some(id => !id.trim())) {
        throw new TypeError('Evolution lineage requires bounded candidate identities')
    }
    const identity = {
        childId: input.childId,
        parentIds: [...new Set(input.parentIds)],
        operator: input.operator,
        rngSeed: Math.trunc(input.rngSeed) >>> 0,
        algorithmVersion: STYLE_EVOLUTION_ALGORITHM_VERSION,
    }
    return Object.freeze({
        schemaVersion: STYLE_EVOLUTION_LINEAGE_SCHEMA_VERSION,
        id: `style-lineage:${hashCanonicalValue(identity)}`,
        boardId: input.boardId?.trim() || null,
        ...identity,
        diff: [...input.diff],
        generation: Math.max(0, Math.trunc(input.generation)),
        createdAt: Math.max(0, Math.trunc(input.createdAt)),
    })
}

export function isEvolutionLineage(value: unknown): value is EvolutionLineage {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const lineage = value as Partial<EvolutionLineage>
    return lineage.schemaVersion === STYLE_EVOLUTION_LINEAGE_SCHEMA_VERSION
        && typeof lineage.id === 'string' && lineage.id.length > 0
        && typeof lineage.childId === 'string' && lineage.childId.length > 0
        && (lineage.boardId === null || typeof lineage.boardId === 'string')
        && Array.isArray(lineage.parentIds) && lineage.parentIds.every(id => typeof id === 'string' && id.length > 0)
        && typeof lineage.operator === 'string'
        && EVOLUTION_OPERATORS.has(lineage.operator as StyleEvolutionOperator)
        && Array.isArray(lineage.diff) && lineage.diff.every(item => typeof item === 'string')
        && Number.isSafeInteger(lineage.rngSeed) && (lineage.rngSeed as number) >= 0
        && lineage.algorithmVersion === STYLE_EVOLUTION_ALGORITHM_VERSION
        && Number.isSafeInteger(lineage.generation) && (lineage.generation as number) >= 0
        && Number.isSafeInteger(lineage.createdAt) && (lineage.createdAt as number) >= 0
}
