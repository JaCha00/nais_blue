import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveAssetModulePlan } from '@/lib/asset-modules/resolver'
import type { AssetProfile } from '@/types/asset-profile'

const fragmentHarness = vi.hoisted(() => ({
    commitCount: 0,
    counter: 0,
}))

vi.mock('@/stores/fragment-store', () => {
    const repository = {
        findMetadataByPath: () => undefined,
        loadDefinitionByPath: async (path: string) => path === 'sequence'
            ? {
                id: 'fragment:sequence',
                path: 'sequence',
                lines: ['first', 'second'],
            }
            : null,
        getSequenceSnapshot: () => ({
            revision: 1,
            counters: { 'fragment:sequence': fragmentHarness.counter },
        }),
        commitSequenceProposal: (proposal: {
            changes: Array<{ nextCounter: number }>
        } | null) => {
            fragmentHarness.commitCount += 1
            fragmentHarness.counter = proposal?.changes[0]?.nextCounter ?? fragmentHarness.counter
            return true
        },
    }

    return {
        useFragmentStore: {
            getState: () => ({
                getLookupRepository: () => repository,
                resetSequentialCounter: () => undefined,
            }),
        },
    }
})

const profile: AssetProfile = {
    revision: 1,
    updatedBy: 'gui',
    updatedAt: '2026-07-12T00:00:00.000Z',
    settings: {},
    output: {},
    r2: { enabled: false },
    modules: {
        'module:preview': {
            id: 'module:preview',
            enabled: true,
            prompt: '<*sequence>',
            settings: {},
        },
    },
    recipes: [{
        id: 'recipe:preview',
        enabled: true,
        steps: [{ moduleId: 'module:preview' }],
    }],
}

describe('Asset Module resolver preview defaults', () => {
    beforeEach(() => {
        fragmentHarness.commitCount = 0
        fragmentHarness.counter = 0
    })

    it('does not consume a sequential fragment for Studio-style optionless resolves', async () => {
        const first = await resolveAssetModulePlan({
            profile,
            recipeId: 'recipe:preview',
            seed: 123,
        })
        const second = await resolveAssetModulePlan({
            profile,
            recipeId: 'recipe:preview',
            seed: 123,
        })

        expect(first.promptGroups['main.base']).toBe('first')
        expect(second.promptGroups['main.base']).toBe('first')
        expect(fragmentHarness.counter).toBe(0)
        expect(fragmentHarness.commitCount).toBe(0)
    })
})
