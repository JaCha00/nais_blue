import { describe, expect, it } from 'vitest'

import { safeParseCompositionDocument } from '@/domain/composition/schema'
import {
    migrateV1AssetProfileToV2,
    V1_ASSET_PROFILE_MIGRATION_ID,
} from '@/domain/composition/migrations/v1-asset-profile-to-v2'
import {
    LEGACY_STORES_MIGRATION_ID,
    getCompositionMigration,
    listCompositionMigrations,
    runCompositionMigration,
} from '@/domain/composition/migrations/registry'

const UPDATED_AT = '2025-03-04T05:06:07.000Z'

function profile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        revision: 17,
        updatedAt: UPDATED_AT,
        updatedBy: 'agent',
        settings: {},
        output: {},
        r2: { enabled: false },
        modules: {},
        recipes: [],
        ...overrides,
    }
}

describe('Asset Profile v1 to CompositionDocument v2 migration', () => {
    it('is available through the static deterministic migration registry', () => {
        expect(listCompositionMigrations()).toEqual([
            expect.objectContaining({
                id: V1_ASSET_PROFILE_MIGRATION_ID,
                sourceSchemaVersion: 1,
                targetSchemaVersion: 2,
                deterministic: true,
                rollbackSourceRetained: true,
            }),
            expect.objectContaining({
                id: LEGACY_STORES_MIGRATION_ID,
                sourceSchemaVersion: 'legacy',
                targetSchemaVersion: 2,
            }),
        ])
        expect(getCompositionMigration('not-registered')).toBeUndefined()
        const result = runCompositionMigration(V1_ASSET_PROFILE_MIGRATION_ID, { profile: undefined })
        expect(result.document.schemaVersion).toBe(2)
    })

    it('produces the same schema-valid empty document on every run', () => {
        const first = migrateV1AssetProfileToV2({ profile: undefined })
        const second = migrateV1AssetProfileToV2({ profile: undefined })

        expect(first).toEqual(second)
        expect(first.report).toMatchObject({
            migrationId: V1_ASSET_PROFILE_MIGRATION_ID,
            targetSchemaVersion: 2,
            fatal: false,
            sourceCounts: { documents: 0, profiles: 0, modules: 0, recipes: 0 },
            targetCounts: { documents: 1, profiles: 1, modules: 0, recipes: 0 },
        })
        expect(safeParseCompositionDocument(first.document).success).toBe(true)
    })

    it('preserves revision metadata and existing module/recipe IDs while typing targets and params', () => {
        const result = migrateV1AssetProfileToV2({
            profile: profile({
                settings: {
                    name: 'Legacy display name',
                    ucPreset: 0,
                    smea: false,
                    cfg_scale: '6.5',
                    futureProfileSetting: { keep: true },
                },
                modules: {
                    subject: {
                        id: 'module:subject',
                        enabled: true,
                        kind: 'prompt',
                        prompts: {
                            'main.base': 'portrait',
                            'main.negative': 'lowres',
                            'main.style': 'ink wash',
                        },
                        settings: {
                            cfgRescale: 0,
                            variety: false,
                            futureModuleSetting: ['lossless'],
                        },
                    },
                },
                recipes: [{
                    id: 'recipe:portrait',
                    enabled: true,
                    steps: [{ moduleId: 'subject', settings: { steps: 28 } }],
                    settings: { sampler: 'k_euler', futureRecipeSetting: 9 },
                }],
            }),
        })

        expect(safeParseCompositionDocument(result.document).success).toBe(true)
        expect(result.document).toMatchObject({
            schemaVersion: 2,
            revision: 17,
            updatedAt: UPDATED_AT,
            updatedBy: {
                kind: 'agent',
                displayName: 'agent',
                extensions: { legacy: { updatedBy: 'agent' } },
            },
        })
        expect(result.document.modules[0]).toMatchObject({
            id: 'module:subject',
            revision: 17,
            updatedAt: UPDATED_AT,
            paramsOverride: { cfgRescale: 0, variety: false },
            extensions: {
                legacy: { settings: { futureModuleSetting: ['lossless'] } },
            },
        })
        expect(result.document.recipes[0]).toMatchObject({
            id: 'recipe:portrait',
            paramsOverride: { sampler: 'k_euler' },
            extensions: { legacy: { settings: { futureRecipeSetting: 9 } } },
        })
        expect(result.document.recipes[0]?.steps[0]?.paramsOverride).toEqual({ steps: 28 })
        expect(result.document.profiles[0]?.paramsOverride).toEqual({ ucPreset: 0, smea: false, cfgScale: 6.5 })
        expect(result.document.profiles[0]?.extensions).toEqual({
            legacy: { settings: { futureProfileSetting: { keep: true } } },
        })
        expect(result.document.modules[0]?.contributions.map(item => item.target)).toEqual([
            { kind: 'positive', slot: 'base' },
            { kind: 'negative' },
            { kind: 'positive', slot: 'style' },
        ])
    })

    it('resolves character indices to migration-time stable IDs and retains out-of-range data as a repair issue', () => {
        const result = migrateV1AssetProfileToV2({
            stableCharacterIds: ['character:stable-a', 'character:stable-b'],
            profile: profile({
                modules: {
                    cast: {
                        id: 'module:cast',
                        enabled: true,
                        prompts: {
                            'v4.char.1.positive': 'stable target',
                            'v4.char.7.negative': 'must not disappear',
                        },
                        settings: {},
                    },
                },
            }),
        })

        expect(result.document.modules[0]?.contributions).toHaveLength(1)
        expect(result.document.modules[0]?.contributions[0]?.target).toEqual({
            kind: 'character',
            characterId: 'character:stable-b',
            polarity: 'positive',
        })
        expect(result.orphans).toEqual([expect.objectContaining({
            sourceId: 'module:cast',
            legacyTarget: 'v4.char.7.negative',
            rawValue: 'must not disappear',
            reason: 'character-index-out-of-range',
            characterIndex: 7,
        })])
        expect(result.report.issues).toContainEqual(expect.objectContaining({
            code: 'M_CHARACTER_TARGET_OUT_OF_RANGE',
            severity: 'error',
            repairable: true,
        }))
        expect(result.document.extensions).toMatchObject({
            legacy: { unknownTargets: [expect.objectContaining({ rawValue: 'must not disappear' })] },
        })
        expect(safeParseCompositionDocument(result.document).success).toBe(true)
    })

    it('keeps unknown targets losslessly instead of silently mapping them to the base prompt', () => {
        const result = migrateV1AssetProfileToV2({
            profile: profile({
                modules: {
                    future: {
                        id: 'module:future',
                        enabled: true,
                        prompts: { 'future.canvas.layer': ['first', 'second'] },
                        settings: {},
                    },
                },
            }),
        })

        expect(result.document.modules[0]?.contributions).toEqual([])
        expect(result.orphans.map(orphan => [orphan.legacyTarget, orphan.rawValue])).toEqual([
            ['future.canvas.layer', 'first'],
            ['future.canvas.layer', 'second'],
        ])
        expect(result.report.issues.filter(issue => issue.code === 'M_UNKNOWN_TARGET_ORPHANED')).toHaveLength(2)
    })

    it('repairs missing and duplicate IDs deterministically without using display names as IDs', () => {
        const legacy = profile({
            modules: [
                { enabled: true, label: 'Same Display Name', prompt: 'one', settings: {} },
                { id: 'duplicate:id', enabled: true, label: 'Same Display Name', prompt: 'two', settings: {} },
            ],
            recipes: [
                { id: 'duplicate:id', enabled: true, label: 'Same Display Name', steps: [] },
                { id: 'duplicate:id', enabled: true, label: 'Same Display Name', steps: [] },
            ],
        })
        const first = migrateV1AssetProfileToV2({ profile: legacy })
        const second = migrateV1AssetProfileToV2({ profile: legacy })
        const renamed = structuredClone(legacy)
        const renamedModules = renamed.modules as Array<Record<string, unknown>>
        const renamedRecipes = renamed.recipes as Array<Record<string, unknown>>
        renamedModules[0].label = 'Renamed module display only'
        renamedRecipes[1].label = 'Renamed recipe display only'
        const renamedResult = migrateV1AssetProfileToV2({ profile: renamed })
        const ids = [
            ...first.document.modules.map(item => item.id),
            ...first.document.recipes.map(item => item.id),
        ]

        expect(second.document).toEqual(first.document)
        expect(second.report.sourceHash).toBe(first.report.sourceHash)
        expect(second.report.targetHash).toBe(first.report.targetHash)
        expect([
            ...renamedResult.document.modules.map(item => item.id),
            ...renamedResult.document.recipes.map(item => item.id),
        ]).toEqual(ids)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).not.toContain('Same Display Name')
        expect(ids.filter(id => id === 'duplicate:id')).toHaveLength(1)
        expect(ids.every(id => id === 'duplicate:id' || id.includes(':migrated:'))).toBe(true)
        expect(first.report.issues.some(issue => issue.code === 'M_DUPLICATE_ID_REPAIRED')).toBe(true)
        expect(safeParseCompositionDocument(first.document).success).toBe(true)
    })

    it('does not promote a module map key or label into a missing entity ID', () => {
        const result = migrateV1AssetProfileToV2({
            profile: profile({
                modules: {
                    'Visible Module Name': {
                        enabled: true,
                        label: 'Visible Module Name',
                        prompt: 'content',
                        settings: {},
                    },
                },
                recipes: [{
                    id: 'recipe:map-key-reference',
                    enabled: true,
                    steps: [{ moduleId: 'Visible Module Name' }],
                }],
            }),
        })

        const moduleId = result.document.modules[0]?.id
        expect(moduleId).toMatch(/^composition-module:migrated:/)
        expect(moduleId).not.toBe('Visible Module Name')
        expect(result.document.recipes[0]?.steps[0]?.moduleId).toBe(moduleId)
    })

    it('retains a missing module reference in a valid document and reports it for repair', () => {
        const result = migrateV1AssetProfileToV2({
            profile: profile({
                recipes: [{
                    id: 'recipe:missing-module',
                    enabled: true,
                    steps: [{ moduleId: 'module:not-installed', prompt: 'still retained' }],
                }],
            }),
        })

        expect(result.document.recipes[0]?.steps[0]).toMatchObject({
            moduleId: 'module:not-installed',
            contributions: [expect.objectContaining({ text: 'still retained' })],
        })
        expect(result.report.issues).toContainEqual(expect.objectContaining({
            code: 'M_MODULE_REFERENCE_MISSING',
            severity: 'error',
        }))
        expect(safeParseCompositionDocument(result.document).success).toBe(true)
    })
})
