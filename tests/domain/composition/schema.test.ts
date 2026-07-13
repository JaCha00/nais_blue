import { describe, expect, it } from 'vitest'

import {
    CompositionSchemaError,
    compositionDocumentSchema,
    deserializeCompositionDocument,
    parseCompositionDocument,
    safeParseCompositionDocument,
    serializeCompositionDocument,
} from '@/domain/composition/schema'
import type { CompositionDocument } from '@/domain/composition/types'
import { typeFixtureDocument } from '@/domain/composition/types.typecheck'

function cloneDocument(): CompositionDocument {
    return JSON.parse(JSON.stringify(typeFixtureDocument)) as CompositionDocument
}

function failureFor(value: unknown) {
    const result = safeParseCompositionDocument(value)
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Expected schema validation to fail')
    return result
}

describe('Composition Domain v2 runtime schema', () => {
    it('accepts a complete valid document without normalization', () => {
        const document = cloneDocument()
        const parsed = parseCompositionDocument(document)

        expect(parsed).toBe(document)
        expect(compositionDocumentSchema.is(document)).toBe(true)
        expect(compositionDocumentSchema.safeParse(document)).toEqual({ success: true, data: document })
    })

    it('rejects invalid and newer schema versions with distinct issue codes', () => {
        const oldDocument = { ...cloneDocument(), schemaVersion: 1 }
        const oldResult = failureFor(oldDocument)
        expect(oldResult.issues).toContainEqual(expect.objectContaining({
            code: 'invalid_schema_version',
            path: ['schemaVersion'],
        }))

        const newerDocument = { ...cloneDocument(), schemaVersion: 3 }
        const newerResult = failureFor(newerDocument)
        expect(newerResult.issues).toEqual([expect.objectContaining({
            code: 'unsupported_schema_version',
            path: ['schemaVersion'],
        })])
    })

    it('rejects malformed prompt targets and array-index character targeting', () => {
        const unknownTarget = cloneDocument() as unknown as Record<string, unknown>
        const unknownModules = unknownTarget.modules as Array<Record<string, unknown>>
        const unknownContributions = unknownModules[0].contributions as Array<Record<string, unknown>>
        unknownContributions[0].target = { kind: 'future-target', value: 'unsafe' }
        expect(failureFor(unknownTarget).issues).toContainEqual(expect.objectContaining({
            path: ['modules', 0, 'contributions', 0, 'target', 'kind'],
        }))

        const indexedTarget = cloneDocument() as unknown as Record<string, unknown>
        const indexedModules = indexedTarget.modules as Array<Record<string, unknown>>
        const indexedContributions = indexedModules[0].contributions as Array<Record<string, unknown>>
        indexedContributions[0].target = { kind: 'character', index: 0, polarity: 'positive' }
        const indexedResult = failureFor(indexedTarget)
        expect(indexedResult.issues.some(issue => (
            issue.path.join('.') === 'modules.0.contributions.0.target.characterId'
            || issue.path.join('.') === 'modules.0.contributions.0.target.index'
        ))).toBe(true)
    })

    it('validates reference shape without coercing or resolving stable IDs', () => {
        const invalidReference = cloneDocument() as unknown as Record<string, unknown>
        const recipes = invalidReference.recipes as Array<Record<string, unknown>>
        const steps = recipes[0].steps as Array<Record<string, unknown>>
        steps[0].moduleId = 0
        expect(failureFor(invalidReference).issues).toContainEqual(expect.objectContaining({
            path: ['recipes', 0, 'steps', 0, 'moduleId'],
            code: 'invalid_type',
        }))

        const unresolvedReference = cloneDocument()
        unresolvedReference.recipes[0].steps[0].moduleId = 'module:resolved-later'
        const parsed = parseCompositionDocument(unresolvedReference)
        expect(parsed.recipes[0].steps[0].moduleId).toBe('module:resolved-later')
    })

    it('rejects manual coordinates outside the inclusive zero-to-one range', () => {
        const document = cloneDocument() as unknown as Record<string, unknown>
        const characters = document.characters as Array<Record<string, unknown>>
        characters[0].position = { mode: 'manual', x: -0.001, y: 1.001 }

        const result = failureFor(document)
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: ['characters', 0, 'position', 'x'], code: 'invalid_value' }),
            expect.objectContaining({ path: ['characters', 0, 'position', 'y'], code: 'invalid_value' }),
        ]))
    })

    it('preserves explicit false and zero generation values', () => {
        const parsed = parseCompositionDocument(cloneDocument())
        const params = parsed.paramsPresets[0].params
        const character = parsed.characters[0]

        expect(params).toMatchObject({
            cfgRescale: 0,
            seed: 0,
            smea: false,
            smeaDyn: false,
            variety: false,
            qualityToggle: false,
            ucPreset: 0,
            strength: 0,
            noise: 0,
            characterPositionEnabled: false,
        })
        expect(character.enabled).toBe(false)
        expect(parsed.resources[0].enabled).toBe(false)
        expect(parsed.profiles[0].resourceBindings[0]).toMatchObject({
            enabled: false,
            strength: 0,
            fidelity: 0,
            informationExtracted: 0,
        })
        expect(character.position).toEqual({ mode: 'manual', x: 0, y: 1 })
    })

    it('preserves unknown nested extensions through parse and JSON round-trip', () => {
        const document = cloneDocument()
        document.extensions = {
            futureRoot: {
                enabled: false,
                threshold: 0,
                nested: ['keep', { exact: true }],
            },
        }
        document.profiles[0].extensions = { futureProfile: { mode: 'v9-preview' } }
        document.profiles[0].paramsOverride = {
            ...document.profiles[0].paramsOverride,
            extensions: { futureParam: { preserved: true } },
        }

        const serialized = serializeCompositionDocument(document)
        const restored = deserializeCompositionDocument(serialized)

        expect(restored).toEqual(document)
        expect(restored.extensions).toEqual(document.extensions)
        expect(restored.profiles[0].paramsOverride?.extensions).toEqual({
            futureParam: { preserved: true },
        })
    })

    it('round-trips a valid document with ordinary JSON serialization', () => {
        const document = cloneDocument()
        const nativeRoundTrip = JSON.parse(JSON.stringify(document))
        const parsed = parseCompositionDocument(nativeRoundTrip)

        expect(parsed).toEqual(document)
        expect(JSON.parse(serializeCompositionDocument(parsed))).toEqual(document)
    })

    it('rejects wrong param scalar types, invalid output formats and non-portable path segments', () => {
        const wrongParams = cloneDocument() as unknown as Record<string, unknown>
        const presets = wrongParams.paramsPresets as Array<Record<string, unknown>>
        const invalidParams = presets[0].params as Record<string, unknown>
        invalidParams.cfgRescale = '0'
        invalidParams.smea = 0
        invalidParams.model = 123
        expect(failureFor(wrongParams).issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: ['paramsPresets', 0, 'params', 'cfgRescale'], code: 'invalid_type' }),
            expect.objectContaining({ path: ['paramsPresets', 0, 'params', 'smea'], code: 'invalid_type' }),
            expect.objectContaining({ path: ['paramsPresets', 0, 'params', 'model'], code: 'invalid_type' }),
        ]))

        const wrongOutput = cloneDocument() as unknown as Record<string, unknown>
        const profiles = wrongOutput.profiles as Array<Record<string, unknown>>
        const invalidOutput = profiles[0].outputPolicy as Record<string, unknown>
        invalidOutput.format = 'jpg'
        invalidOutput.filenameTemplate = '../escape.png'
        expect(failureFor(wrongOutput).issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: ['profiles', 0, 'outputPolicy', 'format'], code: 'invalid_value' }),
            expect.objectContaining({ path: ['profiles', 0, 'outputPolicy', 'filenameTemplate'], code: 'invalid_value' }),
        ]))

        const wrongPath = cloneDocument() as unknown as Record<string, unknown>
        const pathProfiles = wrongPath.profiles as Array<Record<string, unknown>>
        const output = pathProfiles[0].outputPolicy as Record<string, unknown>
        const destination = output.destination as Record<string, unknown>
        const directory = destination.directory as Record<string, unknown>
        directory.segments = ['safe', '..', 'nested/escape']
        const pathResult = failureFor(wrongPath)
        expect(pathResult.issues.filter(issue => issue.code === 'invalid_value')).toHaveLength(2)
    })

    it('rejects invalid revisions, IDs, actor shape, duplicate IDs and non-JSON extensions', () => {
        const document = cloneDocument() as unknown as Record<string, unknown>
        document.revision = -1
        document.id = '   '
        document.updatedBy = 'agent'
        const modules = document.modules as Array<Record<string, unknown>>
        modules.push(JSON.parse(JSON.stringify(modules[0])) as Record<string, unknown>)

        const result = failureFor(document)
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: ['revision'], code: 'invalid_value' }),
            expect.objectContaining({ path: ['id'], code: 'invalid_value' }),
            expect.objectContaining({ path: ['updatedBy'], code: 'invalid_type' }),
            expect.objectContaining({ path: ['modules', 1, 'id'], code: 'duplicate_id' }),
        ]))

        const nonJsonDocument = cloneDocument() as unknown as Record<string, unknown>
        nonJsonDocument.extensions = { invalid: Number.NaN }
        expect(failureFor(nonJsonDocument).issues).toContainEqual(expect.objectContaining({
            path: ['extensions', 'invalid'],
            code: 'invalid_json_value',
        }))
    })

    it('supports tombstones and requires a stable orderKey for ordered entities', () => {
        const tombstoned = cloneDocument()
        tombstoned.modules[0].deletedAt = '2026-07-11T02:00:00.000Z'
        expect(parseCompositionDocument(tombstoned).modules[0].deletedAt).toBe('2026-07-11T02:00:00.000Z')

        const unordered = cloneDocument() as unknown as Record<string, unknown>
        const modules = unordered.modules as Array<Record<string, unknown>>
        modules[0].orderKey = ''
        expect(failureFor(unordered).issues).toContainEqual(expect.objectContaining({
            path: ['modules', 0, 'orderKey'],
            code: 'invalid_value',
        }))
    })

    it('rejects unknown core keys instead of treating them as payload fields', () => {
        const document = cloneDocument() as unknown as Record<string, unknown>
        const presets = document.paramsPresets as Array<Record<string, unknown>>
        ;(presets[0].params as Record<string, unknown>).futurePayloadFlag = true

        const result = failureFor(document)
        expect(result.issues).toContainEqual(expect.objectContaining({
            path: ['paramsPresets', 0, 'params', 'futurePayloadFlag'],
            code: 'unknown_key',
        }))
    })

    it('throws a typed error from parse and deserialize failures', () => {
        expect(() => parseCompositionDocument({ schemaVersion: 2 })).toThrow(CompositionSchemaError)
        expect(() => deserializeCompositionDocument('{not-json')).toThrow(CompositionSchemaError)
    })
})
