import { describe, expect, it, vi } from 'vitest'

import {
    RANDOM_ALGORITHM,
    createDeterministicRandom,
    deriveScopedSeed,
    normalizeGenerationSeed,
} from '@/domain/composition/random'

const context = { ruleId: 'random-rule:test' } as const

const FIXED_VECTORS = [
    {
        seed: 0,
        scope: 'recipe:default',
        streamSeed: 755882775,
        uint32: [1535210528, 3584858850, 2565851866, 1461975552, 605956113],
    },
    {
        seed: 1,
        scope: 'module:hero',
        streamSeed: 1444802689,
        uint32: [3921228903, 696503389, 1359007609, 1427548878, 2309650377],
    },
    {
        seed: 123456789,
        scope: 'fragment:weather',
        streamSeed: 3827306416,
        uint32: [1595528763, 3725467220, 2773911158, 3331845114, 1191081934],
    },
    {
        seed: -1,
        scope: 'character-rotation:hero',
        streamSeed: 3780038336,
        uint32: [709657579, 4228276371, 848759737, 2951220073, 2116745547],
    },
    {
        seed: 42,
        scope: 'fragment:날씨',
        streamSeed: 4004058745,
        uint32: [1085036810, 3122849100, 938071849, 2895299663, 2003867138],
    },
] as const

describe('Composition deterministic random', () => {
    it.each([
        { input: 0, expected: 0 },
        { input: -1, expected: 4294967295 },
        { input: -1.9, expected: 4294967295 },
        { input: 4294967295, expected: 4294967295 },
        { input: 4294967296, expected: 0 },
        { input: 4294967297, expected: 1 },
        { input: Number.NaN, expected: 0 },
        { input: Number.POSITIVE_INFINITY, expected: 0 },
        { input: Number.NEGATIVE_INFINITY, expected: 0 },
    ])('normalizes $input to uint32 $expected', ({ input, expected }) => {
        expect(normalizeGenerationSeed(input)).toBe(expected)
    })

    it.each(FIXED_VECTORS)(
        'locks $scope to the xorshift32-v1 test vector',
        ({ seed, scope, streamSeed, uint32 }) => {
            const stream = createDeterministicRandom(seed, scope)

            expect(RANDOM_ALGORITHM).toBe('xorshift32-v1')
            expect(deriveScopedSeed(seed, scope)).toBe(streamSeed)
            expect(stream.streamSeed).toBe(streamSeed)
            expect(uint32.map(() => stream.nextUint32(context).value)).toEqual(uint32)
        },
    )

    it('returns trace data for raw, float, integer, and option selections', () => {
        const raw = createDeterministicRandom(123456789, 'fragment:weather').nextUint32(context)
        const float = createDeterministicRandom(123456789, 'fragment:weather').nextFloat(context)
        const integer = createDeterministicRandom(123456789, 'fragment:weather').nextInt(10, context)
        const selected = createDeterministicRandom(123456789, 'fragment:weather').select([
            { id: 'fragment-option:sun', value: 'sun' },
            { id: 'fragment-option:wind', value: 'wind' },
            { id: 'fragment-option:rain', value: 'rain' },
        ], context)

        expect(raw.value).toBe(1595528763)
        expect(raw.trace).toEqual({
            ruleId: 'random-rule:test',
            streamKey: 'fragment:weather',
            drawIndex: 0,
            seed: 123456789,
            result: 1595528763,
            extensions: {
                algorithm: 'xorshift32-v1',
                streamSeed: 3827306416,
                rawUint32: 1595528763,
            },
        })
        expect(float.value).toBe(0.3714879888575524)
        expect(float.trace.result).toBe(float.value)
        expect(integer).toMatchObject({ value: 3, trace: { result: 3 } })
        expect(selected).toMatchObject({
            index: 1,
            value: 'wind',
            trace: {
                drawIndex: 0,
                result: 'wind',
                selectedOptionIds: ['fragment-option:wind'],
            },
        })
    })

    it('does not consume state or draw index while peeking', () => {
        const stream = createDeterministicRandom(7, 'fragment:preview')
        const before = stream.snapshot()
        const peekedRaw = stream.peekUint32(context)
        const peekedFloat = stream.peekFloat(context)
        const peekedInt = stream.peekInt(7, context)
        const peekedSelection = stream.peekSelect([
            { value: 'a' },
            { value: 'b' },
        ], context)

        expect(stream.snapshot()).toEqual(before)
        expect(stream.nextUint32(context)).toEqual(peekedRaw)

        const fresh = createDeterministicRandom(7, 'fragment:preview')
        expect(peekedFloat).toEqual(fresh.nextFloat(context))
        expect(peekedInt).toEqual(createDeterministicRandom(7, 'fragment:preview').nextInt(7, context))
        expect(peekedSelection).toEqual(createDeterministicRandom(7, 'fragment:preview').select([
            { value: 'a' },
            { value: 'b' },
        ], context))
    })

    it('forks scopes independently of parent and sibling consumption order', () => {
        const rootA = createDeterministicRandom(20260711, 'recipe:root')
        const weatherBeforeParentDraws = rootA.fork('fragment:weather')
        for (let index = 0; index < 25; index += 1) rootA.nextUint32(context)
        const characterAfterParentDraws = rootA.fork('character-rotation:hero')

        const rootB = createDeterministicRandom(20260711, 'recipe:root')
        const characterBeforeParentDraws = rootB.fork('character-rotation:hero')
        for (let index = 0; index < 100; index += 1) rootB.nextUint32(context)
        const weatherAfterParentDraws = rootB.fork('fragment:weather')

        expect(weatherBeforeParentDraws.nextUint32(context)).toEqual(
            weatherAfterParentDraws.nextUint32(context),
        )
        expect(characterAfterParentDraws.nextUint32(context)).toEqual(
            characterBeforeParentDraws.nextUint32(context),
        )
        expect(weatherBeforeParentDraws.streamSeed).not.toBe(characterAfterParentDraws.streamSeed)
    })

    it.each([0, -1, 1.5, 0x1_0000_0001])(
        'rejects invalid integer upper bound %s without consuming state',
        maxExclusive => {
            const stream = createDeterministicRandom(1, 'fragment:error')
            const before = stream.snapshot()

            expect(() => stream.nextInt(maxExclusive, context)).toThrow(RangeError)
            expect(stream.snapshot()).toEqual(before)
        },
    )

    it('rejects an empty selection without consuming state', () => {
        const stream = createDeterministicRandom(1, 'fragment:error')
        const before = stream.snapshot()

        expect(() => stream.select([], context)).toThrow(RangeError)
        expect(stream.snapshot()).toEqual(before)
    })

    it('stays deterministic across 10,000 draws without consulting ambient randomness', () => {
        const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('ambient randomness must not be used')
        })

        try {
            const stream = createDeterministicRandom(20260711, 'fragment:stability')
            let checksum = 0

            for (let index = 0; index < 10_000; index += 1) {
                checksum = (checksum + stream.nextUint32(context).value) >>> 0
            }

            expect(stream.snapshot()).toEqual({
                algorithm: 'xorshift32-v1',
                generationSeed: 20260711,
                scope: 'fragment:stability',
                streamSeed: 865630789,
                state: 3530378674,
                drawIndex: 10_000,
            })
            expect(checksum).toBe(4266224176)
            expect(randomSpy).not.toHaveBeenCalled()
        } finally {
            randomSpy.mockRestore()
        }
    })
})
