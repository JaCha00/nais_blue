import { describe, expect, it } from 'vitest'

import { safeParseCompositionDocument } from '@/domain/composition/schema'
import {
    migrateLegacyStoresToV2,
    type LegacyStoresMigrationInput,
} from '@/domain/composition/migrations/legacy-stores-to-v2'

const ASSET_PROFILE = {
    revision: 7,
    updatedBy: 'gui',
    updatedAt: '2026-06-01T02:03:04.000Z',
    settings: { steps: 30, legacyRootFlag: 'keep' },
    output: {},
    r2: { enabled: false },
    modules: {
        portrait: {
            id: 'module:portrait',
            enabled: true,
            kind: 'prompt',
            target: 'v4.char.0.positive',
            prompt: 'asset character prompt',
            settings: { cfgScale: 0, unknownModuleFlag: 'keep' },
        },
    },
    recipes: [{
        id: 'recipe:portrait',
        enabled: true,
        label: 'Portrait',
        steps: [{ moduleId: 'module:portrait', enabled: true }],
    }],
}

function completeLegacyInput(): LegacyStoresMigrationInput {
    return {
        indexedDbSnapshots: {
            'nais2-scenes': {
                state: {
                    activePresetId: null,
                    presets: [{
                        name: 'Scenes without an ID',
                        createdAt: 10,
                        scenes: [
                            {
                                id: 'scene:stable',
                                name: 'First',
                                scenePrompt: 'embedded scene prompt',
                                width: 512,
                                height: 768,
                                images: [{ id: 'image:retained-only-in-raw', url: 'data:image/png;base64,AAAA' }],
                                createdAt: 11,
                            },
                            {
                                id: 'scene:stable',
                                name: 'Duplicate',
                                scenePrompt: 'second scene',
                                createdAt: 12,
                            },
                        ],
                    }],
                },
                version: 0,
            },
            'nais2-scene-prompts': {
                'scene:stable': 'separate scene prompt',
            },
            'nais2-character-prompts': {
                state: {
                    positionEnabled: true,
                    characters: [
                        {
                            id: 'character:stable',
                            name: 'Stable',
                            prompt: 'hero',
                            negative: 'bad hands',
                            enabled: true,
                            position: { x: 0, y: 1 },
                        },
                        {
                            id: 'character:stable',
                            name: 'Duplicate',
                            prompt: 'sidekick',
                            negative: '',
                            enabled: false,
                            position: { x: 0.25, y: 0.75 },
                        },
                        {
                            name: 'Display name is not an ID',
                            prompt: 'third',
                            negative: '',
                            enabled: true,
                            position: { x: 0.5, y: 0.5 },
                        },
                    ],
                    presets: [{ id: 'template:one', name: 'Template', prompt: 'p', negative: '', image: 'data:bytes' }],
                    groups: [{ id: 'group:one', name: 'Group', collapsed: false, colorIndex: 0 }],
                },
                version: 0,
            },
            'nais2-character-positions': {
                state: { positions: { 2: { x: 0.1, y: 0.2 } }, positionEnabled: true },
                version: 0,
            },
            'nais2-presets': {
                state: {
                    activePresetId: 'params:zero',
                    presets: [{
                        id: 'params:zero',
                        name: 'Zero and false',
                        basePrompt: 'preset base prompt',
                        steps: null,
                        cfgRescale: 0,
                        variety: false,
                        qualityToggle: false,
                        ucPreset: 0,
                        selectedResolution: { width: null, height: 640 },
                    }],
                },
                version: 0,
            },
            'nais2-prompt-library': {
                state: {
                    activeLeftId: 'tab:one',
                    tabs: [{
                        id: 'tab:one',
                        name: 'Prompts',
                        windows: [
                            { id: 'window:one', title: 'Keep', text: 'library prompt', excluded: false },
                            { id: 'window:one', title: 'Duplicate', text: 'disabled prompt', excluded: true },
                            { title: 'Missing ID', tags: ['one', 'two'], excluded: false },
                        ],
                    }],
                },
                version: 0,
            },
            'nais2-wildcards': {
                state: {
                    files: [
                        {
                            id: 'fragment:one',
                            name: 'one.txt',
                            folder: 'set',
                            content: ['stale'],
                            lineCount: 1,
                        },
                        {
                            id: 'fragment:one',
                            contentKey: 'fragment:two:content',
                            name: 'two.txt',
                            folder: 'set',
                            lineCount: 2,
                        },
                        {
                            name: 'missing.txt',
                            folder: 'set',
                            content: ['embedded-only'],
                        },
                    ],
                    sequentialCounters: { 'set/one.txt': 2 },
                },
                version: 0,
            },
            'nais2-wildcard-content': {
                stores: {
                    contents: {
                        'fragment:one': ['separate-authority'],
                        'fragment:two:content': ['alpha', 'beta'],
                    },
                },
            },
            'nais2-asset-modules': { state: { profile: ASSET_PROFILE }, version: 0 },
            'nais2-marketplace-cache': { stale: true },
            'nais2-future-v99': { future: true },
        },
    }
}

describe('legacy stores to CompositionDocument v2 migration', () => {
    it('creates a deterministic schema-valid empty authority', () => {
        const first = migrateLegacyStoresToV2({})
        const second = migrateLegacyStoresToV2({})

        expect(first).toEqual(second)
        expect(safeParseCompositionDocument(first.document).success).toBe(true)
        expect(first.report.fatal).toBe(false)
        expect(first.document.schemaVersion).toBe(2)
        expect(first.sidecars).toMatchObject({
            scenes: { presets: [], activePresetId: null },
            fragments: { schemaVersion: 2, meta: [], contents: {} },
            promptPresets: { tabs: [] },
        })
    })

    it('projects all supported legacy authorities without mutating raw sources', () => {
        const input = completeLegacyInput()
        const before = structuredClone(input)
        const result = migrateLegacyStoresToV2(input)

        expect(input).toEqual(before)
        expect(result.rawSources).toEqual(before)
        expect(result.rawSources).not.toBe(input)
        expect(result.report.fatal).toBe(false)
        expect(safeParseCompositionDocument(result.document).success).toBe(true)

        expect(result.document.revision).toBe(7)
        expect(result.document.updatedAt).toBe('2026-06-01T02:03:04.000Z')
        expect(result.document.updatedBy).toMatchObject({ kind: 'user' })
        expect(result.document.modules.some(module => module.id === 'module:portrait')).toBe(true)
        expect(result.document.recipes.some(recipe => recipe.id === 'recipe:portrait')).toBe(true)

        expect(result.document.characters[0]).toMatchObject({
            id: 'character:stable',
            positivePrompt: 'hero',
            negativePrompt: 'bad hands',
            position: { mode: 'manual', x: 0, y: 1 },
        })
        expect(result.document.characters[1].id).toMatch(/^character:migrated:/)
        expect(result.document.characters[2].id).toMatch(/^character:migrated:/)
        expect(result.document.characters[2].id).not.toContain('Display name')
        expect(result.document.characters[2].position).toEqual({ mode: 'manual', x: 0.1, y: 0.2 })
        expect(JSON.stringify(result.document)).not.toContain('data:image')
        expect(JSON.stringify(result.document)).not.toContain('data:bytes')
        expect(JSON.stringify(result.document)).not.toContain('image:retained-only-in-raw')
        expect(JSON.stringify(result.rawSources)).toContain('data:image/png;base64,AAAA')
        expect(JSON.stringify(result.rawSources)).toContain('data:bytes')

        const zeroPreset = result.document.paramsPresets.find(preset => preset.id === 'params:zero')
        expect(zeroPreset?.params).toMatchObject({
            cfgRescale: 0,
            variety: false,
            qualityToggle: false,
            ucPreset: 0,
            height: 640,
        })
        expect(zeroPreset?.params.steps).toBe(28)
        expect(zeroPreset?.params.width).toBe(832)
        expect(zeroPreset?.extensions).toMatchObject({
            legacyPromptTemplate: { base: 'preset base prompt' },
        })
        expect(result.document.profiles[0].defaultParamsPresetId).toBe('params:zero')

        expect(result.sidecars.scenes.presets[0].id).toMatch(/^scene-preset:migrated:/)
        expect(result.sidecars.scenes.presets[0].scenes[0]).toMatchObject({
            id: 'scene:stable',
            scenePrompt: 'separate scene prompt',
            width: 512,
            height: 768,
            extensions: { retainedImageCount: 1 },
        })
        expect(result.sidecars.scenes.presets[0].scenes[1].id).toMatch(/^scene:migrated:/)
        expect(result.document.modules).toContainEqual(expect.objectContaining({
            extensions: { legacyScene: expect.objectContaining({ sceneId: 'scene:stable' }) },
        }))

        const firstFragment = result.sidecars.fragments.meta.find(meta => meta.id === 'fragment:one')
        expect(firstFragment?.lineCount).toBe(1)
        expect(result.sidecars.fragments.contents['fragment:one']).toEqual(['separate-authority'])
        expect(result.sidecars.fragments.sequenceState.counters['fragment:one']).toBe(2)
        const secondFragment = result.sidecars.fragments.meta.find(meta => meta.name === 'two.txt')
        expect(secondFragment?.id).toMatch(/^fragment:migrated:/)
        expect(result.sidecars.fragments.contents[secondFragment?.id ?? '']).toEqual(['alpha', 'beta'])
        expect(result.sidecars.fragments.meta.find(meta => meta.name === 'missing.txt')?.id)
            .toMatch(/^fragment:migrated:/)

        expect(result.sidecars.promptPresets.tabs[0].windows.map(window => window.id)).toEqual([
            'window:one',
            expect.stringMatching(/^prompt-window:migrated:/),
            expect.stringMatching(/^prompt-window:migrated:/),
        ])
        expect(result.document.modules).toContainEqual(expect.objectContaining({
            name: 'Missing ID',
            contributions: [expect.objectContaining({ text: 'one, two' })],
        }))

        expect(result.report.ignoredKeys).toEqual(['nais2-future-v99', 'nais2-marketplace-cache'])
        expect(result.report.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'M_LEGACY_REMOTE_KEY_IGNORED', severity: 'info' }),
            expect.objectContaining({ code: 'M_UNKNOWN_STORE_RETAINED', severity: 'info' }),
            expect.objectContaining({ code: 'M_FRAGMENT_SEPARATE_CONTENT_PREFERRED' }),
        ]))
    })

    it('does not recursively preserve its own Scene compatibility reference', () => {
        const first = migrateLegacyStoresToV2(completeLegacyInput())
        const materialized = first.sidecars.scenes
        const second = migrateLegacyStoresToV2({
            indexedDbSnapshots: {
                'nais2-scenes': {
                    state: {
                        presets: materialized.presets,
                        activePresetId: materialized.activePresetId,
                    },
                    version: 1,
                },
            },
        })

        expect(second.sidecars.scenes.presets[0].scenes[0].compositionRef.recipeId)
            .toBe(first.sidecars.scenes.presets[0].scenes[0].compositionRef.recipeId)
        expect(JSON.stringify(second.sidecars.scenes)).not.toContain('previousCompositionRef')
    })

    it('is idempotent and does not derive generated IDs from display names', () => {
        const input = completeLegacyInput()
        const first = migrateLegacyStoresToV2(input)
        const second = migrateLegacyStoresToV2(structuredClone(input))
        expect(second).toEqual(first)

        const renamed = structuredClone(input)
        const snapshots = renamed.indexedDbSnapshots as Record<string, { state?: Record<string, unknown> }>
        const characterState = snapshots['nais2-character-prompts'].state as {
            characters: Array<Record<string, unknown>>
        }
        characterState.characters[2].name = 'A completely different display label'
        const renamedResult = migrateLegacyStoresToV2(renamed)
        expect(renamedResult.document.characters[2].id).toBe(first.document.characters[2].id)
    })

    it('supports old prompt editor and explicit separate fragment DB snapshot shapes', () => {
        const result = migrateLegacyStoresToV2({
            fragments: {
                files: [{ name: 'legacy.txt', contentKey: 'legacy-content', lineCount: 1 }],
            },
            indexedDbSnapshots: [{
                dbName: 'nais2-wildcard-content',
                objectStores: { contents: { 'legacy-content': ['from-separate-db'] } },
            }],
            promptPresets: {
                globalTabs: [{ id: 'old-tab', name: 'Old editor' }],
                tabPanes: {
                    'old-tab': {
                        promptWindows: [{ id: 'old-window', title: 'Old', tags: ['a', 'b'], isExcluded: false }],
                    },
                },
                activeLeftTabId: 'old-tab',
            },
            assetProfileJson: JSON.stringify(ASSET_PROFILE),
        })

        expect(result.report.fatal).toBe(false)
        const id = result.sidecars.fragments.meta[0].id
        expect(result.sidecars.fragments.contents[id]).toEqual(['from-separate-db'])
        expect(result.sidecars.promptPresets).toMatchObject({
            activeLeftId: 'old-tab',
            tabs: [{ id: 'old-tab', windows: [{ id: 'old-window', text: 'a, b' }] }],
        })
        expect(result.document.modules.some(module => module.id === 'module:portrait')).toBe(true)
    })

    it('marks malformed persisted JSON fatal while retaining it for rollback', () => {
        const input = { stores: { 'nais2-scenes': '{broken-json' } }
        const result = migrateLegacyStoresToV2(input)

        expect(result.report.fatal).toBe(true)
        expect(result.report.issues).toContainEqual(expect.objectContaining({
            code: 'M_INVALID_SOURCE_JSON',
            severity: 'fatal',
            path: ['scenes'],
        }))
        expect(result.rawSources).toEqual(input)
        expect(safeParseCompositionDocument(result.document).success).toBe(true)
    })

    it('projects disabled legacy character positioning as AI choice', () => {
        const result = migrateLegacyStoresToV2({
            characterPrompts: {
                positionEnabled: false,
                characters: [{
                    id: 'character:ai',
                    prompt: 'subject',
                    negative: '',
                    enabled: true,
                    position: { x: 0.2, y: 0.8 },
                }],
            },
        })

        expect(result.report.fatal).toBe(false)
        expect(result.document.characters[0].position).toEqual({ mode: 'ai-choice' })
    })

    it('does not treat an Asset Profile module map key as an explicit entity ID', () => {
        const mapKey = 'character:id-that-matches-module-map-key'
        const result = migrateLegacyStoresToV2({
            characterPrompts: {
                characters: [{
                    id: mapKey,
                    prompt: 'preserve me',
                    negative: '',
                    enabled: true,
                    position: { x: 0.5, y: 0.5 },
                }],
                positionEnabled: false,
            },
            assetProfileJson: {
                revision: 1,
                updatedBy: 'gui',
                updatedAt: '2026-07-01T00:00:00.000Z',
                settings: {},
                output: {},
                r2: { enabled: false },
                modules: {
                    [mapKey]: {
                        enabled: true,
                        kind: 'prompt',
                        prompt: 'module without an explicit id',
                        settings: {},
                    },
                },
                recipes: [],
            },
        })

        expect(result.report.fatal).toBe(false)
        expect(result.document.characters[0].id).toBe(mapKey)
        expect(result.document.modules[0].id).not.toBe(mapKey)
        expect(result.report.issues).not.toContainEqual(expect.objectContaining({
            code: 'M_DUPLICATE_ID_REPAIRED',
            path: ['characterPrompts', 'characters', 0, 'id'],
        }))
    })

    it('joins fragment export bundles that contain metadata and content together', () => {
        const result = migrateLegacyStoresToV2({
            fragments: {
                schemaVersion: 2,
                meta: [{
                    id: 'fragment:bundle',
                    contentKey: 'fragment:bundle',
                    name: 'bundle.txt',
                    folder: '',
                    lineCount: 1,
                    createdAt: 0,
                    updatedAt: 0,
                }],
                contents: { 'fragment:bundle': ['round-trip line'] },
            },
        })

        expect(result.sidecars.fragments.contents['fragment:bundle']).toEqual(['round-trip line'])
        expect(result.sidecars.fragments.meta[0].lineCount).toBe(1)
    })

    it('synthesizes deterministic metadata for content-only fragment records', () => {
        const input = {
            fragmentContent: {
                'separate-db-key-without-meta': ['kept line one', 'kept line two'],
            },
        }
        const first = migrateLegacyStoresToV2(input)
        const second = migrateLegacyStoresToV2(structuredClone(input))

        expect(second.sidecars.fragments).toEqual(first.sidecars.fragments)
        expect(first.sidecars.fragments.meta).toHaveLength(1)
        const recovered = first.sidecars.fragments.meta[0]
        expect(recovered).toMatchObject({
            id: expect.stringMatching(/^fragment:migrated:/),
            contentKey: 'separate-db-key-without-meta',
            folder: '_recovered',
            lineCount: 2,
        })
        expect(first.sidecars.fragments.contents[recovered.id]).toEqual([
            'kept line one',
            'kept line two',
        ])
        expect(first.sidecars.fragments.sequenceState.counters[recovered.id]).toBe(0)
        expect(first.report.entityCounts.fragments).toMatchObject({
            source: 1,
            migrated: 1,
            generatedIds: 1,
            orphaned: 1,
        })
        expect(first.report.issues).toContainEqual(expect.objectContaining({
            code: 'M_FRAGMENT_METADATA_SYNTHESIZED',
            severity: 'warning',
            path: ['fragments', 'content-only', 'separate-db-key-without-meta'],
        }))

        const roundTrip = migrateLegacyStoresToV2({ fragments: first.sidecars.fragments })
        expect(roundTrip.sidecars.fragments).toEqual(first.sidecars.fragments)
    })
})
