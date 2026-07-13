import { describe, expect, it } from 'vitest'

import {
    applyCompositionChangeSet,
    CompositionAuthoringError,
    createCompositionChangeSet,
    mergeCompositionDocuments,
    validateCompositionAuthoringDocument,
} from '@/domain/composition/authoring'
import type { CompositionDocument, CompositionModule, RecipeStep } from '@/domain/composition/types'
import {
    typeFixtureActor,
    typeFixtureDocument,
    typeFixtureStep,
} from '@/domain/composition/types.typecheck'

const NOW = '2026-07-13T01:00:00.000Z'

function document(): CompositionDocument {
    return structuredClone(typeFixtureDocument) as CompositionDocument
}

function moduleUpdate(source: CompositionDocument, patch: Partial<CompositionModule> = {}): CompositionModule {
    return { ...source.modules[0], name: 'Edited module', ...patch }
}

describe('Composition authoring transactions', () => {
    it('creates, applies, stamps, and inverts a change set without mutating the base', () => {
        const base = document()
        const changes = createCompositionChangeSet({
            document: base,
            id: 'change:edit-module',
            updatedAt: NOW,
            updatedBy: typeFixtureActor,
            changes: [{ kind: 'upsert-module', value: moduleUpdate(base) }],
        })

        const applied = applyCompositionChangeSet(base, changes)
        expect(base.modules[0].name).toBe('Hero prompt')
        expect(applied.document).toMatchObject({ revision: 1, updatedAt: NOW })
        expect(applied.document.modules[0]).toMatchObject({
            name: 'Edited module',
            revision: base.modules[0].revision + 1,
            createdAt: base.modules[0].createdAt,
            updatedAt: NOW,
        })

        const undone = applyCompositionChangeSet(applied.document, applied.inverseChangeSet)
        expect(undone.document.modules[0].name).toBe('Hero prompt')
        expect(undone.document.revision).toBe(2)
    })

    it('rejects schema errors and semantic blocking references before commit', () => {
        const invalidParams = document()
        const schemaChange = createCompositionChangeSet({
            document: invalidParams,
            id: 'change:invalid-params',
            updatedAt: NOW,
            updatedBy: typeFixtureActor,
            changes: [{
                kind: 'upsert-module',
                value: moduleUpdate(invalidParams, { paramsOverride: { steps: 0 } }),
            }],
        })
        expect(() => applyCompositionChangeSet(invalidParams, schemaChange)).toThrowError(
            expect.objectContaining({
                code: 'E_CHANGESET_VALIDATION_FAILED',
                validation: expect.objectContaining({
                    schemaIssues: expect.arrayContaining([
                        expect.objectContaining({ path: ['modules', 0, 'paramsOverride', 'steps'] }),
                    ]),
                }),
            }) as Partial<CompositionAuthoringError>,
        )

        const missingReference = document()
        const recipe = {
            ...missingReference.recipes[0],
            steps: [{ ...missingReference.recipes[0].steps[0], moduleId: 'module:missing' }],
        }
        const semanticChange = createCompositionChangeSet({
            document: missingReference,
            id: 'change:missing-module',
            updatedAt: NOW,
            updatedBy: typeFixtureActor,
            changes: [{ kind: 'upsert-recipe', value: recipe }],
        })
        expect(() => applyCompositionChangeSet(missingReference, semanticChange)).toThrowError(
            expect.objectContaining({
                code: 'E_CHANGESET_VALIDATION_FAILED',
                validation: expect.objectContaining({
                    blockingIssues: expect.arrayContaining([
                        expect.objectContaining({ code: 'E_MODULE_REF_MISSING' }),
                    ]),
                }),
            }) as Partial<CompositionAuthoringError>,
        )
    })

    it('allows the same module in multiple recipe steps because step identity and order are canonical', () => {
        const value = document()
        const duplicateUse: RecipeStep = {
            ...structuredClone(typeFixtureStep),
            id: 'recipe-step:hero-again',
            orderKey: 'b0',
        }
        value.recipes[0].steps.push(duplicateUse)

        const validation = validateCompositionAuthoringDocument(value)
        expect(validation.valid).toBe(true)
        expect(validation.schemaIssues).toEqual([])
        expect(validation.blockingIssues).toEqual([])
    })
})

describe('Composition document three-way merge', () => {
    it('combines non-overlapping entity edits and reports exact paths for overlapping edits', () => {
        const base = document()
        const local = document()
        const external = document()
        local.modules[0].name = 'Local module name'
        external.recipes[0].name = 'External recipe name'

        const clean = mergeCompositionDocuments({ base, local, external })
        expect(clean.conflicts).toEqual([])
        expect(clean.document?.modules[0].name).toBe('Local module name')
        expect(clean.document?.recipes[0].name).toBe('External recipe name')

        external.modules[0].name = 'External module name'
        const conflicted = mergeCompositionDocuments({ base, local, external })
        expect(conflicted.conflicts).toEqual([
            expect.objectContaining({
                path: ['modules', base.modules[0].id, 'name'],
                base: 'Hero prompt',
                local: 'Local module name',
                external: 'External module name',
                resolution: 'unresolved',
            }),
        ])
        expect(conflicted.document?.modules[0].name).toBe('Local module name')

        const resolved = mergeCompositionDocuments({
            base,
            local,
            external,
            resolutions: [{
                path: ['modules', base.modules[0].id, 'name'],
                choice: 'external',
            }],
        })
        expect(resolved.conflicts[0].resolution).toBe('external')
        expect(resolved.document?.modules[0].name).toBe('External module name')
    })

    it('treats a simultaneous create of the same stable ID as an entity-level conflict', () => {
        const base = document()
        const local = document()
        const external = document()
        const newModule = {
            ...structuredClone(base.modules[0]),
            id: 'module:new',
            contributions: [],
            characterPatches: [],
        }
        local.modules.push({ ...newModule, name: 'Local new' })
        external.modules.push({ ...newModule, name: 'External new' })

        const result = mergeCompositionDocuments({ base, local, external })
        expect(result.conflicts).toEqual([
            expect.objectContaining({ path: ['modules', 'module:new'] }),
        ])
        expect(result.document?.modules.find(module => module.id === 'module:new')?.name).toBe('Local new')
    })
})
