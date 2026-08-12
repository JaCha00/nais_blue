import { describe, expect, it, vi } from 'vitest'

const persistence = vi.hoisted(() => ({
    value: null as string | null,
    writes: [] as string[],
}))

vi.mock('@/lib/indexed-db', () => ({
    indexedDBStorage: {
        getItem: async (name: string) => name === 'nai-blue-generation' ? persistence.value : null,
        setItem: async (_name: string, value: string) => { persistence.writes.push(value) },
        removeItem: async () => undefined,
    },
}))

vi.mock('@/i18n', () => ({
    default: { t: (key: string) => key },
}))

vi.mock('@/components/ui/use-toast', () => ({
    toast: () => undefined,
}))

describe('Main composition mode persistence', () => {
    it.each(['legacy', 'shadow'] as const)(
        'normalizes a persisted %s request and excludes the rollout mode from future writes',
        async persistedMode => {
            persistence.value = JSON.stringify({
                state: { compositionMode: persistedMode, selectedRecipeId: null },
                version: 0,
            })
            persistence.writes = []

            vi.resetModules()
            const { useGenerationStore } = await import('@/stores/generation-store')
            await useGenerationStore.persist.rehydrate()

            expect(useGenerationStore.getState().compositionMode).toBe('v2')

            useGenerationStore.getState().setSelectedRecipeId(null)
            const persisted = persistence.writes.at(-1)
            expect(persisted).toBeDefined()
            expect(JSON.parse(persisted ?? '{}').state).not.toHaveProperty('compositionMode')
        },
    )

    it('invalidates resolved diagnostics when Main generation inputs change', async () => {
        persistence.value = null
        persistence.writes = []

        vi.resetModules()
        const { useGenerationStore } = await import('@/stores/generation-store')

        const seedResolvedState = () => useGenerationStore.setState({
            lastResolvedPlan: {} as never,
            compositionWarnings: [{} as never],
            compositionErrors: [{} as never],
            compositionShadowDiff: {} as never,
        })
        const expectUnresolved = () => expect(useGenerationStore.getState()).toMatchObject({
            lastResolvedPlan: null,
            compositionWarnings: [],
            compositionErrors: [],
            compositionShadowDiff: null,
        })
        const actions = [
            () => useGenerationStore.getState().setBasePrompt('updated prompt'),
            () => useGenerationStore.getState().setSteps(32),
            () => useGenerationStore.getState().setSelectedResolution({ label: 'Square', width: 1024, height: 1024 }),
            () => useGenerationStore.getState().setSourceImage('data:image/png;base64,synthetic'),
        ]

        for (const action of actions) {
            seedResolvedState()
            action()
            expectUnresolved()
        }
    })
})
