import { afterEach, describe, expect, it } from 'vitest'

import {
    effectiveMainCompositionMode,
    effectiveSceneCompositionMode,
    effectiveStyleLabCompositionMode,
    getRuntimeCompositionAuthority,
    setRuntimeCompositionAuthority,
} from '@/lib/composition-authority'

afterEach(() => setRuntimeCompositionAuthority('v2'))

describe('Composition runtime authority gate', () => {
    it('forces every production workflow through legacy after rollback', () => {
        setRuntimeCompositionAuthority('legacy')
        expect(getRuntimeCompositionAuthority()).toBe('legacy')
        expect(effectiveMainCompositionMode('v2')).toBe('legacy')
        expect(effectiveMainCompositionMode('shadow')).toBe('legacy')
        expect(effectiveSceneCompositionMode('v2')).toBe('legacy')
        expect(effectiveStyleLabCompositionMode('v2')).toBe('legacy')
    })

    it('honors each workflow rollout mode only after v2 authority activation', () => {
        setRuntimeCompositionAuthority('v2')
        expect(effectiveMainCompositionMode('shadow')).toBe('shadow')
        expect(effectiveSceneCompositionMode('v2')).toBe('v2')
        expect(effectiveStyleLabCompositionMode('v2')).toBe('v2')
        expect(effectiveMainCompositionMode('legacy')).toBe('legacy')
    })
})
