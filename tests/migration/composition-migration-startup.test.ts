import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { mergeLegacyLocalStorageAliases } from '@/lib/composition-migration-startup'
import { runStartupCompositionMigration } from '@/lib/composition-migration-startup'
import {
    compositionMigrationSourceHash,
    runCompositionMigrationTransaction,
    type CompositionMigrationSourceSnapshot,
} from '@/lib/composition-migration-runtime'
import {
    CompositionRepository,
    type CompositionRepositoryStorage,
} from '@/domain/composition/repository'
import {
    getRuntimeCompositionAuthority,
    setRuntimeCompositionAuthority,
} from '@/lib/composition-authority'

describe('startup legacy source capture', () => {
    it('rehydrates every composition-connected store after migration and before rendering', () => {
        const mainSource = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8')
        const assetResolverSource = readFileSync(
            new URL('../../src/lib/asset-modules/resolver.ts', import.meta.url),
            'utf8',
        )
        const migrationIndex = mainSource.indexOf('await runStartupCompositionMigration(')
        const hydrationIndex = mainSource.indexOf('await rehydrateCompositionConnectedStores()')
        const renderIndex = mainSource.lastIndexOf('\n    await renderApp()')

        expect(migrationIndex).toBeGreaterThan(-1)
        expect(hydrationIndex).toBeGreaterThan(migrationIndex)
        expect(renderIndex).toBeGreaterThan(hydrationIndex)
        expect(mainSource).not.toMatch(/^import App from/m)
        expect(mainSource).not.toMatch(/^import .*['"]\.\/stores\//m)
        expect(mainSource).not.toMatch(/^import .*composition-migration-startup/m)
        expect(mainSource).toContain('authorityObservation?.fallbackReason')
        expect(mainSource).toContain("code: 'E_COMPOSITION_AUTHORITY_FALLBACK'")
        expect(assetResolverSource).not.toMatch(/^import .*fragment-processor/m)
        expect(assetResolverSource).toContain("await import('@/lib/fragment-processor')")
        for (const storeName of [
            'useGenerationStore',
            'useSceneStore',
            'useCharacterPromptStore',
            'useFragmentStore',
            'usePresetStore',
            'useAssetModuleStore',
            'useCharacterStore',
        ]) {
            expect(mainSource).toContain(`${storeName}.persist.rehydrate()`)
        }
    })

    it('keeps startup-only Asset Profile load timestamps out of the migration source', () => {
        const storeSource = readFileSync(
            new URL('../../src/stores/asset-module-store.ts', import.meta.url),
            'utf8',
        )
        const partialize = storeSource.slice(storeSource.indexOf('partialize: (state) => ({'))

        expect(partialize).not.toContain('lastLoadedAt: state.lastLoadedAt')
        expect(partialize).toContain('profile: state.profile')
        expect(partialize).toContain('lastDiskMtimeMs: state.lastDiskMtimeMs')
    })

    it('non-destructively includes old prompt-editor and scene aliases', () => {
        const local = new Map<string, string>([
            ['novelaiPromptEditorState', '{"tabs":[{"id":"old-tab"}]}'],
            ['scene-store', '{"state":{"presets":[{"id":"old-scenes"}]}}'],
            ['nais2-scenes', '{"state":{"presets":[{"id":"local-canonical"}]}}'],
        ])
        const indexed = {
            'nais2-scenes': '{"state":{"presets":[{"id":"indexed-canonical"}]}}',
        }

        const merged = mergeLegacyLocalStorageAliases(indexed, key => local.get(key) ?? null)

        expect(merged.novelaiPromptEditorState).toContain('old-tab')
        expect(merged['scene-store']).toContain('old-scenes')
        expect(merged['nais2-scenes']).toBe(indexed['nais2-scenes'])
        expect(local.has('novelaiPromptEditorState')).toBe(true)
        expect(local.has('scene-store')).toBe(true)
    })

    it('propagates local source read failures so v2 activation fails closed', () => {
        expect(() => mergeLegacyLocalStorageAliases({}, () => {
            throw new Error('storage denied')
        })).toThrow('storage denied')
    })

    it('recommits after compatibility materialization until the startup source hash is stable', async () => {
        const values = new Map<string, string>()
        const storage: CompositionRepositoryStorage = {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => { values.set(key, value) },
        }
        const source: CompositionMigrationSourceSnapshot = {
            serializedStores: {
                'nais2-scenes': JSON.stringify({ state: { presets: [] }, version: 1 }),
            },
            wildcardContent: {},
        }
        let materializations = 0
        const callbackStates: Array<{ authority: string; locked: boolean }> = []
        const repository = new CompositionRepository(storage)
        const result = await runStartupCompositionMigration({
            now: '2026-07-12T00:00:00.000Z',
            clock: () => '2026-07-12T00:00:00.000Z',
            authority: 'legacy',
            storage,
            source,
            materializeSidecars: async () => {
                const callbackState = await repository.read('2026-07-12T00:00:00.000Z')
                callbackStates.push({
                    authority: callbackState.authority,
                    locked: callbackState.migrationLock !== undefined,
                })
                materializations += 1
                source.serializedStores['scene-prompts'] ??= JSON.stringify({ prompts: {} })
            },
        })

        expect(result.error).toBeUndefined()
        expect(result.status).toBe('committed')
        expect(materializations).toBe(2)
        expect(result.sourceHash).toBe(compositionMigrationSourceHash(source))
        expect(result.marker?.sourceHash).toBe(result.sourceHash)
        expect(result.authority).toBe('legacy')
        expect(callbackStates).toEqual([
            { authority: 'legacy', locked: true },
            { authority: 'legacy', locked: true },
        ])
    })

    it('keeps first-migration authority legacy when post-commit materialization fails', async () => {
        const values = new Map<string, string>()
        const storage: CompositionRepositoryStorage = {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => { values.set(key, value) },
        }
        const source: CompositionMigrationSourceSnapshot = {
            serializedStores: {
                'nais2-scenes': JSON.stringify({ state: { presets: [] }, version: 1 }),
            },
            wildcardContent: {},
        }
        const repository = new CompositionRepository(storage)

        const result = await runStartupCompositionMigration({
            now: '2026-07-12T00:00:00.000Z',
            clock: () => '2026-07-12T00:00:00.000Z',
            authority: 'v2',
            storage,
            source,
            materializeSidecars: async () => {
                const duringMaterialization = await repository.read('2026-07-12T00:00:00.000Z')
                expect(duringMaterialization.authority).toBe('legacy')
                expect(duringMaterialization.migrationLock).toBeDefined()
                expect(duringMaterialization.committedDocument).toBeDefined()
                throw new Error('injected sidecar write failure')
            },
        })

        expect(result.status).toBe('failed')
        expect(result.error).toContain('injected sidecar write failure')
        expect(result.completedSteps).toContain('atomic-commit')
        expect(result.completedSteps).toContain('temp-cleanup')
        expect(result.completedSteps).not.toContain('startup-reread')
        const afterFailure = await repository.read('2026-07-12T00:00:00.000Z')
        expect(afterFailure.authority).toBe('legacy')
        expect(afterFailure.migrationLock).toBeUndefined()
        expect(afterFailure.migrationMarker?.startupVerifiedAt).toBeUndefined()
        expect(getRuntimeCompositionAuthority()).toBe('legacy')
    })

    it('does not downgrade a winner that finalizes after a failed materializer loses its lease', async () => {
        const values = new Map<string, string>()
        const storage: CompositionRepositoryStorage = {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => { values.set(key, value) },
        }
        const source: CompositionMigrationSourceSnapshot = {
            serializedStores: {
                'nais2-scenes': JSON.stringify({ state: { presets: [] }, version: 1 }),
            },
            wildcardContent: {},
        }
        const repository = new CompositionRepository(storage)
        const startedAt = '2026-07-12T00:00:00.000Z'
        const takeoverAt = '2026-07-12T00:06:00.000Z'
        let runtimeNow = startedAt
        let winnerStatus: string | undefined
        const setItem = vi.fn()
        vi.stubGlobal('localStorage', {
            getItem: () => null,
            setItem,
        })
        try {
            const failed = await runStartupCompositionMigration({
                now: startedAt,
                clock: () => runtimeNow,
                authority: 'v2',
                storage,
                source,
                materializeSidecars: async () => {
                    runtimeNow = takeoverAt
                    const winner = await runStartupCompositionMigration({
                        now: takeoverAt,
                        clock: () => takeoverAt,
                        authority: 'v2',
                        storage,
                        source,
                        materializeSidecars: async () => undefined,
                    })
                    winnerStatus = winner.status
                    throw new Error('expired materializer failed after takeover')
                },
            })

            expect(winnerStatus).toBe('already-current')
            expect(failed.status).toBe('failed')
            expect(failed.authority).toBe('v2')
            const winnerState = await repository.read(takeoverAt)
            expect(winnerState.authority).toBe('v2')
            expect(winnerState.migrationLock).toBeUndefined()
            expect(winnerState.migrationMarker?.startupVerifiedAt).toBe(takeoverAt)
            expect(setItem).not.toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('keeps a validated restored repository v2 authority when no local flag exists', async () => {
        const values = new Map<string, string>()
        const storage: CompositionRepositoryStorage = {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => { values.set(key, value) },
        }
        const source: CompositionMigrationSourceSnapshot = {
            serializedStores: {
                'nais2-scenes': JSON.stringify({ state: { presets: [] }, version: 1 }),
            },
            wildcardContent: {},
        }
        const repository = new CompositionRepository(storage)
        const initial = await runCompositionMigrationTransaction({
            repository,
            storage,
            source,
            now: '2026-07-12T00:00:00.000Z',
            owner: 'restored-backup',
            activateAuthority: 'v2',
            registryVersion: 1,
            shadowResolve: () => ({ status: 'match', matches: true, fatal: false, differences: [] }),
        })
        expect(initial.status).toBe('committed')
        setRuntimeCompositionAuthority('legacy')

        const restarted = await runStartupCompositionMigration({
            now: '2026-07-12T00:00:00.000Z',
            clock: () => '2026-07-12T00:00:00.000Z',
            storage,
            source,
        })

        expect(restarted.status).toBe('already-current')
        expect(restarted.authority).toBe('v2')
        expect(getRuntimeCompositionAuthority()).toBe('v2')
    })

    it('does not downgrade a concurrent v2 migration winner or its feature flag', async () => {
        const values = new Map<string, string>()
        const storage: CompositionRepositoryStorage = {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => { values.set(key, value) },
        }
        const source: CompositionMigrationSourceSnapshot = {
            serializedStores: {
                'nais2-scenes': JSON.stringify({ state: { presets: [] }, version: 1 }),
            },
            wildcardContent: {},
        }
        const repository = new CompositionRepository(storage)
        await runCompositionMigrationTransaction({
            repository,
            storage,
            source,
            now: '2026-07-12T00:00:00.000Z',
            owner: 'winner',
            activateAuthority: 'v2',
            registryVersion: 1,
            shadowResolve: () => ({ status: 'match', matches: true, fatal: false, differences: [] }),
        })
        await repository.acquireMigrationLock({
            id: 'lock:winner-next-migration',
            owner: 'winner',
            now: '2026-07-12T00:00:00.000Z',
        })
        const setItem = vi.fn()
        vi.stubGlobal('localStorage', {
            getItem: () => 'v2',
            setItem,
        })
        try {
            const contender = await runStartupCompositionMigration({
                now: '2026-07-12T00:00:00.000Z',
                clock: () => '2026-07-12T00:00:00.000Z',
                storage,
                source,
            })

            expect(contender.status).toBe('failed')
            expect(contender.failureCode).toBe('E_MIGRATION_LOCKED')
            expect((await repository.read('2026-07-12T00:00:00.000Z')).authority).toBe('v2')
            expect(setItem).not.toHaveBeenCalled()
            expect(getRuntimeCompositionAuthority()).toBe('legacy')
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
