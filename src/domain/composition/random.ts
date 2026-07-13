import type {
    EntityId,
    ProvenanceRef,
    RandomScalar,
    RandomTraceEntry,
} from './types'

/**
 * Algorithm identifier is deliberately versioned. Changing either the scoped
 * seed derivation or the xorshift transition requires a new identifier and new
 * fixture vectors.
 */
export const RANDOM_ALGORITHM = 'xorshift32-v1' as const

const UINT32_RANGE = 0x1_0000_0000
const FNV1A_OFFSET_BASIS = 0x811c9dc5
const FNV1A_PRIME = 0x01000193
const ZERO_STATE_FALLBACK = 0x6d2b79f5

export type RandomAlgorithm = typeof RANDOM_ALGORITHM

export interface RandomTraceContext {
    ruleId: EntityId
    provenance?: ProvenanceRef
}

export interface RandomDraw<T extends RandomScalar> {
    value: T
    trace: RandomTraceEntry
}

export interface RandomSelectionOption<T extends RandomScalar> {
    value: T
    id?: EntityId
}

export interface RandomSelection<T extends RandomScalar> extends RandomDraw<T> {
    index: number
}

export interface DeterministicRandomSnapshot {
    algorithm: RandomAlgorithm
    generationSeed: number
    scope: string
    streamSeed: number
    state: number
    drawIndex: number
}

/**
 * Converts any finite JavaScript number to its modulo-2^32 integer value.
 * Fractional values truncate toward zero. Non-finite values normalize to zero
 * rather than leaking host/runtime-specific fallback randomness.
 */
export function normalizeGenerationSeed(seed: number): number {
    if (!Number.isFinite(seed)) return 0
    return Math.trunc(seed) >>> 0
}

function fnv1aByte(hash: number, byte: number): number {
    return Math.imul(hash ^ (byte & 0xff), FNV1A_PRIME) >>> 0
}

/**
 * Derives an independent stream seed with FNV-1a over the normalized seed's
 * four little-endian bytes, a separator byte, and each scope UTF-16 code unit
 * as two little-endian bytes. This byte contract is part of xorshift32-v1.
 */
export function deriveScopedSeed(seed: number, scope: string): number {
    const normalizedSeed = normalizeGenerationSeed(seed)
    let hash = FNV1A_OFFSET_BASIS

    hash = fnv1aByte(hash, normalizedSeed)
    hash = fnv1aByte(hash, normalizedSeed >>> 8)
    hash = fnv1aByte(hash, normalizedSeed >>> 16)
    hash = fnv1aByte(hash, normalizedSeed >>> 24)
    hash = fnv1aByte(hash, 0xff)

    for (let index = 0; index < scope.length; index += 1) {
        const codeUnit = scope.charCodeAt(index)
        hash = fnv1aByte(hash, codeUnit)
        hash = fnv1aByte(hash, codeUnit >>> 8)
    }

    return hash === 0 ? ZERO_STATE_FALLBACK : hash
}

function xorshift32(state: number): number {
    let next = state >>> 0
    next ^= next << 13
    next ^= next >>> 17
    next ^= next << 5
    return next >>> 0
}

function assertMaxExclusive(maxExclusive: number): void {
    if (
        !Number.isSafeInteger(maxExclusive)
        || maxExclusive <= 0
        || maxExclusive > UINT32_RANGE
    ) {
        throw new RangeError('maxExclusive must be a positive safe integer no greater than 2^32')
    }
}

function integerFromUint32(raw: number, maxExclusive: number): number {
    return Math.floor((raw / UINT32_RANGE) * maxExclusive)
}

/**
 * A local deterministic cursor. It has no global state, time dependency, or
 * platform API dependency. Forking always derives from generationSeed + the
 * supplied scope, so the parent's consumed draw count cannot perturb a fork.
 */
export class DeterministicRandomStream {
    readonly algorithm = RANDOM_ALGORITHM
    readonly generationSeed: number
    readonly scope: string
    readonly streamSeed: number

    private currentState: number
    private currentDrawIndex = 0

    constructor(seed: number, scope: string) {
        this.generationSeed = normalizeGenerationSeed(seed)
        this.scope = scope
        this.streamSeed = deriveScopedSeed(this.generationSeed, scope)
        this.currentState = this.streamSeed
    }

    get state(): number {
        return this.currentState
    }

    get drawIndex(): number {
        return this.currentDrawIndex
    }

    /** The new stream is independent of this stream's current cursor state. */
    fork(scope: string): DeterministicRandomStream {
        return new DeterministicRandomStream(this.generationSeed, scope)
    }

    snapshot(): DeterministicRandomSnapshot {
        return {
            algorithm: this.algorithm,
            generationSeed: this.generationSeed,
            scope: this.scope,
            streamSeed: this.streamSeed,
            state: this.currentState,
            drawIndex: this.currentDrawIndex,
        }
    }

    private trace(
        result: RandomScalar,
        rawUint32: number,
        context: RandomTraceContext,
        selectedOptionId?: EntityId,
    ): RandomTraceEntry {
        return {
            ruleId: context.ruleId,
            streamKey: this.scope,
            drawIndex: this.currentDrawIndex,
            seed: this.generationSeed,
            result,
            ...(selectedOptionId === undefined ? {} : { selectedOptionIds: [selectedOptionId] }),
            ...(context.provenance === undefined ? {} : { provenance: context.provenance }),
            extensions: {
                algorithm: this.algorithm,
                streamSeed: this.streamSeed,
                rawUint32,
            },
        }
    }

    private finishDraw(consume: boolean, nextState: number): void {
        if (!consume) return
        this.currentState = nextState
        this.currentDrawIndex += 1
    }

    private drawUint32(context: RandomTraceContext, consume: boolean): RandomDraw<number> {
        const nextState = xorshift32(this.currentState)
        const trace = this.trace(nextState, nextState, context)
        this.finishDraw(consume, nextState)
        return { value: nextState, trace }
    }

    nextUint32(context: RandomTraceContext): RandomDraw<number> {
        return this.drawUint32(context, true)
    }

    peekUint32(context: RandomTraceContext): RandomDraw<number> {
        return this.drawUint32(context, false)
    }

    private drawFloat(context: RandomTraceContext, consume: boolean): RandomDraw<number> {
        const nextState = xorshift32(this.currentState)
        const value = nextState / UINT32_RANGE
        const trace = this.trace(value, nextState, context)
        this.finishDraw(consume, nextState)
        return { value, trace }
    }

    nextFloat(context: RandomTraceContext): RandomDraw<number> {
        return this.drawFloat(context, true)
    }

    peekFloat(context: RandomTraceContext): RandomDraw<number> {
        return this.drawFloat(context, false)
    }

    private drawInt(
        maxExclusive: number,
        context: RandomTraceContext,
        consume: boolean,
    ): RandomDraw<number> {
        assertMaxExclusive(maxExclusive)
        const nextState = xorshift32(this.currentState)
        const value = integerFromUint32(nextState, maxExclusive)
        const trace = this.trace(value, nextState, context)
        this.finishDraw(consume, nextState)
        return { value, trace }
    }

    nextInt(maxExclusive: number, context: RandomTraceContext): RandomDraw<number> {
        return this.drawInt(maxExclusive, context, true)
    }

    peekInt(maxExclusive: number, context: RandomTraceContext): RandomDraw<number> {
        return this.drawInt(maxExclusive, context, false)
    }

    private drawSelection<T extends RandomScalar>(
        options: readonly RandomSelectionOption<T>[],
        context: RandomTraceContext,
        consume: boolean,
    ): RandomSelection<T> {
        if (options.length === 0) throw new RangeError('options must not be empty')
        assertMaxExclusive(options.length)

        const nextState = xorshift32(this.currentState)
        const index = integerFromUint32(nextState, options.length)
        const selected = options[index]
        const trace = this.trace(selected.value, nextState, context, selected.id)
        this.finishDraw(consume, nextState)
        return { index, value: selected.value, trace }
    }

    select<T extends RandomScalar>(
        options: readonly RandomSelectionOption<T>[],
        context: RandomTraceContext,
    ): RandomSelection<T> {
        return this.drawSelection(options, context, true)
    }

    peekSelect<T extends RandomScalar>(
        options: readonly RandomSelectionOption<T>[],
        context: RandomTraceContext,
    ): RandomSelection<T> {
        return this.drawSelection(options, context, false)
    }
}

export function createDeterministicRandom(seed: number, scope: string): DeterministicRandomStream {
    return new DeterministicRandomStream(seed, scope)
}
