import { describe, expect, it } from 'vitest'
import {
    createStylePreviewAsset,
    createStyleRenderBudget,
    isStylePreviewAsset,
    isStyleRenderBudget,
    styleCombinationIdentity,
} from '@/domain/style-lab'

describe('Style-Lab identity and render assets', () => {
    it('groups reweighted permutations semantically while preserving render identity', () => {
        const first = styleCombinationIdentity([
            { tag: 'Alpha', kind: 'artist', weight: 0.8 },
            { tag: 'Beta', kind: 'artist', weight: 1.2 },
        ])
        const variant = styleCombinationIdentity([
            { tag: 'beta', kind: 'artist', weight: 0.5 },
            { tag: 'alpha', kind: 'artist', weight: 1.8 },
        ])

        expect(first.semanticHash).toBe(variant.semanticHash)
        expect(first.renderHash).not.toBe(variant.renderHash)
    })

    it('creates deterministic immutable asset links and requires verified context facts', () => {
        const input = {
            comboId: 'combo-a',
            sha256: `sha256:${'a'.repeat(64)}`,
            mimeType: 'image/png' as const,
            byteSize: 3,
            source: 'generated' as const,
            vaultRef: 'style-lab-vault/originals/sha256-a.png',
            contextId: 'context-a',
            seed: 42,
            verificationState: 'context-verified' as const,
            rawMetadata: null,
            normalizedMetadata: null,
            createdAt: 10,
        }
        const first = createStylePreviewAsset(input)
        const replay = createStylePreviewAsset(input)

        expect(first).toEqual(replay)
        expect(Object.isFrozen(first)).toBe(true)
        expect(isStylePreviewAsset(first)).toBe(true)
        expect(() => createStylePreviewAsset({
            ...input,
            contextId: null,
        })).toThrow(/contextId and seed/)
    })

    it('validates non-negative render budgets', () => {
        const budget = createStyleRenderBudget({ id: 'manual', limit: 4, createdAt: 1 })
        expect(isStyleRenderBudget(budget)).toBe(true)
        expect(() => createStyleRenderBudget({ id: 'bad', limit: -1, createdAt: 1 })).toThrow()
    })
})
