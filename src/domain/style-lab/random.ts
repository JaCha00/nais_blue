/** The version is persisted with Style-Lab state so replay never silently changes algorithms. */
export const STYLE_LAB_RANDOM_ALGORITHM = 'style-lab-xorshift32-v1' as const

const UINT32_RANGE = 0x1_0000_0000
const FNV1A_OFFSET_BASIS = 0x811c9dc5
const FNV1A_PRIME = 0x01000193
const ZERO_STATE_FALLBACK = 0x6d2b79f5

export interface StyleLabRandom {
    readonly algorithm: typeof STYLE_LAB_RANDOM_ALGORITHM
    readonly seed: number
    readonly scope: string
    nextUint32(): number
    nextFloat(): number
    nextInt(maxExclusive: number): number
    shuffle<T>(values: readonly T[]): T[]
}

function normalizeSeed(seed: number): number {
    return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

function hashByte(hash: number, byte: number): number {
    return Math.imul(hash ^ (byte & 0xff), FNV1A_PRIME) >>> 0
}

/**
 * Style-Lab policies depend on this scoped derivation to isolate Arena, blueprint,
 * and evolution draws. Persisting the root seed plus operation sequence therefore
 * reproduces results without coupling unrelated consumers to one global cursor.
 */
export function deriveStyleLabSeed(seed: number, scope: string): number {
    const normalized = normalizeSeed(seed)
    let hash = FNV1A_OFFSET_BASIS
    hash = hashByte(hash, normalized)
    hash = hashByte(hash, normalized >>> 8)
    hash = hashByte(hash, normalized >>> 16)
    hash = hashByte(hash, normalized >>> 24)
    hash = hashByte(hash, 0xff)

    for (let index = 0; index < scope.length; index += 1) {
        const codeUnit = scope.charCodeAt(index)
        hash = hashByte(hash, codeUnit)
        hash = hashByte(hash, codeUnit >>> 8)
    }
    return hash === 0 ? ZERO_STATE_FALLBACK : hash
}

function nextXorshift32(state: number): number {
    let next = state >>> 0
    next ^= next << 13
    next ^= next >>> 17
    next ^= next << 5
    return next >>> 0
}

/**
 * Pure seeded stream used by acquisition and mutation code. It has no React,
 * Zustand, or platform dependency; each draw advances a local xorshift state and
 * produces stable cross-platform values for the same root seed and scope.
 */
export function createStyleLabRandom(seed: number, scope: string): StyleLabRandom {
    const normalizedSeed = normalizeSeed(seed)
    let state = deriveStyleLabSeed(normalizedSeed, scope)

    const nextUint32 = (): number => {
        state = nextXorshift32(state)
        return state
    }

    return {
        algorithm: STYLE_LAB_RANDOM_ALGORITHM,
        seed: normalizedSeed,
        scope,
        nextUint32,
        nextFloat: () => nextUint32() / UINT32_RANGE,
        nextInt: (maxExclusive) => {
            if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
                throw new RangeError('maxExclusive must be a positive safe integer no greater than 2^32')
            }
            return Math.floor((nextUint32() / UINT32_RANGE) * maxExclusive)
        },
        shuffle<T>(values: readonly T[]): T[] {
            const shuffled = [...values]
            for (let index = shuffled.length - 1; index > 0; index -= 1) {
                const target = Math.floor((nextUint32() / UINT32_RANGE) * (index + 1))
                const current = shuffled[index]
                shuffled[index] = shuffled[target]
                shuffled[target] = current
            }
            return shuffled
        },
    }
}
