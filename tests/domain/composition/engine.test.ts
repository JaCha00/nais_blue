import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    CompositionEngine,
    type CompositionEngineResolveInput,
} from '@/domain/composition/engine'
import { createFragmentLookup } from '@/domain/composition/fragment-resolver'
import { validateCompositionSemantics } from '@/domain/composition/validation'
import type {
    CharacterDefinition,
    CompositionDocument,
    OutputPolicy,
    PromptContribution,
    PromptTarget,
    ResolveRequest,
    ResolvedGenerationParams,
    ResourceRef,
} from '@/domain/composition/types'
import {
    typeFixtureDocument,
    typeFixturePlan,
    typeFixtureRequest,
} from '@/domain/composition/types.typecheck'

const actor = { kind: 'system', id: 'actor:engine-test' } as const
const timestamp = '2026-07-11T00:00:00.000Z'

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function contribution(
    id: string,
    target: PromptTarget,
    text: string,
    orderKey: string,
    merge: PromptContribution['merge'] = 'append',
): PromptContribution {
    return {
        id,
        revision: 1,
        createdAt: timestamp,
        createdBy: actor,
        updatedAt: timestamp,
        updatedBy: actor,
        orderKey,
        enabled: true,
        target,
        text,
        merge,
        separator: 'comma-space',
    }
}

function memoryPolicy(format: 'png' | 'webp', filenameTemplate: string): OutputPolicy {
    return {
        destination: { kind: 'memory' },
        format,
        filenameTemplate,
        metadataMode: 'embedded',
        collisionPolicy: 'unique',
    }
}

interface EngineFixture {
    document: CompositionDocument
    request: ResolveRequest
    input: CompositionEngineResolveInput
}

function baseFixture(): EngineFixture {
    const document = clone(typeFixtureDocument)
    delete document.extensions
    document.randomRules = []
    document.resources = []

    const profile = document.profiles[0]
    profile.contributions = []
    profile.characterPatches = []
    delete profile.paramsOverride
    profile.resourceBindings = []
    profile.randomRuleIds = []
    profile.paramsPresetIds = []
    delete profile.defaultParamsPresetId
    profile.outputPolicy = memoryPolicy('png', 'NAIS_{seed}')

    const module = document.modules[0]
    module.contributions = []
    module.characterPatches = []
    delete module.paramsOverride
    delete module.outputPolicy
    module.resourceBindings = []
    module.randomRuleIds = []

    const recipe = document.recipes[0]
    delete recipe.paramsOverride
    delete recipe.outputPolicy
    const step = recipe.steps[0]
    step.contributions = []
    step.characterPatches = []
    delete step.paramsOverride
    delete step.outputPolicy
    step.resourceBindings = []
    step.randomRuleIds = []

    document.paramsPresets = []
    const character = document.characters[0]
    character.enabled = true
    character.positivePrompt = 'hero base'
    character.negativePrompt = 'hero negative'
    character.position = { mode: 'ai-choice' }
    character.resourceBindings = []

    const request = clone(typeFixtureRequest)
    request.document = document
    request.contributions = []
    request.characterPatches = []
    delete request.paramsOverride
    delete request.outputPolicy
    request.resourceBindings = []
    delete request.paramsPresetId
    request.randomSeed = 123456789

    const engineDefaults = clone(typeFixturePlan.params)
    engineDefaults.characterPositionEnabled = false

    return {
        document,
        request,
        input: {
            request,
            now: '2026-07-11T12:34:56.000Z',
            engineDefaults,
            fragment: {
                lookup: createFragmentLookup([
                    { id: 'fragment:color', path: 'color', lines: ['red hair'] },
                    { id: 'fragment:sequence', path: 'sequence', lines: ['first', 'second'] },
                ]),
                sequenceSnapshot: { revision: 4, counters: {} },
                mode: 'generate',
                strictness: 'strict',
                maxRecursion: 10,
            },
            referencePolicy: 'strict',
            randomScope: 'recipe:engine-test',
        },
    }
}

function configureConcreteExample(fixture: EngineFixture): void {
    const profile = fixture.document.profiles[0]
    const module = fixture.document.modules[0]
    const step = fixture.document.recipes[0].steps[0]

    profile.contributions = [
        contribution('contribution:base', { kind: 'positive', slot: 'base' }, '# ignored\nmasterpiece, <color>', '10'),
        contribution('contribution:inpaint', { kind: 'positive', slot: 'inpainting' }, 'inpaint context', '10'),
        contribution('contribution:negative', { kind: 'negative' }, 'lowres, lowres', '10'),
    ]
    module.contributions = [
        contribution('contribution:additional', { kind: 'positive', slot: 'additional' }, 'cinematic lighting', '10'),
        contribution(
            'contribution:character-positive',
            { kind: 'character', characterId: 'character:hero', polarity: 'positive' },
            '# ignored\nblue eyes',
            '10',
        ),
    ]
    step.contributions = [
        contribution('contribution:workflow', { kind: 'positive', slot: 'workflow' }, 'scene mood', '10'),
    ]
    fixture.request.contributions = [
        contribution('contribution:detail', { kind: 'positive', slot: 'detail' }, 'intricate detail', '10'),
    ]

    profile.paramsOverride = { steps: 24 }
    module.paramsOverride = { cfgScale: 6 }
    step.paramsOverride = { sampler: 'k_euler' }
    fixture.document.recipes[0].paramsOverride = { scheduler: 'exponential' }
    fixture.request.paramsOverride = { cfgRescale: 0, variety: false }
}

describe('CompositionEngine concrete resolution', () => {
    it('resolves the coherent concrete example through every pure stage', () => {
        const fixture = baseFixture()
        configureConcreteExample(fixture)

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected concrete resolution to succeed')
        expect(result.plan).toMatchObject({
            positivePrompt: 'masterpiece, red hair, inpaint context, cinematic lighting, scene mood, intricate detail',
            negativePrompt: 'lowres',
            promptParts: {
                base: 'masterpiece, red hair',
                inpainting: 'inpaint context',
                additional: 'cinematic lighting',
                workflow: 'scene mood',
                detail: 'intricate detail',
                negative: 'lowres',
            },
            params: {
                steps: 24,
                cfgScale: 6,
                cfgRescale: 0,
                sampler: 'k_euler',
                scheduler: 'exponential',
                variety: false,
            },
            filenamePolicyInput: {
                template: 'NAIS_{seed}',
                format: 'png',
                now: fixture.input.now,
                seed: 123456789,
            },
        })
        expect(result.plan.characters).toEqual([expect.objectContaining({
            characterId: 'character:hero',
            positive: 'hero base, blue eyes',
            negative: 'hero negative',
            position: { mode: 'ai-choice' },
        })])
        expect(result.plan.randomTrace).toHaveLength(1)
        expect(result.plan.randomTrace[0]).toMatchObject({
            result: 'red hair',
            seed: 123456789,
        })
        expect(result.plan.provenanceDetails.prompts).toHaveLength(7)
        expect(result.plan.provenanceDetails.params.find(item => item.field === 'cfgScale')?.winner.layer)
            .toBe('module-defaults')
        expect(result.plan.provenanceDetails.params.find(item => item.field === 'seed')?.winner)
            .toMatchObject({
                layer: 'workflow-runtime-override',
                sourceRef: { kind: 'request', path: ['randomSeed'] },
            })
        expect(result.plan.planHash).toMatchObject({
            version: 'composition-plan-hash-v2',
            algorithm: 'sha256-utf8-v1',
            canonicalization: 'composition-canonical-json-v1',
        })
        expect(result.plan.planHash.digest).toMatch(/^[0-9a-f]{64}$/)
        expect(result.plan.planHash.digest).toBe(
            '1e52dbe921c77490308b41f5f184be0f8f546ac505f01cebc27ccce6d9f94a03',
        )
        expect(result.plan.planId).toBe(
            `resolved-plan:${result.plan.planHash.version}:${result.plan.planHash.digest}`,
        )
        expect(Object.isFrozen(result.plan)).toBe(true)
        expect(Object.isFrozen(result.plan.params)).toBe(true)
    })

    it('is deeply deterministic and immutable for the same input snapshot', () => {
        const fixture = baseFixture()
        configureConcreteExample(fixture)

        const first = CompositionEngine.resolve(fixture.input)
        const second = CompositionEngine.resolve(fixture.input)

        expect(second).toEqual(first)
        expect(first.success && second.success && first.plan.planHash).toEqual(
            second.success && second.plan.planHash,
        )
        if (!first.success) throw new Error('Expected resolution to succeed')
        expect(() => {
            (first.plan.params as { steps: number }).steps = 999
        }).toThrow(TypeError)
        expect(fixture.input.engineDefaults.steps).toBe(typeFixturePlan.params.steps)
    })
})

describe('CompositionEngine prompt pipeline', () => {
    it('locks canonical slot order independently from contribution array order', () => {
        const fixture = baseFixture()
        fixture.request.contributions = [
            contribution('c:detail', { kind: 'positive', slot: 'detail' }, 'detail', '10'),
            contribution('c:workflow', { kind: 'positive', slot: 'workflow' }, 'workflow', '10'),
            contribution('c:base', { kind: 'positive', slot: 'base' }, 'base', '10'),
            contribution('c:additional', { kind: 'positive', slot: 'additional' }, 'additional', '10'),
            contribution('c:inpainting', { kind: 'positive', slot: 'inpainting' }, 'inpainting', '10'),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success && result.plan.positivePrompt).toBe(
            'base, inpainting, additional, workflow, detail',
        )
    })

    it('applies fragment expansion before replace/prepend/append operations', () => {
        const fixture = baseFixture()
        fixture.request.contributions = [
            contribution('c:append-before', { kind: 'positive', slot: 'base' }, 'discarded', '10'),
            contribution('c:replace', { kind: 'positive', slot: 'base' }, '<color>', '20', 'replace'),
            contribution('c:prepend', { kind: 'positive', slot: 'base' }, 'portrait', '30', 'prepend'),
            contribution('c:append-after', { kind: 'positive', slot: 'base' }, 'smile', '40'),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success && result.plan.positivePrompt).toBe('portrait, red hair, smile')
        expect(result.success && result.plan.randomTrace).toHaveLength(1)
        if (!result.success) throw new Error('Expected prompt operations to resolve')
        expect(result.plan.provenanceDetails.prompts.find(
            item => item.contributionId === 'c:append-before',
        )).toMatchObject({
            retainedAfterReplace: false,
            supersededByContributionId: 'c:replace',
        })
        expect(result.plan.provenanceDetails.prompts.find(
            item => item.contributionId === 'c:replace',
        )).toMatchObject({ retainedAfterReplace: true })
    })

    it('does not resolve or trace disabled contributions', () => {
        const fixture = baseFixture()
        const disabled = contribution(
            'c:disabled',
            { kind: 'positive', slot: 'base' },
            '<*sequence>',
            '10',
        )
        disabled.enabled = false
        fixture.request.contributions = [disabled]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        expect(result.success && result.plan.positivePrompt).toBe('')
        expect(result.success && result.plan.randomTrace).toEqual([])
        expect(result.sequenceCommitProposal).toBeNull()
    })

    it('does not reinterpret a fragment result as a comment after the comment stage', () => {
        const fixture = baseFixture()
        fixture.request.contributions = [
            contribution(
                'c:resolved-hash',
                { kind: 'positive', slot: 'base' },
                '<#resolved|#resolved>',
                '10',
            ),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success && result.plan.positivePrompt).toBe('#resolved')
    })

    it('skips disabled steps before dereferencing their missing module', () => {
        const fixture = baseFixture()
        const step = fixture.document.recipes[0].steps[0]
        step.enabled = false
        step.moduleId = 'module:missing'
        step.paramsOverride = { steps: 1 }
        fixture.request.contributions = [
            contribution('c:base', { kind: 'positive', slot: 'base' }, 'base', '10'),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        expect(result.warnings.map(item => item.code)).not.toContain('E_MODULE_REF_MISSING')
    })

    it('skips a condition-false module branch before dereferencing it', () => {
        const fixture = baseFixture()
        const step = fixture.document.recipes[0].steps[0]
        step.moduleId = 'module:condition-disabled-missing'
        fixture.input.conditionSnapshot = {
            modules: { [step.moduleId]: false },
        }

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        expect(result.success && result.plan.params.steps).toBe(fixture.input.engineDefaults.steps)
        expect(result.warnings.map(item => item.code)).not.toContain('E_MODULE_REF_MISSING')
    })

    it('sorts recipe steps by orderKey and stable ID before applying module defaults', () => {
        const firstFixture = baseFixture()
        const originalModule = firstFixture.document.modules[0]
        const originalStep = firstFixture.document.recipes[0].steps[0]
        originalStep.orderKey = 'b'
        originalModule.paramsOverride = { steps: 22 }

        const earlierModule = clone(originalModule)
        earlierModule.id = 'module:earlier'
        earlierModule.orderKey = 'a'
        earlierModule.paramsOverride = { steps: 11 }
        const earlierStep = clone(originalStep)
        earlierStep.id = 'recipe-step:earlier'
        earlierStep.orderKey = 'a'
        earlierStep.moduleId = earlierModule.id
        firstFixture.document.modules.push(earlierModule)
        firstFixture.document.profiles[0].moduleIds.push(earlierModule.id)
        firstFixture.document.recipes[0].steps = [originalStep, earlierStep]

        const secondFixture = baseFixture()
        const laterModule = secondFixture.document.modules[0]
        const laterStep = secondFixture.document.recipes[0].steps[0]
        laterStep.orderKey = 'b'
        laterModule.paramsOverride = { steps: 22 }
        const secondEarlierModule = clone(laterModule)
        secondEarlierModule.id = 'module:earlier'
        secondEarlierModule.orderKey = 'a'
        secondEarlierModule.paramsOverride = { steps: 11 }
        const secondEarlierStep = clone(laterStep)
        secondEarlierStep.id = 'recipe-step:earlier'
        secondEarlierStep.orderKey = 'a'
        secondEarlierStep.moduleId = secondEarlierModule.id
        secondFixture.document.modules.push(secondEarlierModule)
        secondFixture.document.profiles[0].moduleIds.push(secondEarlierModule.id)
        secondFixture.document.recipes[0].steps = [secondEarlierStep, laterStep]

        const first = CompositionEngine.resolve(firstFixture.input)
        const second = CompositionEngine.resolve(secondFixture.input)

        expect(first.success && first.plan.params.steps).toBe(22)
        expect(second.success && second.plan.params.steps).toBe(22)
        expect(first.success && second.success && first.plan.planHash).toEqual(
            second.success && second.plan.planHash,
        )
    })

    it('evaluates typed step and module condition snapshots without reading extensions', () => {
        const fixture = baseFixture()
        fixture.document.modules[0].contributions = [
            contribution('c:conditional', { kind: 'positive', slot: 'base' }, 'conditional', '10'),
        ]
        fixture.input = {
            ...fixture.input,
            conditionSnapshot: { modules: { [fixture.document.modules[0].id]: false } },
        }

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success && result.plan.positivePrompt).toBe('')
    })
})

describe('CompositionEngine references and recipe selection', () => {
    it('stops at document schema validation before semantic resolution', () => {
        const fixture = baseFixture()
        ;(fixture.document as unknown as { schemaVersion: number }).schemaVersion = 3

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(false)
        expect(result.errors.map(item => item.code)).toEqual(['E_DOCUMENT_SCHEMA_INVALID'])
        expect(result.plan).toBeNull()
        expect(result.randomTrace).toEqual([])
    })

    it.each([
        { policy: 'strict' as const, success: false, code: 'E_MODULE_REF_MISSING' },
        { policy: 'compatible' as const, success: true, code: 'W_MODULE_REF_MISSING_COMPATIBILITY' },
    ])('reports rather than silently skipping a missing module in $policy mode', ({ policy, success, code }) => {
        const fixture = baseFixture()
        fixture.document.recipes[0].steps[0].moduleId = 'module:missing'
        fixture.input = { ...fixture.input, referencePolicy: policy }

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(success)
        expect([...result.warnings, ...result.errors].map(item => item.code)).toContain(code)
        if (!success) expect(result.plan).toBeNull()
    })

    it.each([undefined, 'recipe:missing'])('never chooses the first enabled recipe for invalid ID %s', recipeId => {
        const fixture = baseFixture()
        fixture.request.recipeId = recipeId
        fixture.document.profiles[0].defaultRecipeId = fixture.document.recipes[0].id

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(false)
        expect(result.errors.map(item => item.code)).toContain('E_RECIPE_MISSING')
        expect(result.plan).toBeNull()
    })

    it('aligns document validation with strict resolution for unselected character targets', () => {
        const fixture = baseFixture()
        fixture.document.profiles[0].characterIds = []
        fixture.document.modules[0].contributions = [contribution(
            'contribution:unselected-character',
            { kind: 'character', characterId: 'character:hero', polarity: 'positive' },
            'blue eyes',
            '10',
        )]

        const semanticCodes = validateCompositionSemantics(fixture.document).map(issue => issue.code)
        const result = CompositionEngine.resolve(fixture.input)

        expect(semanticCodes).toContain('E_CHARACTER_REF_MISSING')
        expect(result.success).toBe(false)
        expect(result.errors.map(issue => issue.code)).toContain('E_CHARACTER_REF_MISSING')
    })
})

describe('CompositionEngine params precedence', () => {
    it('records all nine layers and preserves explicit false and zero winners', () => {
        const fixture = baseFixture()
        const profile = fixture.document.profiles[0]
        const module = fixture.document.modules[0]
        const step = fixture.document.recipes[0].steps[0]
        const recipe = fixture.document.recipes[0]

        fixture.input.engineDefaults.steps = 10
        profile.paramsOverride = { steps: 20 }
        module.paramsOverride = { steps: 30 }
        step.paramsOverride = { steps: 40 }
        recipe.paramsOverride = { steps: 50 }
        fixture.input = {
            ...fixture.input,
            sceneOverride: { params: { steps: 60 } },
            workflowRuntimeOverride: { params: { steps: 70, smea: false, cfgRescale: 0 } },
            transportDerivedOverride: { params: { steps: 80 } },
            capabilitySafetyClamp: { params: { steps: 90 } },
        }

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected params resolution to succeed')
        expect(result.plan.params).toMatchObject({ steps: 90, smea: false, cfgRescale: 0 })
        const steps = result.plan.provenanceDetails.params.find(item => item.field === 'steps')
        expect(steps?.sourceChain.map(source => source.layer)).toEqual([
            'engine-defaults',
            'profile-defaults',
            'module-defaults',
            'recipe-step-override',
            'recipe-override',
            'scene-override',
            'workflow-runtime-override',
            'transport-derived-override',
            'capability-safety-clamp',
        ])
        expect(steps?.winner.layer).toBe('capability-safety-clamp')
    })

    it('lets runtime override scene values when higher layers are absent', () => {
        const fixture = baseFixture()
        fixture.input = {
            ...fixture.input,
            sceneOverride: { params: { cfgScale: 2 } },
            workflowRuntimeOverride: { params: { cfgScale: 7 } },
        }

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success && result.plan.params.cfgScale).toBe(7)
        expect(result.success && result.plan.provenanceDetails.params
            .find(item => item.field === 'cfgScale')?.winner.layer).toBe('workflow-runtime-override')
    })

    it('uses the final params seed for composition random streams', () => {
        const fixture = baseFixture()
        delete fixture.request.randomSeed
        fixture.request.paramsOverride = { seed: 4242 }
        fixture.request.contributions = [
            contribution('c:seeded', { kind: 'positive', slot: 'base' }, '<color>', '10'),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected seeded resolution to succeed')
        expect(result.plan.params.seed).toBe(4242)
        expect(result.plan.randomTrace[0]?.seed).toBe(4242)
    })

    it('normalizes the winning generation seed to uint32 for params and random streams', () => {
        const fixture = baseFixture()
        delete fixture.request.randomSeed
        fixture.request.paramsOverride = { seed: -1 }
        fixture.request.contributions = [
            contribution('c:normalized-seed', { kind: 'positive', slot: 'base' }, '<color>', '10'),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected normalized seed resolution to succeed')
        expect(result.plan.params.seed).toBe(0xffff_ffff)
        expect(result.plan.randomTrace[0]?.seed).toBe(0xffff_ffff)
    })

    it('attributes an invalid final param to its winning precedence source', () => {
        const fixture = baseFixture()
        fixture.input.transportDerivedOverride = {
            params: { steps: 0 },
            sourceRef: { kind: 'external', source: 'transport:test' },
        }

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(false)
        expect(result.errors.find(item => item.code === 'E_PARAM_OUT_OF_RANGE')?.sourceRef)
            .toEqual({ kind: 'external', source: 'transport:test' })
    })
})

describe('CompositionEngine characters and positions', () => {
    function secondCharacter(): CharacterDefinition {
        const character = clone(typeFixtureDocument.characters[0])
        character.id = 'character:villain'
        character.orderKey = 'b0'
        character.name = 'Villain'
        character.positivePrompt = 'villain base'
        character.negativePrompt = 'villain negative'
        character.position = { mode: 'manual', x: 0.8, y: 0.5 }
        character.resourceBindings = []
        return character
    }

    it('resolves stable character IDs, prompt patches, and manual positions without payload indices', () => {
        const fixture = baseFixture()
        const hero = fixture.document.characters[0]
        hero.position = { mode: 'manual', x: 0.2, y: 0.5 }
        fixture.document.characters.push(secondCharacter())
        fixture.document.profiles[0].characterIds = [hero.id, 'character:villain']
        fixture.document.modules[0].characterPatches = [{
            characterId: hero.id,
            positivePrompt: 'patched hero',
            position: { mode: 'manual', x: 0.25, y: 0.6 },
        }]
        fixture.request.contributions = [contribution(
            'c:hero-detail',
            { kind: 'character', characterId: hero.id, polarity: 'positive' },
            'blue eyes',
            '10',
        )]
        fixture.input.engineDefaults.characterPositionEnabled = true

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected character resolution to succeed')
        expect(result.plan.characters.map(character => character.characterId)).toEqual([
            'character:hero',
            'character:villain',
        ])
        expect(result.plan.characters[0]).toMatchObject({
            characterId: 'character:hero',
            positive: 'patched hero, blue eyes',
            position: { mode: 'manual', x: 0.25, y: 0.6 },
        })
        expect(result.plan.characters[0]).not.toHaveProperty('index')
        expect(result.plan.provenanceDetails.characters.find(item => (
            item.characterId === hero.id && item.field === 'position'
        ))?.winnerSource).toMatchObject({ entityId: fixture.document.modules[0].id })
    })

    it('returns a blocking mixed-position error and no plan', () => {
        const fixture = baseFixture()
        fixture.document.characters[0].position = { mode: 'ai-choice' }
        fixture.document.characters.push(secondCharacter())
        fixture.document.profiles[0].characterIds = ['character:hero', 'character:villain']
        fixture.input.engineDefaults.characterPositionEnabled = true

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(false)
        expect(result.errors.map(item => item.code)).toContain('E_CHAR_POSITION_MODE_MIXED')
        expect(result.plan).toBeNull()
    })

    it('rejects out-of-range coordinates introduced by a request patch', () => {
        const fixture = baseFixture()
        fixture.request.characterPatches = [{
            characterId: 'character:hero',
            position: { mode: 'manual', x: 1.25, y: -0.1 },
        }]
        fixture.input.engineDefaults.characterPositionEnabled = true

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(false)
        expect(result.errors.filter(item => item.code === 'E_CHAR_POSITION_OUT_OF_RANGE'))
            .toHaveLength(2)
        expect(result.errors.every(item => item.sourceRef.kind === 'request')).toBe(true)
    })

    it('attributes a patched character fragment trace to the patch winner', () => {
        const fixture = baseFixture()
        fixture.document.modules[0].characterPatches = [{
            characterId: 'character:hero',
            positivePrompt: '<color>',
        }]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected character fragment resolution to succeed')
        expect(result.plan.randomTrace[0]?.provenance).toMatchObject({
            kind: 'entity',
            entityKind: 'module',
            entityId: fixture.document.modules[0].id,
        })
    })
})

describe('CompositionEngine random, output, hash, and diagnostics', () => {
    it('evaluates module random rules and records rule plus wildcard provenance', () => {
        const fixture = baseFixture()
        const rule = clone(typeFixtureDocument.randomRules[0])
        rule.source = { mode: 'seeded', seed: 77, algorithm: 'xorshift32-v1' }
        fixture.document.randomRules = [rule]
        fixture.document.modules[0].randomRuleIds = [rule.id]
        fixture.request.contributions = [
            contribution('c:wildcard', { kind: 'positive', slot: 'base' }, '<color>', '10'),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected random resolution to succeed')
        expect(result.plan.randomTrace.map(trace => trace.ruleId)).toEqual([
            rule.id,
            'fragment-random:fragment:color',
        ])
        expect(result.plan.provenanceDetails.randomSelections).toHaveLength(2)
    })

    it('returns but never commits a sequential proposal', () => {
        const fixture = baseFixture()
        fixture.request.contributions = [
            contribution('c:sequence', { kind: 'positive', slot: 'base' }, '<*sequence>', '10'),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        expect(result.success && result.plan.positivePrompt).toBe('first')
        expect(result.sequenceCommitProposal).toEqual({
            expectedRevision: 4,
            changes: [{
                fragmentId: 'fragment:sequence',
                fragmentPath: 'sequence',
                expectedCounter: 0,
                nextCounter: 1,
            }],
        })
        expect(fixture.input.fragment.sequenceSnapshot.counters).toEqual({})
    })

    it('consumes sequential fragments in main then stable-character target order', () => {
        const fixture = baseFixture()
        fixture.document.characters[0].positivePrompt = '<*sequence>'
        fixture.request.contributions = [
            contribution('c:main-sequence', { kind: 'positive', slot: 'base' }, '<*sequence>', '10'),
        ]

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected cross-target sequence resolution to succeed')
        expect(result.plan.positivePrompt).toBe('first')
        expect(result.plan.characters[0].positive).toBe('second')
        expect(result.sequenceCommitProposal?.changes[0]).toMatchObject({
            expectedCounter: 0,
            nextCounter: 2,
        })
    })

    it('carries virtual sequence counters across targets and suppresses them on later failure', () => {
        const fixture = baseFixture()
        fixture.request.contributions = [
            contribution('c:sequence-base', { kind: 'positive', slot: 'base' }, '<*sequence>', '10'),
            contribution('c:sequence-detail', { kind: 'positive', slot: 'detail' }, '<*sequence>', '10'),
        ]

        const success = CompositionEngine.resolve(fixture.input)
        expect(success.success && success.plan.positivePrompt).toBe('first, second')
        expect(success.sequenceCommitProposal?.changes).toEqual([expect.objectContaining({
            fragmentId: 'fragment:sequence',
            expectedCounter: 0,
            nextCounter: 2,
        })])

        fixture.request.contributions.push(
            contribution('c:missing', { kind: 'positive', slot: 'detail' }, '<missing>', '20'),
        )
        const failure = CompositionEngine.resolve(fixture.input)
        expect(failure.success).toBe(false)
        expect(failure.sequenceCommitProposal).toBeNull()
        expect(fixture.input.fragment.sequenceSnapshot.counters).toEqual({})
    })

    it('merges output policy and creates filename inputs from injected now', () => {
        const fixture = baseFixture()
        fixture.document.modules[0].outputPolicy = memoryPolicy('webp', 'module_{seed}')
        fixture.document.recipes[0].steps[0].outputPolicy = memoryPolicy('png', 'step_{seed}')
        fixture.request.outputPolicy = memoryPolicy('webp', 'runtime_{seed}')

        const result = CompositionEngine.resolve(fixture.input)

        expect(result.success).toBe(true)
        if (!result.success) throw new Error('Expected output resolution to succeed')
        expect(result.plan.outputPolicy).toMatchObject({ format: 'webp', filenameTemplate: 'runtime_{seed}' })
        expect(result.plan.filenamePolicyInput).toMatchObject({
            template: 'runtime_{seed}',
            format: 'webp',
            now: fixture.input.now,
        })
        expect(result.plan.provenanceDetails.outputPolicy
            .find(item => item.fieldPath[0] === 'format')?.winnerSource).toMatchObject({
                kind: 'request',
                requestId: fixture.request.requestId,
            })
    })

    it('warns for inert unknown extensions without changing the semantic hash', () => {
        const firstFixture = baseFixture()
        const secondFixture = baseFixture()
        firstFixture.document.extensions = { futureFlag: true, apiToken: 'secret-one' }
        secondFixture.document.extensions = { apiToken: 'secret-two', futureFlag: false }

        const first = CompositionEngine.resolve(firstFixture.input)
        const second = CompositionEngine.resolve(secondFixture.input)

        expect(first.success && second.success).toBe(true)
        if (!first.success || !second.success) throw new Error('Expected extension resolution to succeed')
        expect(first.warnings.map(item => item.code)).toEqual([
            'W_UNKNOWN_EXTENSION',
            'W_UNKNOWN_EXTENSION',
        ])
        expect(second.warnings.map(item => item.code)).toEqual(first.warnings.map(item => item.code))
        expect(second.plan.planHash).toEqual(first.plan.planHash)
        expect(JSON.stringify(first.plan)).not.toContain('secret-one')
        expect(JSON.stringify(second.plan)).not.toContain('secret-two')
    })

    it('hashes a credential-redacted URI identity when no resource digest exists', () => {
        const makeResource = (uri: string): ResourceRef => ({
            id: 'resource:uri-source',
            revision: 1,
            createdAt: timestamp,
            createdBy: actor,
            updatedAt: timestamp,
            updatedBy: actor,
            orderKey: 'a0',
            kind: 'uri',
            enabled: true,
            role: 'source-image',
            uri,
        })
        const configure = (fixture: EngineFixture, uri: string): void => {
            fixture.document.resources = [makeResource(uri)]
            fixture.request.resourceBindings = [{
                resourceId: 'resource:uri-source',
                enabled: true,
                referenceType: 'character&style',
                strength: 0.5,
            }]
        }

        const firstFixture = baseFixture()
        const secondFixture = baseFixture()
        configure(firstFixture, 'https://user:secret@example.com/images/a.png?token=one&size=large#x')
        configure(secondFixture, 'https://other:secret@example.com/images/a.png?token=two&size=small#y')
        const first = CompositionEngine.resolve(firstFixture.input)
        const redactedEquivalent = CompositionEngine.resolve(secondFixture.input)

        expect(first.success && redactedEquivalent.success).toBe(true)
        if (!first.success || !redactedEquivalent.success) throw new Error('Expected URI resolution')
        expect(first.plan.planHash).toEqual(redactedEquivalent.plan.planHash)

        const changedPathFixture = baseFixture()
        configure(changedPathFixture, 'https://example.com/images/b.png?token=three&size=large')
        const changedPath = CompositionEngine.resolve(changedPathFixture.input)
        expect(changedPath.success).toBe(true)
        if (!changedPath.success) throw new Error('Expected changed URI resolution')
        expect(first.plan.planHash.digest).not.toBe(changedPath.plan.planHash.digest)
    })

    it('keeps disabled characters and bindings inert for resolution and hashing', () => {
        const inactiveFixture = baseFixture()
        const baselineFixture = baseFixture()
        inactiveFixture.document.characters[0].enabled = false
        inactiveFixture.document.characters[0].positivePrompt = '<*sequence>'
        inactiveFixture.document.characters[0].resourceBindings = [{
            resourceId: 'resource:missing-disabled-character',
            enabled: true,
            referenceType: 'character&style',
            strength: 1,
        }]
        inactiveFixture.request.resourceBindings = [{
            resourceId: 'resource:missing-disabled-binding',
            enabled: false,
            referenceType: 'character&style',
            strength: 1,
        }]
        baselineFixture.document.characters[0].enabled = false
        baselineFixture.document.characters[0].positivePrompt = 'different inactive text'

        const inactive = CompositionEngine.resolve(inactiveFixture.input)
        const baseline = CompositionEngine.resolve(baselineFixture.input)

        expect(inactive.success && baseline.success).toBe(true)
        if (!inactive.success || !baseline.success) throw new Error('Expected inactive state to resolve')
        expect(inactive.plan.randomTrace).toEqual([])
        expect(inactive.sequenceCommitProposal).toBeNull()
        expect(inactive.plan.resources).toEqual([])
        expect(inactive.plan.planHash).toEqual(baseline.plan.planHash)
    })

    it('hashes only filename inputs referenced by the filename template', () => {
        const firstFixture = baseFixture()
        const secondFixture = baseFixture()
        firstFixture.document.profiles[0].outputPolicy.filenameTemplate = 'constant-name'
        secondFixture.document.profiles[0].outputPolicy.filenameTemplate = 'constant-name'
        secondFixture.request.requestId = 'request:different'
        secondFixture.input.now = '2030-01-01T00:00:00.000Z'

        const first = CompositionEngine.resolve(firstFixture.input)
        const second = CompositionEngine.resolve(secondFixture.input)
        expect(first.success && second.success).toBe(true)
        if (!first.success || !second.success) throw new Error('Expected filename resolution')
        expect(first.plan.planHash).toEqual(second.plan.planHash)

        firstFixture.document.profiles[0].outputPolicy.filenameTemplate = '{requestId}_{now}'
        secondFixture.document.profiles[0].outputPolicy.filenameTemplate = '{requestId}_{now}'
        const referencedFirst = CompositionEngine.resolve(firstFixture.input)
        const referencedSecond = CompositionEngine.resolve(secondFixture.input)
        expect(referencedFirst.success && referencedSecond.success).toBe(true)
        if (!referencedFirst.success || !referencedSecond.success) {
            throw new Error('Expected referenced filename resolution')
        }
        expect(referencedFirst.plan.planHash.digest).not.toBe(referencedSecond.plan.planHash.digest)
    })
})

describe('CompositionEngine platform contract', () => {
    it('keeps every pure Composition module free of platform imports and ambient runtime APIs', async () => {
        const root = resolve(process.cwd(), 'src/domain/composition')
        const files = [
            'engine.ts',
            'provenance.ts',
            'canonical-serialize.ts',
            'random.ts',
            'fragment-resolver.ts',
            'prompt-normalizer.ts',
            'precedence.ts',
            'validation.ts',
            'schema.ts',
        ]
        const forbidden = /(?:from\s+['"](?:react|zustand|node:|electron|@tauri)|indexedDB|Math\.random\(|Date\.now\()/

        for (const file of files) {
            expect(await readFile(resolve(root, file), 'utf8'), file).not.toMatch(forbidden)
        }
    })
})
