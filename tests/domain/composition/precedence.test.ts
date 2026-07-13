import { describe, expect, it } from 'vitest'

import {
    PARAMS_PRECEDENCE_ORDER,
    mergeParamsByPrecedence,
    validateDimensionPair,
    type ParamsPrecedenceLayers,
    type ParamsPrecedenceSource,
} from '@/domain/composition/precedence'
import type { ResourceBinding } from '@/domain/composition/types'

function binding(resourceId: string): ResourceBinding {
    return {
        resourceId,
        enabled: true,
        referenceType: 'character',
        strength: 1,
    }
}

describe('Composition params precedence', () => {
    it.each([
        { field: 'smea' as const, lower: true, higher: false },
        { field: 'steps' as const, lower: 28, higher: 0 },
        { field: 'cfgScale' as const, lower: 5, higher: 0 },
        { field: 'seedLocked' as const, lower: true, higher: false },
    ])('preserves explicit $higher for $field', ({ field, lower, higher }) => {
        const result = mergeParamsByPrecedence({
            'engine-defaults': { params: { [field]: lower } },
            'workflow-runtime-override': { params: { [field]: higher } },
            'transport-derived-override': { params: { [field]: undefined } },
        })

        expect(result.params[field]).toBe(higher)
        expect(result.winnerByField[field]).toBe('workflow-runtime-override')
    })

    it.each(PARAMS_PRECEDENCE_ORDER.map((winner, winnerIndex) => ({ winner, winnerIndex })))(
        'uses $winner as the winner when it is the highest specified layer',
        ({ winner, winnerIndex }) => {
            const layers: Partial<Record<ParamsPrecedenceSource, { params: { steps: number } }>> = {}
            for (let index = 0; index <= winnerIndex; index += 1) {
                layers[PARAMS_PRECEDENCE_ORDER[index]] = { params: { steps: index } }
            }

            const result = mergeParamsByPrecedence(layers)

            expect(result.params.steps).toBe(winnerIndex)
            expect(result.winnerByField.steps).toBe(winner)
        },
    )

    it('applies resource append, remove and replace operations in canonical layer order', () => {
        const a = binding('resource:a')
        const b = binding('resource:b')
        const c = binding('resource:c')
        const d = binding('resource:d')

        const result = mergeParamsByPrecedence({
            'engine-defaults': {
                resourceBindingOperations: [{ operation: 'append', bindings: [a, b] }],
            },
            'module-defaults': {
                resourceBindingOperations: [
                    { operation: 'remove', resourceIds: ['resource:a'] },
                    { operation: 'append', bindings: [c] },
                ],
            },
            'scene-override': {
                resourceBindingOperations: [{ operation: 'replace', bindings: [d] }],
            },
            'workflow-runtime-override': {
                resourceBindingOperations: [{ operation: 'append', bindings: [a] }],
            },
        })

        expect(result.resourceBindings.map(item => item.resourceId)).toEqual(['resource:d', 'resource:a'])
    })

    it.each([
        {
            name: 'both absent',
            params: {},
            expected: { valid: true, state: 'absent' },
        },
        {
            name: 'both complete including zero',
            params: { width: 0, height: 0 },
            expected: { valid: true, state: 'complete', width: 0, height: 0 },
        },
        {
            name: 'height missing',
            params: { width: 1024 },
            expected: { valid: false, state: 'incomplete', missing: 'height' },
        },
        {
            name: 'width missing',
            params: { height: 1024 },
            expected: { valid: false, state: 'incomplete', missing: 'width' },
        },
    ])('validates the dimension pair when $name', ({ params, expected }) => {
        expect(validateDimensionPair(params)).toEqual(expected)
    })

    it('validates dimensions after merging values contributed by different layers', () => {
        const result = mergeParamsByPrecedence({
            'engine-defaults': { params: { width: 832 } },
            'profile-defaults': { params: { height: 1216 } },
        })

        expect(result.dimensionPair).toEqual({
            valid: true,
            state: 'complete',
            width: 832,
            height: 1216,
        })
    })

    it('reports extension objects without merging their keys into core params', () => {
        const layers: ParamsPrecedenceLayers = {
            'profile-defaults': {
                params: {
                    steps: 28,
                    extensions: {
                        futurePayloadFlag: true,
                        futureNumericValue: 0,
                    },
                },
            },
        }

        const result = mergeParamsByPrecedence(layers)

        expect(result.params).toEqual({ steps: 28 })
        expect(result.params).not.toHaveProperty('extensions')
        expect(result.params).not.toHaveProperty('futurePayloadFlag')
        expect(result.ignoredExtensions).toEqual([
            {
                source: 'profile-defaults',
                reason: 'extensions-are-not-core-params',
                extensions: {
                    futurePayloadFlag: true,
                    futureNumericValue: 0,
                },
            },
        ])
    })
})
