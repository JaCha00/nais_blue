import { describe, expect, it, vi } from 'vitest'

import type { ActorRef } from '@/domain/composition/types'
import {
    createCharacterPromptTarget,
    projectCharacterPromptsToV2,
} from '@/lib/composition/character-prompt-adapter'
import {
    characterResourceRefId,
    materializeCharacterResourcesForNai,
    projectCharacterResourcesToV2,
} from '@/lib/composition/character-resource-adapter'
import {
    legacyPresetParams,
    projectLegacyParamsPreset,
} from '@/lib/composition/params-preset-adapter'
import {
    characterStoreResourceId,
    type CharacterResourceRepository,
    type CharacterResourceContent,
} from '@/lib/composition/character-resource-repository'
import {
    migrateCharacterPromptIds,
    migrateCharacterPromptPersistedState,
} from '@/lib/composition/character-prompt-migration'
import {
    migrateGenerationPresetPersistedState as migratePresetPersistedState,
} from '@/lib/composition/preset-store-migration'

const NOW = '2026-07-12T00:00:00.000Z'
const ACTOR: ActorRef = { kind: 'system', id: 'migration:test' }
const CONTEXT = { revision: 2, timestamp: NOW, actor: ACTOR }

describe('legacy character prompt migration and projection', () => {
    it('preserves existing IDs and deterministically repairs missing or duplicate IDs', () => {
        const legacy = [
            { id: 'character:kept', prompt: 'one', negative: '', enabled: true, position: { x: 0, y: 1 } },
            { id: 'character:duplicate', prompt: 'two', negative: '', enabled: true, position: { x: 0.2, y: 0.3 } },
            { id: 'character:duplicate', prompt: 'three', negative: '', enabled: true, position: { x: 0.4, y: 0.5 } },
            { prompt: 'four', negative: '', enabled: true, position: { x: 0.6, y: 0.7 } },
        ]

        const first = migrateCharacterPromptIds(legacy)
        const second = migrateCharacterPromptIds(structuredClone(legacy))

        expect(first).toEqual(second)
        expect(first.characters.map(character => character.id).slice(0, 2)).toEqual([
            'character:kept',
            'character:duplicate',
        ])
        expect(new Set(first.characters.map(character => character.id)).size).toBe(4)
        expect(first.characters[2].id).toMatch(/^character:migrated:/)
        expect(first.characters[3].id).toMatch(/^character:migrated:/)
        expect(first.migrations.map(item => item.reason)).toEqual(['duplicate', 'missing'])
    })

    it('uses stable IDs across reorder/delete and keeps group/preset data as byte-free metadata', () => {
        const characters = [
            {
                id: 'character:a',
                presetId: 'template:a',
                groupId: 'group:a',
                prompt: 'silver hair',
                negative: 'hat',
                enabled: true,
                position: { x: 0.2, y: 0.8 },
            },
            {
                id: 'character:b',
                prompt: 'blue eyes',
                negative: '',
                enabled: true,
                position: { x: 0.7, y: 0.3 },
            },
        ]
        const target = createCharacterPromptTarget('character:a', 'positive')
        const inputMetadata = {
            presets: [{
                id: 'template:a',
                name: 'Template A',
                prompt: 'silver hair',
                negative: 'hat',
                groupId: 'group:a',
                image: 'data:image/png;base64,SHOULD_NOT_CROSS',
            }],
            groups: [{ id: 'group:a', name: 'Cast', collapsed: true, colorIndex: 3 }],
        }

        const initial = projectCharacterPromptsToV2({
            characters,
            positionEnabled: true,
            context: CONTEXT,
            ...inputMetadata,
        })
        const reordered = projectCharacterPromptsToV2({
            characters: [characters[1], characters[0]],
            positionEnabled: true,
            context: CONTEXT,
            ...inputMetadata,
        })
        const afterDelete = projectCharacterPromptsToV2({
            characters: [characters[1]],
            positionEnabled: true,
            context: CONTEXT,
            ...inputMetadata,
        })

        expect(initial.success).toBe(true)
        expect(initial.characters.map(character => character.id)).toEqual(['character:a', 'character:b'])
        expect(reordered.characters.map(character => character.id)).toEqual(['character:b', 'character:a'])
        expect(afterDelete.characters.map(character => character.id)).toEqual(['character:b'])
        expect(target).toEqual({ kind: 'character', characterId: 'character:a', polarity: 'positive' })
        expect(initial.characters[0]).toMatchObject({
            positivePrompt: 'silver hair',
            negativePrompt: 'hat',
            enabled: true,
            position: { mode: 'manual', x: 0.2, y: 0.8 },
            extensions: { legacyTemplate: { presetId: 'template:a', groupId: 'group:a' } },
        })
        expect(JSON.stringify(initial.templateExtensions)).not.toContain('SHOULD_NOT_CROSS')
        expect(initial.templateExtensions).toMatchObject({
            legacyCharacterTemplates: {
                groups: [{ id: 'group:a', name: 'Cast' }],
                presets: [{ id: 'template:a', name: 'Template A', groupId: 'group:a' }],
            },
        })
    })

    it('projects AI choice/manual positions and blocks mixed NAI coordinate semantics', () => {
        const ai = projectCharacterPromptsToV2({
            characters: [{ id: 'character:ai', prompt: '', position: { x: 0.1, y: 0.9 } }],
            positionEnabled: false,
            context: CONTEXT,
        })
        const manual = projectCharacterPromptsToV2({
            characters: [{ id: 'character:manual', prompt: '', position: { x: 0, y: 1 } }],
            positionEnabled: true,
            context: CONTEXT,
        })
        const mixed = projectCharacterPromptsToV2({
            characters: [
                { id: 'character:ai', prompt: '', position: { mode: 'ai-choice' } },
                { id: 'character:manual', prompt: '', position: { mode: 'manual', x: 0, y: 1 } },
            ],
            positionEnabled: true,
            context: CONTEXT,
        })

        expect(ai.characters[0].position).toEqual({ mode: 'ai-choice' })
        expect(manual.characters[0].position).toEqual({ mode: 'manual', x: 0, y: 1 })
        expect(mixed.success).toBe(false)
        expect(mixed.errors).toEqual([
            expect.objectContaining({ code: 'E_CHAR_POSITION_MODE_MIXED', blocking: true }),
        ])
    })

    it('round-trips repaired old character store snapshots without changing IDs', () => {
        const oldStore = {
            characters: [{ prompt: null, enabled: null, position: null }],
            presets: [],
            groups: [],
        }
        const first = migrateCharacterPromptPersistedState(oldStore)
        const restored = migrateCharacterPromptPersistedState(JSON.parse(JSON.stringify(first)))

        expect(restored).toEqual(first)
        expect(restored.characters[0]).toMatchObject({
            prompt: '',
            negative: '',
            enabled: true,
            position: { x: 0.5, y: 0.5 },
        })
    })
})

describe('legacy generation preset projection', () => {
    it('keeps false/zero, excludes prompt and UI fields, and ignores null/missing params', () => {
        const legacy = {
            id: 'preset:zero',
            name: 'Zero preset',
            createdAt: 0,
            isDefault: false,
            basePrompt: 'UI prompt only',
            negativePrompt: 'UI negative only',
            model: null,
            steps: 0,
            cfgScale: 0,
            cfgRescale: 0,
            sampler: 'k_euler',
            scheduler: undefined,
            smea: false,
            smeaDyn: false,
            variety: false,
            qualityToggle: false,
            ucPreset: 0,
            selectedResolution: { label: 'UI label', width: 0, height: 768 },
        }

        const params = legacyPresetParams(legacy)
        const projected = projectLegacyParamsPreset(legacy, 0, CONTEXT)

        expect(params).toEqual({
            width: 0,
            height: 768,
            steps: 0,
            cfgScale: 0,
            cfgRescale: 0,
            sampler: 'k_euler',
            smea: false,
            smeaDyn: false,
            variety: false,
            qualityToggle: false,
            ucPreset: 0,
        })
        expect(projected.params).toEqual(params)
        expect(projected.createdAt).toBe('1970-01-01T00:00:00.000Z')
        expect(JSON.stringify(projected.params)).not.toMatch(/Prompt|label|createdAt|isDefault/)
    })

    it('hydrates old partial preset snapshots with defaults while preserving false and zero', () => {
        const migrated = migratePresetPersistedState({
            presets: [{ id: 'legacy', name: 'Legacy', variety: false, qualityToggle: false, ucPreset: 0 }],
            activePresetId: 'missing',
        })
        const restored = migratePresetPersistedState(JSON.parse(JSON.stringify(migrated)))

        expect(restored).toEqual(migrated)
        expect(migrated.activePresetId).toBe('default')
        expect(migrated.presets[0].id).toBe('default')
        expect(migrated.presets.find(preset => preset.id === 'legacy')).toMatchObject({
            variety: false,
            qualityToggle: false,
            ucPreset: 0,
            cfgRescale: 0,
        })
    })
})

describe('character resource references and NAI materialization', () => {
    it('keeps bytes/cache material out of ResourceRef and materializes existing data only at the adapter edge', async () => {
        const projection = projectCharacterResourcesToV2({
            characterImages: [{
                id: 'character-image:a',
                enabled: true,
                strength: 0,
                fidelity: 0,
                informationExtracted: 0,
                referenceType: 'character',
                base64: 'SHOULD_NOT_CROSS',
                filePath: 'SHOULD_NOT_CROSS',
                cacheKey: 'SHOULD_NOT_CROSS',
            } as never],
            vibeImages: [{
                id: 'vibe:a',
                enabled: true,
                strength: 0.25,
                informationExtracted: 0.75,
                encodedVibe: 'SHOULD_NOT_CROSS',
            } as never],
            context: CONTEXT,
        })

        const serializedProjection = JSON.stringify(projection)
        expect(serializedProjection).not.toContain('SHOULD_NOT_CROSS')
        expect(projection.resources).toEqual([
            expect.objectContaining({
                id: characterResourceRefId('character', 'character-image:a'),
                kind: 'managed',
                resourceId: characterStoreResourceId('character', 'character-image:a'),
            }),
            expect.objectContaining({
                id: characterResourceRefId('vibe', 'vibe:a'),
                kind: 'managed',
                resourceId: characterStoreResourceId('vibe', 'vibe:a'),
            }),
        ])
        expect(projection.bindings[0]).toMatchObject({
            strength: 0,
            fidelity: 0,
            informationExtracted: 0,
        })

        const ensureAvailable = vi.fn(async () => undefined)
        const records = new Map<string, CharacterResourceContent>([
            [characterStoreResourceId('character', 'character-image:a'), {
                id: 'character-image:a',
                base64: 'data:image/png;base64,CHARACTER',
                enabled: true,
                informationExtracted: 1,
                strength: 0.6,
                fidelity: 0.6,
                referenceType: 'character&style',
                cacheKey: 'existing-cache-key',
            }],
            [characterStoreResourceId('vibe', 'vibe:a'), {
                id: 'vibe:a',
                base64: 'data:image/png;base64,VIBE',
                enabled: true,
                encodedVibe: 'existing-encoded-vibe',
                informationExtracted: 1,
                strength: 0.6,
                fidelity: 0.6,
                referenceType: 'character&style',
            }],
        ])
        const repository: CharacterResourceRepository = {
            ensureAvailable,
            getByResourceId: id => records.get(id),
        }
        const materialized = await materializeCharacterResourcesForNai({
            ...projection,
            repository,
        })

        expect(ensureAvailable).toHaveBeenCalledOnce()
        expect(materialized).toEqual({
            success: true,
            errors: [],
            value: {
                charImages: ['data:image/png;base64,CHARACTER'],
                charStrength: [0],
                charFidelity: [0],
                charReferenceType: ['character'],
                charCacheKeys: ['existing-cache-key'],
                charInfo: [0],
                vibeImages: ['data:image/png;base64,VIBE'],
                vibeInfo: [0.75],
                vibeStrength: [0.25],
                preEncodedVibes: ['existing-encoded-vibe'],
            },
        })
    })

    it('materializes cache-only character and pre-encoded vibe references without rebuilding them', async () => {
        const projection = projectCharacterResourcesToV2({
            characterImages: [{ id: 'character:cached', enabled: true }],
            vibeImages: [{ id: 'vibe:encoded', enabled: true }],
            context: CONTEXT,
        })
        const records = new Map<string, CharacterResourceContent>([
            [characterStoreResourceId('character', 'character:cached'), {
                id: 'character:cached',
                base64: '',
                enabled: true,
                informationExtracted: 1,
                strength: 0.6,
                fidelity: 0.6,
                referenceType: 'character&style',
                cacheKey: 'existing-cache-key',
            }],
            [characterStoreResourceId('vibe', 'vibe:encoded'), {
                id: 'vibe:encoded',
                base64: '',
                enabled: true,
                encodedVibe: 'existing-encoded-vibe',
                informationExtracted: 1,
                strength: 0.6,
                fidelity: 0.6,
                referenceType: 'character&style',
            }],
        ])

        const materialized = await materializeCharacterResourcesForNai({
            ...projection,
            repository: {
                ensureAvailable: async () => undefined,
                getByResourceId: id => records.get(id),
            },
        })

        expect(materialized).toMatchObject({
            success: true,
            value: {
                charImages: [''],
                charCacheKeys: ['existing-cache-key'],
                vibeImages: [''],
                preEncodedVibes: ['existing-encoded-vibe'],
            },
        })
    })
})
