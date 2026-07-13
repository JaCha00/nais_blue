import { describe, expect, it } from 'vitest'

import {
    RESOLUTION_ISSUE_CODE_ORDER,
    RESOLUTION_ISSUE_DEFINITIONS,
    createResolutionIssue,
    sortResolutionIssues,
    validateCharacterPositionModes,
    validateCompositionSemantics,
    validateParamsRanges,
    validateUnknownExtensions,
} from '@/domain/composition/validation'
import type {
    CompositionDocument,
    ProvenanceRef,
    ResolutionIssueCode,
} from '@/domain/composition/types'
import { typeFixtureDocument } from '@/domain/composition/types.typecheck'

const sourceRef = {
    kind: 'external',
    source: 'composition-validation-test',
} satisfies ProvenanceRef

function cloneDocument(): CompositionDocument {
    return JSON.parse(JSON.stringify(typeFixtureDocument)) as CompositionDocument
}

describe('Composition resolution issues', () => {
    it.each([
        ['E_PROFILE_MISSING', 'error', true, 'composition.issue.profileMissing', 'select-profile'],
        ['E_RECIPE_MISSING', 'error', true, 'composition.issue.recipeMissing', 'select-recipe'],
        ['E_MODULE_REF_MISSING', 'error', true, 'composition.issue.moduleReferenceMissing', 'repair-module-reference'],
        ['E_PARAMS_PRESET_MISSING', 'error', true, 'composition.issue.paramsPresetMissing', 'repair-reference'],
        ['E_CHARACTER_REF_MISSING', 'error', true, 'composition.issue.characterReferenceMissing', 'repair-reference'],
        ['E_RANDOM_RULE_REF_MISSING', 'error', true, 'composition.issue.randomRuleReferenceMissing', 'repair-reference'],
        ['E_RESOURCE_REF_MISSING', 'error', true, 'composition.issue.resourceReferenceMissing', 'repair-reference'],
        ['E_PARAM_OUT_OF_RANGE', 'error', true, 'composition.issue.paramOutOfRange', 'adjust-parameter'],
        ['E_CHAR_POSITION_MODE_MIXED', 'error', true, 'composition.issue.characterPositionModeMixed', 'choose-character-position-mode'],
        ['W_FRAGMENT_MISSING', 'warning', false, 'composition.issue.fragmentMissing', 'restore-fragment'],
        ['W_MODULE_DISABLED', 'warning', false, 'composition.issue.moduleDisabled', 'enable-module'],
        ['W_UNKNOWN_EXTENSION', 'warning', false, 'composition.issue.unknownExtension', 'review-extension'],
        ['W_PAYLOAD_PARITY_UNVERIFIED_MODEL', 'warning', false, 'composition.issue.payloadParityUnverifiedModel', 'select-verified-model'],
        ['W_PATH_CAPABILITY_FALLBACK', 'warning', false, 'composition.issue.pathCapabilityFallback', 'review-output-path'],
    ] satisfies Array<[ResolutionIssueCode, 'error' | 'warning', boolean, string, string]>) (
        'keeps the serialized contract stable for %s',
        (code, severity, blocking, messageKey, actionId) => {
            const issue = createResolutionIssue(code, {
                sourceRef,
                entityRef: { kind: 'module', id: 'module:test' },
                fieldPath: ['modules', 0],
            })

            expect(issue).toEqual({
                code,
                severity,
                messageKey,
                sourceRef,
                entityRef: { kind: 'module', id: 'module:test' },
                fieldPath: ['modules', 0],
                repairHintKey: RESOLUTION_ISSUE_DEFINITIONS[code].repairHintKey,
                actionId,
                blocking,
            })
        },
    )

    it('sorts issues by stable code order without mutating the input', () => {
        const input = [
            createResolutionIssue('W_PATH_CAPABILITY_FALLBACK', { sourceRef, fieldPath: ['z'] }),
            createResolutionIssue('E_PARAM_OUT_OF_RANGE', { sourceRef, fieldPath: ['b'] }),
            createResolutionIssue('E_PARAM_OUT_OF_RANGE', { sourceRef, fieldPath: ['a'] }),
            createResolutionIssue('E_RECIPE_MISSING', { sourceRef, fieldPath: [] }),
        ]

        expect(sortResolutionIssues(input).map(issue => [issue.code, issue.fieldPath])).toEqual([
            ['E_RECIPE_MISSING', []],
            ['E_PARAM_OUT_OF_RANGE', ['a']],
            ['E_PARAM_OUT_OF_RANGE', ['b']],
            ['W_PATH_CAPABILITY_FALLBACK', ['z']],
        ])
        expect(input[0].code).toBe('W_PATH_CAPABILITY_FALLBACK')
        expect(RESOLUTION_ISSUE_CODE_ORDER).toHaveLength(14)
    })
})

describe('Composition param validation', () => {
    it.each([
        ['width', 0, { height: 1024 }],
        ['height', 1.5, { width: 1024 }],
        ['steps', 0, {}],
        ['cfgScale', -0.01, {}],
        ['cfgRescale', 1.01, {}],
        ['seed', 0x1_0000_0000, {}],
        ['ucPreset', -1, {}],
        ['strength', -0.01, {}],
        ['noise', Number.POSITIVE_INFINITY, {}],
    ] as const)(
        'reports %s=%s as out of range',
        (field, value, companion) => {
            const issues = validateParamsRanges({ ...companion, [field]: value }, {
                sourceRef,
                fieldPath: ['params'],
            })

            expect(issues).toContainEqual(expect.objectContaining({
                code: 'E_PARAM_OUT_OF_RANGE',
                severity: 'error',
                blocking: true,
                fieldPath: ['params', field],
            }))
        },
    )

    it.each([
        [{ width: 1024 }, ['params', 'height']],
        [{ height: 1024 }, ['params', 'width']],
    ] as const)('requires width and height as a pair', (params, fieldPath) => {
        expect(validateParamsRanges(params, { sourceRef, fieldPath: ['params'] })).toEqual([
            expect.objectContaining({
                code: 'E_PARAM_OUT_OF_RANGE',
                fieldPath,
            }),
        ])
    })

    it('accepts explicit zero for zero-inclusive fields', () => {
        expect(validateParamsRanges({
            width: 1,
            height: 1,
            steps: 1,
            cfgScale: 0,
            cfgRescale: 0,
            seed: 0,
            ucPreset: 0,
            strength: 0,
            noise: 0,
        }, { sourceRef })).toEqual([])
    })
})

describe('Composition position and extension validation', () => {
    it.each([
        {
            name: 'mixed enabled characters',
            characters: [
                { characterId: 'character:a', position: { mode: 'ai-choice' as const } },
                { characterId: 'character:b', position: { mode: 'manual' as const, x: 0, y: 1 } },
            ],
            characterPositionEnabled: undefined,
            issueCount: 1,
        },
        {
            name: 'manual position while coordinates are disabled',
            characters: [
                { characterId: 'character:a', position: { mode: 'manual' as const, x: 0, y: 0 } },
            ],
            characterPositionEnabled: false,
            issueCount: 1,
        },
        {
            name: 'AI choice while coordinates are enabled',
            characters: [
                { characterId: 'character:a', position: { mode: 'ai-choice' as const } },
            ],
            characterPositionEnabled: true,
            issueCount: 1,
        },
        {
            name: 'disabled conflicting character',
            characters: [
                { characterId: 'character:a', position: { mode: 'manual' as const, x: 0, y: 0 } },
                { characterId: 'character:b', enabled: false, position: { mode: 'ai-choice' as const } },
            ],
            characterPositionEnabled: true,
            issueCount: 0,
        },
    ])('handles $name', ({ characters, characterPositionEnabled, issueCount }) => {
        const issues = validateCharacterPositionModes({
            characters,
            characterPositionEnabled,
            sourceRef,
            fieldPath: ['characters'],
        })

        expect(issues).toHaveLength(issueCount)
        if (issueCount > 0) {
            expect(issues[0]).toMatchObject({
                code: 'E_CHAR_POSITION_MODE_MIXED',
                fieldPath: ['characters', 'position'],
                blocking: true,
            })
        }
    })

    it('preserves extensions while warning for unknown keys in stable key order', () => {
        const extensions = { 'éclair': true, zebra: true, supported: 0, alpha: false, _under: true, Zed: true }
        const issues = validateUnknownExtensions({
            extensions,
            knownKeys: ['supported'],
            sourceRef,
            fieldPath: ['extensions'],
        })

        expect(extensions).toEqual({ 'éclair': true, zebra: true, supported: 0, alpha: false, _under: true, Zed: true })
        expect(issues.map(issue => issue.fieldPath)).toEqual([
            ['extensions', 'Zed'],
            ['extensions', '_under'],
            ['extensions', 'alpha'],
            ['extensions', 'zebra'],
            ['extensions', 'éclair'],
        ])
        expect(issues.every(issue => issue.code === 'W_UNKNOWN_EXTENSION' && !issue.blocking)).toBe(true)
    })
})

describe('Composition document semantic validation', () => {
    it('blocks every document-owned typed reference that strict resolution would reject', () => {
        const document = cloneDocument()
        const profile = document.profiles[0]
        const module = document.modules[0]
        const step = document.recipes[0].steps[0]
        const character = document.characters[0]
        const preset = document.paramsPresets[0]

        document.activeProfileId = 'profile:missing'
        profile.characterIds = ['character:missing']
        profile.paramsPresetIds = ['params-preset:missing']
        profile.defaultParamsPresetId = 'params-preset:missing'
        profile.randomRuleIds = ['random-rule:missing']
        profile.paramsOverride = { sourceImageResourceId: 'resource:missing' }
        profile.resourceBindings = [{
            resourceId: 'resource:missing',
            enabled: true,
            referenceType: 'vibe',
            strength: 0.5,
        }]
        profile.contributions = [{
            ...structuredClone(module.contributions[0]),
            id: 'contribution:missing-refs',
            target: { kind: 'character', characterId: 'character:missing', polarity: 'positive' },
            randomRuleId: 'random-rule:missing',
        }]
        profile.characterPatches = [{
            characterId: 'character:missing',
            resourceBindings: [{
                resourceId: 'resource:missing',
                enabled: true,
                referenceType: 'character',
                strength: 0.5,
            }],
        }]
        module.randomRuleIds = ['random-rule:missing']
        module.paramsOverride = { sourceImageResourceId: 'resource:missing' }
        step.randomRuleIds = ['random-rule:missing']
        step.paramsOverride = { maskResourceId: 'resource:missing' }
        character.resourceBindings = [{
            resourceId: 'resource:missing',
            enabled: true,
            referenceType: 'character',
            strength: 0.5,
        }]
        character.enabled = true
        preset.params = { sourceImageResourceId: 'resource:missing' }

        const issues = validateCompositionSemantics(document)
        const codes = new Set(issues.filter(issue => issue.blocking).map(issue => issue.code))

        expect(codes).toEqual(new Set([
            'E_PROFILE_MISSING',
            'E_PARAMS_PRESET_MISSING',
            'E_CHARACTER_REF_MISSING',
            'E_RANDOM_RULE_REF_MISSING',
            'E_RESOURCE_REF_MISSING',
        ]))
        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'E_RESOURCE_REF_MISSING',
                fieldPath: ['profiles', 0, 'paramsOverride', 'sourceImageResourceId'],
            }),
            expect.objectContaining({
                code: 'E_CHARACTER_REF_MISSING',
                fieldPath: ['profiles', 0, 'moduleIds', 0, 'characterPatches', 0, 'characterId'],
            }),
            expect.objectContaining({
                code: 'E_RANDOM_RULE_REF_MISSING',
                fieldPath: ['profiles', 0, 'contributions', 0, 'randomRuleId'],
            }),
        ]))
        expect(issues.every(issue => issue.severity === 'error' && issue.blocking)).toBe(true)
    })

    it('rejects globally defined characters that are not selected by the owning profile path', () => {
        const document = cloneDocument()
        document.profiles[0].characterIds = []

        const issues = validateCompositionSemantics(document)

        expect(issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'E_CHARACTER_REF_MISSING',
                fieldPath: ['profiles', 0, 'moduleIds', 0, 'characterPatches', 0, 'characterId'],
            }),
            expect.objectContaining({
                code: 'E_CHARACTER_REF_MISSING',
                fieldPath: ['profiles', 0, 'moduleIds', 0, 'contributions', 0, 'target', 'characterId'],
            }),
            expect.objectContaining({
                code: 'E_CHARACTER_REF_MISSING',
                fieldPath: [
                    'profiles', 0, 'recipeIds', 0, 'steps', 0,
                    'module', 'contributions', 0, 'target', 'characterId',
                ],
            }),
        ]))
    })

    it('reports missing references, disabled modules, and invalid params deterministically', () => {
        const document = cloneDocument()
        document.profiles[0].defaultRecipeId = 'recipe:missing'
        document.modules[0].enabled = false
        document.recipes[0].steps[0].moduleId = 'module:missing'
        document.paramsPresets[0].params.steps = 0

        const first = validateCompositionSemantics(document)
        const second = validateCompositionSemantics(document)

        expect(second).toEqual(first)
        expect(first.map(issue => issue.code)).toEqual([
            'E_RECIPE_MISSING',
            'E_MODULE_REF_MISSING',
            'E_PARAM_OUT_OF_RANGE',
            'W_MODULE_DISABLED',
        ])
        expect(first).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'E_RECIPE_MISSING',
                entityRef: { kind: 'profile', id: document.profiles[0].id },
                fieldPath: ['profiles', 0, 'defaultRecipeId'],
            }),
            expect.objectContaining({
                code: 'E_MODULE_REF_MISSING',
                entityRef: { kind: 'recipe-step', id: document.recipes[0].steps[0].id },
                fieldPath: ['recipes', 0, 'steps', 0, 'moduleId'],
            }),
            expect.objectContaining({
                code: 'E_PARAM_OUT_OF_RANGE',
                entityRef: { kind: 'params-preset', id: document.paramsPresets[0].id },
                fieldPath: ['paramsPresets', 0, 'params', 'steps'],
            }),
            expect.objectContaining({
                code: 'W_MODULE_DISABLED',
                entityRef: { kind: 'profile', id: document.profiles[0].id },
                fieldPath: ['profiles', 0, 'moduleIds', 0],
            }),
        ]))
    })

    it('treats tombstoned references as missing and ignores tombstoned params owners', () => {
        const document = cloneDocument()
        document.modules[0].deletedAt = '2026-07-11T01:00:00.000Z'
        document.modules[0].paramsOverride = { steps: 0 }

        const issues = validateCompositionSemantics(document)

        expect(issues.filter(issue => issue.code === 'E_MODULE_REF_MISSING')).toHaveLength(2)
        expect(issues).not.toContainEqual(expect.objectContaining({
            code: 'E_PARAM_OUT_OF_RANGE',
            entityRef: { kind: 'module', id: document.modules[0].id },
        }))
    })

    it('does not let disabled recipe steps create generation-blocking issues', () => {
        const document = cloneDocument()
        document.recipes[0].steps[0].enabled = false
        document.recipes[0].steps[0].moduleId = 'module:missing'
        document.recipes[0].steps[0].paramsOverride = { steps: 0 }

        expect(validateCompositionSemantics(document)).toEqual([])
    })
})
