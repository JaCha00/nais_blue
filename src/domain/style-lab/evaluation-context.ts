import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'

export const STYLE_EVALUATION_CONTEXT_SCHEMA_VERSION = 1 as const
export const STYLE_EVALUATION_CONTEXT_HASH_VERSION = 'style-evaluation-context-v1' as const

export interface StyleEvaluationContext {
    schemaVersion: typeof STYLE_EVALUATION_CONTEXT_SCHEMA_VERSION
    hashVersion: typeof STYLE_EVALUATION_CONTEXT_HASH_VERSION
    id: string
    promptHash: string
    planHash: string
    model: string
    sampler: string
    seedPack: readonly number[]
    createdAt: number
}

export interface CreateStyleEvaluationContextInput {
    /** Candidate-independent prompt sources; combination tags must not be included. */
    prompt: unknown
    /** Candidate-independent render/recipe/reference snapshot. */
    plan: unknown
    model: string
    sampler: string
    seedPack: readonly number[]
    createdAt?: number
}

function normalizeSeed(seed: number): number {
    if (!Number.isFinite(seed)) throw new TypeError('Evaluation seed must be finite')
    return Math.trunc(seed) >>> 0
}

function digest(value: unknown): string {
    return `sha256:${hashCanonicalValue(value)}`
}

function contextId(input: Omit<StyleEvaluationContext, 'id' | 'createdAt'>): string {
    return `style-context:${hashCanonicalValue(input)}`
}

/**
 * The application capture adapter supplies prompt and render snapshots; this pure
 * constructor hashes them and stores only non-sensitive identities. Arena events
 * and preview assets share the resulting ID to prove candidates used one seed pack.
 */
export function createStyleEvaluationContext(
    input: CreateStyleEvaluationContextInput,
): StyleEvaluationContext {
    const model = input.model.trim()
    const sampler = input.sampler.trim()
    if (!model) throw new TypeError('Evaluation model must not be empty')
    if (!sampler) throw new TypeError('Evaluation sampler must not be empty')
    if (input.seedPack.length === 0 || input.seedPack.length > 16) {
        throw new RangeError('Evaluation seedPack must contain between 1 and 16 seeds')
    }

    const identity = {
        schemaVersion: STYLE_EVALUATION_CONTEXT_SCHEMA_VERSION,
        hashVersion: STYLE_EVALUATION_CONTEXT_HASH_VERSION,
        promptHash: digest(input.prompt),
        planHash: digest(input.plan),
        model,
        sampler,
        seedPack: Object.freeze(input.seedPack.map(normalizeSeed)),
    }
    const createdAt = input.createdAt ?? Date.now()
    if (!Number.isFinite(createdAt) || createdAt < 0) {
        throw new TypeError('Evaluation createdAt must be a non-negative timestamp')
    }

    return Object.freeze({
        ...identity,
        id: contextId(identity),
        createdAt: Math.trunc(createdAt),
    })
}

/** Imported repository records pass this guard before influencing acquisition. */
export function isStyleEvaluationContext(value: unknown): value is StyleEvaluationContext {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const candidate = value as Partial<StyleEvaluationContext>
    if (candidate.schemaVersion !== STYLE_EVALUATION_CONTEXT_SCHEMA_VERSION
        || candidate.hashVersion !== STYLE_EVALUATION_CONTEXT_HASH_VERSION
        || typeof candidate.id !== 'string'
        || typeof candidate.promptHash !== 'string'
        || typeof candidate.planHash !== 'string'
        || typeof candidate.model !== 'string'
        || typeof candidate.sampler !== 'string'
        || !Array.isArray(candidate.seedPack)
        || candidate.seedPack.length === 0
        || candidate.seedPack.length > 16
        || !candidate.seedPack.every(seed => Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff)
        || !Number.isSafeInteger(candidate.createdAt)
        || (candidate.createdAt as number) < 0) {
        return false
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(candidate.promptHash)
        || !/^sha256:[0-9a-f]{64}$/.test(candidate.planHash)) {
        return false
    }
    return candidate.id === contextId({
        schemaVersion: candidate.schemaVersion,
        hashVersion: candidate.hashVersion,
        promptHash: candidate.promptHash,
        planHash: candidate.planHash,
        model: candidate.model,
        sampler: candidate.sampler,
        seedPack: candidate.seedPack,
    })
}

export function sameStyleEvaluationContext(
    left: StyleEvaluationContext,
    right: StyleEvaluationContext,
): boolean {
    return left.id === right.id
}
