import { describe, expect, it } from 'vitest'

import { migrateLegacyStoresToV2 } from '@/domain/composition/migrations/legacy-stores-to-v2'
import {
    materializeCompositionMigrationSidecars,
    type CompositionMigrationMaterializationDependencies,
} from '@/lib/composition-migration-materialization'
import type { CompositionMigrationSourceSnapshot } from '@/lib/composition-migration-runtime'

function createRollbackFixture() {
    const scenes = {
        state: {
            activePresetId: 'preset:rollback',
            presets: [{
                id: 'preset:rollback',
                name: 'Rollback',
                createdAt: 1,
                scenes: [{
                    id: 'scene:rollback',
                    name: 'Rollback scene',
                    scenePrompt: 'old scene prompt',
                    queueCount: 1,
                    images: [{ id: 'image:exact', url: 'data:image/png;base64,EXACT_BYTES', timestamp: 2 }],
                    createdAt: 2,
                }],
            }],
        },
        version: 1,
    }
    const characters = {
        state: {
            characters: [{
                id: 'character:rollback',
                name: 'Hero',
                prompt: 'old hero',
                negative: '',
                enabled: true,
                position: { x: 0.5, y: 0.5 },
            }],
            presets: [],
            groups: [],
        },
        version: 2,
    }
    const fragments = {
        state: {
            files: [{
                id: 'fragment:rollback',
                contentKey: 'content:rollback',
                name: 'rollback.txt',
                folder: '',
                lineCount: 1,
            }],
        },
        version: 0,
    }
    const promptPresets = {
        state: {
            tabs: [{
                id: 'tab:rollback',
                name: 'Rollback prompts',
                windows: [{ id: 'window:rollback', title: 'Old', text: 'old prompt', excluded: false }],
            }],
            activeLeftId: 'tab:rollback',
            activeRightId: null,
        },
        version: 0,
    }
    const assetProfile = {
        revision: 7,
        updatedAt: '2025-01-01T00:00:00.000Z',
        updatedBy: 'legacy-import',
        settings: {},
        output: {},
        r2: { enabled: false },
        modules: {},
        recipes: [],
    }
    const migrated = migrateLegacyStoresToV2({
        scenes,
        scenePrompts: { 'scene:rollback': 'migrated scene prompt' },
        characterPrompts: characters,
        characterPositions: {
            positions: { 'character:rollback': { x: 0.25, y: 0.75 } },
            positionEnabled: true,
        },
        fragments,
        fragmentContent: { 'content:rollback': ['fragment line'] },
        promptPresets,
        assetProfileJson: assetProfile,
    })
    const source: CompositionMigrationSourceSnapshot = {
        serializedStores: {
            'asset-profile': JSON.stringify(assetProfile),
            'nais2-scenes': JSON.stringify(scenes),
            'nais2-character-prompts': JSON.stringify(characters),
            'nais2-wildcards': JSON.stringify(fragments),
        },
        wildcardContent: { 'preexisting-content': ['do not change'] },
    }
    return { migrated, source }
}

function recordSnapshot(values: Map<string, string>): Record<string, string> {
    return Object.fromEntries([...values.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

describe('legacy compatibility sidecar materialization', () => {
    it('hydrates auxiliary aliases without moving Scene image bytes or deleting raw sources', async () => {
        const scenes = {
            state: {
                activePresetId: 'preset:old',
                presets: [{
                    id: 'preset:old',
                    name: 'Old',
                    createdAt: 1,
                    scenes: [{
                        id: 'scene:old',
                        name: 'Scene',
                        scenePrompt: '',
                        queueCount: 0,
                        images: [{ id: 'image:kept', url: 'data:image/png;base64,KEEP', timestamp: 1 }],
                        createdAt: 2,
                    }],
                }],
            },
            version: 1,
        }
        const characters = {
            state: {
                characters: [{
                    id: 'character:old',
                    name: 'Hero',
                    prompt: 'hero',
                    negative: '',
                    enabled: true,
                    position: { x: 0.5, y: 0.5 },
                }],
                presets: [],
                groups: [],
            },
            version: 2,
        }
        const fragments = {
            state: {
                files: [{
                    id: 'fragment:old',
                    contentKey: 'legacy-content-key',
                    name: 'mood.txt',
                    folder: '',
                    lineCount: 1,
                }],
            },
            version: 0,
        }
        const promptPresets = {
            state: {
                tabs: [{
                    id: 'tab:old',
                    name: 'Old prompts',
                    windows: [{ id: 'window:old', title: 'Keep', text: 'prompt text', excluded: false }],
                }],
                activeLeftId: 'tab:old',
                activeRightId: null,
            },
            version: 0,
        }
        const assetProfile = {
            revision: 5,
            updatedAt: '2025-01-01T00:00:00.000Z',
            updatedBy: 'legacy-import',
            settings: {},
            output: {},
            r2: { enabled: false },
            modules: {},
            recipes: [],
        }
        const input = {
            scenes,
            scenePrompts: { 'scene:old': 'separate scene prompt' },
            characterPrompts: characters,
            characterPositions: {
                positions: { 'character:old': { x: 0, y: 1 } },
                positionEnabled: true,
            },
            fragments,
            fragmentContent: { 'legacy-content-key': ['kept fragment line'] },
            promptPresets,
            assetProfileJson: assetProfile,
        }
        const migrated = migrateLegacyStoresToV2(input)
        expect(migrated.report.fatal).toBe(false)

        const values = new Map<string, string>([
            ['nais2-scenes', JSON.stringify(scenes)],
            ['nais2-character-prompts', JSON.stringify(characters)],
            ['nais2-wildcards', JSON.stringify(fragments)],
        ])
        let wildcardContent: Record<string, string[]> = {}
        let seededAssetProfile: string | undefined
        let assetProfileFile = {
            exists: false,
            path: 'asset-profiles/default.json',
            rawJson: null as string | null,
        }
        const dependencies: CompositionMigrationMaterializationDependencies = {
            getItem: async key => values.get(key) ?? null,
            compareAndSetItem: async (key, expected, replacement) => {
                if ((values.get(key) ?? null) !== expected) return false
                if (replacement === null) values.delete(key)
                else values.set(key, replacement)
                return true
            },
            getWildcardContent: async () => structuredClone(wildcardContent),
            replaceWildcardContent: async (expected, content) => {
                if (JSON.stringify(wildcardContent) !== JSON.stringify(expected)) return false
                wildcardContent = structuredClone(content)
                return true
            },
            readAssetProfile: async () => ({ ...assetProfileFile }),
            seedAssetProfileIfMissing: async raw => {
                if (assetProfileFile.exists) return false
                seededAssetProfile = raw
                assetProfileFile = { ...assetProfileFile, exists: true, rawJson: raw }
                return true
            },
            restoreAssetProfilePreimage: async snapshot => {
                assetProfileFile = { ...snapshot }
            },
        }
        const source: CompositionMigrationSourceSnapshot = {
            serializedStores: {
                'asset-profile': JSON.stringify(assetProfile),
                'nais2-scenes': JSON.stringify(scenes),
                'nais2-character-prompts': JSON.stringify(characters),
                'nais2-wildcards': JSON.stringify(fragments),
            },
            wildcardContent: {},
        }

        await materializeCompositionMigrationSidecars({
            source,
            document: migrated.document,
            sidecars: migrated.sidecars,
        }, dependencies)

        const restoredScenes = JSON.parse(values.get('nais2-scenes') ?? 'null') as typeof scenes
        expect(restoredScenes.state.presets[0].scenes[0]).toMatchObject({
            id: 'scene:old',
            scenePrompt: 'separate scene prompt',
            images: [{ id: 'image:kept', url: 'data:image/png;base64,KEEP' }],
        })
        const restoredCharacters = JSON.parse(values.get('nais2-character-prompts') ?? 'null') as typeof characters
        expect(restoredCharacters.state).toMatchObject({
            positionEnabled: true,
            characters: [{ id: 'character:old', position: { x: 0, y: 1 } }],
        })
        const fragmentMeta = migrated.sidecars.fragments.meta[0]
        expect(wildcardContent[fragmentMeta.contentKey]).toEqual(['kept fragment line'])
        expect(JSON.parse(values.get('nais2-prompt-library') ?? 'null')).toMatchObject({
            state: { tabs: [{ id: 'tab:old' }] },
        })
        expect(JSON.parse(seededAssetProfile ?? 'null')).toEqual(assetProfile)
        expect(input.scenePrompts).toEqual({ 'scene:old': 'separate scene prompt' })
        expect(input.characterPositions).toEqual({
            positions: { 'character:old': { x: 0, y: 1 } },
            positionEnabled: true,
        })

        const concurrentSceneEdit = JSON.stringify({
            state: { presets: [{ id: 'concurrent', scenes: [] }] },
            version: 1,
        })
        values.set('nais2-scenes', concurrentSceneEdit)
        await expect(materializeCompositionMigrationSidecars({
            source,
            document: migrated.document,
            sidecars: migrated.sidecars,
        }, dependencies)).rejects.toThrow('source changed for nais2-scenes')
        expect(values.get('nais2-scenes')).toBe(concurrentSceneEdit)
    })

    it('restores every IDB, wildcard, and file preimage when file seeding mutates and then fails', async () => {
        const { migrated, source } = createRollbackFixture()
        expect(migrated.report.fatal).toBe(false)

        const values = new Map(Object.entries(source.serializedStores))
        const beforeValues = recordSnapshot(values)
        let wildcardContent = structuredClone(source.wildcardContent)
        const beforeWildcardContent = structuredClone(wildcardContent)
        let assetProfileFile = {
            exists: false,
            path: 'asset-profiles/default.json',
            rawJson: null as string | null,
        }
        const dependencies: CompositionMigrationMaterializationDependencies = {
            getItem: async key => values.get(key) ?? null,
            compareAndSetItem: async (key, expected, replacement) => {
                if ((values.get(key) ?? null) !== expected) return false
                if (replacement === null) values.delete(key)
                else values.set(key, replacement)
                return true
            },
            getWildcardContent: async () => structuredClone(wildcardContent),
            replaceWildcardContent: async (expected, replacement) => {
                if (JSON.stringify(wildcardContent) !== JSON.stringify(expected)) return false
                wildcardContent = structuredClone(replacement)
                return true
            },
            readAssetProfile: async () => ({ ...assetProfileFile }),
            seedAssetProfileIfMissing: async rawJson => {
                assetProfileFile = { ...assetProfileFile, exists: true, rawJson }
                throw new Error('injected file failure after rename')
            },
            restoreAssetProfilePreimage: async snapshot => {
                assetProfileFile = { ...snapshot }
            },
        }

        await expect(materializeCompositionMigrationSidecars({
            source,
            document: migrated.document,
            sidecars: migrated.sidecars,
        }, dependencies)).rejects.toThrow('injected file failure after rename')

        expect(recordSnapshot(values)).toEqual(beforeValues)
        expect(wildcardContent).toEqual(beforeWildcardContent)
        expect(assetProfileFile).toEqual({
            exists: false,
            path: 'asset-profiles/default.json',
            rawJson: null,
        })
        expect(JSON.parse(values.get('nais2-scenes') ?? 'null')).toEqual(
            JSON.parse(source.serializedStores['nais2-scenes']),
        )
        expect(values.get('nais2-scenes')).toContain('data:image/png;base64,EXACT_BYTES')
    })

    it('retains a concurrently created Asset Profile when a missing-file seed loses the race', async () => {
        const { migrated, source } = createRollbackFixture()
        const values = new Map(Object.entries(source.serializedStores))
        const beforeValues = recordSnapshot(values)
        let wildcardContent = structuredClone(source.wildcardContent)
        const beforeWildcardContent = structuredClone(wildcardContent)
        const missingPreimage = {
            exists: false,
            path: 'asset-profiles/default.json',
            rawJson: null as string | null,
        }
        const concurrentRaw = JSON.stringify({
            revision: 99,
            updatedBy: 'concurrent-writer',
            modules: {},
            recipes: [],
        })
        let assetProfileFile = { ...missingPreimage }
        let restoreCalls = 0
        const dependencies: CompositionMigrationMaterializationDependencies = {
            getItem: async key => values.get(key) ?? null,
            compareAndSetItem: async (key, expected, replacement) => {
                if ((values.get(key) ?? null) !== expected) return false
                if (replacement === null) values.delete(key)
                else values.set(key, replacement)
                return true
            },
            getWildcardContent: async () => structuredClone(wildcardContent),
            replaceWildcardContent: async (expected, replacement) => {
                if (JSON.stringify(wildcardContent) !== JSON.stringify(expected)) return false
                wildcardContent = structuredClone(replacement)
                return true
            },
            readAssetProfile: async () => ({ ...assetProfileFile }),
            seedAssetProfileIfMissing: async () => {
                assetProfileFile = {
                    exists: true,
                    path: missingPreimage.path,
                    rawJson: concurrentRaw,
                }
                return false
            },
            restoreAssetProfilePreimage: async snapshot => {
                restoreCalls += 1
                assetProfileFile = { ...snapshot }
                return true
            },
        }

        await expect(materializeCompositionMigrationSidecars({
            source,
            document: migrated.document,
            sidecars: migrated.sidecars,
        }, dependencies)).rejects.toThrow('conflict for Asset Profile file')

        expect(restoreCalls).toBe(0)
        expect(assetProfileFile).toEqual({
            exists: true,
            path: missingPreimage.path,
            rawJson: concurrentRaw,
        })
        expect(recordSnapshot(values)).toEqual(beforeValues)
        expect(wildcardContent).toEqual(beforeWildcardContent)
    })

    it('retains and reports Asset Profile drift that occurs after a successful seed', async () => {
        const { migrated, source } = createRollbackFixture()
        const values = new Map(Object.entries(source.serializedStores))
        const beforeValues = recordSnapshot(values)
        let wildcardContent = structuredClone(source.wildcardContent)
        const beforeWildcardContent = structuredClone(wildcardContent)
        const missingPreimage = {
            exists: false,
            path: 'asset-profiles/default.json',
            rawJson: null as string | null,
        }
        const concurrentRaw = JSON.stringify({
            revision: 100,
            updatedBy: 'concurrent-writer-after-seed',
            modules: {},
            recipes: [],
        })
        let assetProfileFile = { ...missingPreimage }
        let readCount = 0
        let restoreCalls = 0
        const dependencies: CompositionMigrationMaterializationDependencies = {
            getItem: async key => values.get(key) ?? null,
            compareAndSetItem: async (key, expected, replacement) => {
                if ((values.get(key) ?? null) !== expected) return false
                if (replacement === null) values.delete(key)
                else values.set(key, replacement)
                return true
            },
            getWildcardContent: async () => structuredClone(wildcardContent),
            replaceWildcardContent: async (expected, replacement) => {
                if (JSON.stringify(wildcardContent) !== JSON.stringify(expected)) return false
                wildcardContent = structuredClone(replacement)
                return true
            },
            readAssetProfile: async () => {
                readCount += 1
                if (readCount === 2) {
                    assetProfileFile = {
                        exists: true,
                        path: missingPreimage.path,
                        rawJson: concurrentRaw,
                    }
                }
                return { ...assetProfileFile }
            },
            seedAssetProfileIfMissing: async rawJson => {
                assetProfileFile = {
                    exists: true,
                    path: missingPreimage.path,
                    rawJson,
                }
                return true
            },
            restoreAssetProfilePreimage: async (snapshot, expectedPostimage) => {
                restoreCalls += 1
                if (
                    assetProfileFile.exists !== expectedPostimage.exists
                    || assetProfileFile.rawJson !== expectedPostimage.rawJson
                ) {
                    return false
                }
                assetProfileFile = { ...snapshot }
                return true
            },
        }

        await expect(materializeCompositionMigrationSidecars({
            source,
            document: migrated.document,
            sidecars: migrated.sidecars,
        }, dependencies)).rejects.toThrow(
            'Migration materialization failed and rollback was incomplete',
        )

        expect(restoreCalls).toBe(1)
        expect(assetProfileFile).toEqual({
            exists: true,
            path: missingPreimage.path,
            rawJson: concurrentRaw,
        })
        expect(recordSnapshot(values)).toEqual(beforeValues)
        expect(wildcardContent).toEqual(beforeWildcardContent)
    })

    it('restores every earlier source when an IDB CAS throws after making its write visible', async () => {
        const { migrated, source } = createRollbackFixture()
        const values = new Map(Object.entries(source.serializedStores))
        const beforeValues = recordSnapshot(values)
        let wildcardContent = structuredClone(source.wildcardContent)
        let failPromptLibraryWrite = true
        const missingAssetProfile = {
            exists: false,
            path: 'asset-profiles/default.json',
            rawJson: null,
        }
        const dependencies: CompositionMigrationMaterializationDependencies = {
            getItem: async key => values.get(key) ?? null,
            compareAndSetItem: async (key, expected, replacement) => {
                if ((values.get(key) ?? null) !== expected) return false
                if (replacement === null) values.delete(key)
                else values.set(key, replacement)
                if (key === 'nais2-prompt-library' && failPromptLibraryWrite) {
                    failPromptLibraryWrite = false
                    throw new Error('injected IDB failure after commit')
                }
                return true
            },
            getWildcardContent: async () => structuredClone(wildcardContent),
            replaceWildcardContent: async (expected, replacement) => {
                if (JSON.stringify(wildcardContent) !== JSON.stringify(expected)) return false
                wildcardContent = structuredClone(replacement)
                return true
            },
            readAssetProfile: async () => ({ ...missingAssetProfile }),
            seedAssetProfileIfMissing: async () => true,
            restoreAssetProfilePreimage: async () => undefined,
        }

        await expect(materializeCompositionMigrationSidecars({
            source,
            document: migrated.document,
            sidecars: migrated.sidecars,
        }, dependencies)).rejects.toThrow('injected IDB failure after commit')

        expect(recordSnapshot(values)).toEqual(beforeValues)
        expect(wildcardContent).toEqual(source.wildcardContent)
        expect(values.has('nais2-prompt-library')).toBe(false)
    })

    it('rolls back IDB and wildcard mutations when wildcard replacement throws after commit', async () => {
        const { migrated, source } = createRollbackFixture()
        const values = new Map(Object.entries(source.serializedStores))
        const beforeValues = recordSnapshot(values)
        let wildcardContent = structuredClone(source.wildcardContent)
        let failNextWildcardWrite = true
        let assetProfileFile = {
            exists: false,
            path: 'asset-profiles/default.json',
            rawJson: null as string | null,
        }
        const dependencies: CompositionMigrationMaterializationDependencies = {
            getItem: async key => values.get(key) ?? null,
            compareAndSetItem: async (key, expected, replacement) => {
                if ((values.get(key) ?? null) !== expected) return false
                if (replacement === null) values.delete(key)
                else values.set(key, replacement)
                return true
            },
            getWildcardContent: async () => structuredClone(wildcardContent),
            replaceWildcardContent: async (expected, replacement) => {
                if (JSON.stringify(wildcardContent) !== JSON.stringify(expected)) return false
                wildcardContent = structuredClone(replacement)
                if (failNextWildcardWrite) {
                    failNextWildcardWrite = false
                    throw new Error('injected wildcard failure after commit')
                }
                return true
            },
            readAssetProfile: async () => ({ ...assetProfileFile }),
            seedAssetProfileIfMissing: async rawJson => {
                assetProfileFile = { ...assetProfileFile, exists: true, rawJson }
                return true
            },
            restoreAssetProfilePreimage: async snapshot => {
                assetProfileFile = { ...snapshot }
            },
        }

        await expect(materializeCompositionMigrationSidecars({
            source,
            document: migrated.document,
            sidecars: migrated.sidecars,
        }, dependencies)).rejects.toThrow('injected wildcard failure after commit')

        expect(recordSnapshot(values)).toEqual(beforeValues)
        expect(wildcardContent).toEqual(source.wildcardContent)
        expect(assetProfileFile.exists).toBe(false)
    })

    it('rejects late source drift, rolls back preceding writes, and never adopts the fresh value as CAS expected', async () => {
        const { migrated, source } = createRollbackFixture()
        const values = new Map(Object.entries(source.serializedStores))
        const originalSceneRaw = values.get('nais2-scenes') ?? null
        const concurrentCharacterRaw = JSON.stringify({
            state: { characters: [{ id: 'concurrent-character', prompt: 'concurrent' }] },
            version: 2,
        })
        const casExpectations: Array<{ key: string; expected: string | null }> = []
        let injectedDrift = false
        let wildcardContent = structuredClone(source.wildcardContent)
        const missingAssetProfile = {
            exists: false,
            path: 'asset-profiles/default.json',
            rawJson: null,
        }
        const dependencies: CompositionMigrationMaterializationDependencies = {
            getItem: async key => {
                if (key === 'nais2-character-prompts' && !injectedDrift) {
                    injectedDrift = true
                    values.set(key, concurrentCharacterRaw)
                }
                return values.get(key) ?? null
            },
            compareAndSetItem: async (key, expected, replacement) => {
                casExpectations.push({ key, expected })
                if ((values.get(key) ?? null) !== expected) return false
                if (replacement === null) values.delete(key)
                else values.set(key, replacement)
                return true
            },
            getWildcardContent: async () => structuredClone(wildcardContent),
            replaceWildcardContent: async (expected, replacement) => {
                if (JSON.stringify(wildcardContent) !== JSON.stringify(expected)) return false
                wildcardContent = structuredClone(replacement)
                return true
            },
            readAssetProfile: async () => ({ ...missingAssetProfile }),
            seedAssetProfileIfMissing: async () => true,
            restoreAssetProfilePreimage: async () => undefined,
        }

        await expect(materializeCompositionMigrationSidecars({
            source,
            document: migrated.document,
            sidecars: migrated.sidecars,
        }, dependencies)).rejects.toThrow('source changed for nais2-character-prompts')

        expect(values.get('nais2-scenes') ?? null).toBe(originalSceneRaw)
        expect(values.get('nais2-character-prompts')).toBe(concurrentCharacterRaw)
        expect(casExpectations[0]).toEqual({
            key: 'nais2-scenes',
            expected: source.serializedStores['nais2-scenes'],
        })
        expect(casExpectations.at(-1)).toMatchObject({ key: 'nais2-scenes' })
        expect(wildcardContent).toEqual(source.wildcardContent)
    })
})
