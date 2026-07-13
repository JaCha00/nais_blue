import { describe, expect, it } from 'vitest'

import {
    COMPOSITION_PROVENANCE_VERSION,
    CompositionProvenanceCollector,
    collectCompositionProvenance,
    createEntityProvenanceRef,
    createExternalProvenanceRef,
    createImmutableSerializableSnapshot,
    createRequestProvenanceRef,
    flattenProvenanceRefs,
    provenanceRefIdentity,
} from '@/domain/composition/provenance'
import type {
    PromptContribution,
    ProvenanceRef,
    RandomTraceEntry,
} from '@/domain/composition/types'

const actor = {
    kind: 'system',
    id: 'actor:test',
} as const

function contribution(
    id: string,
    slot: 'base' | 'additional',
    orderKey: string,
): PromptContribution {
    return {
        id,
        revision: 1,
        createdAt: '2026-07-11T00:00:00.000Z',
        createdBy: actor,
        updatedAt: '2026-07-11T00:00:00.000Z',
        updatedBy: actor,
        orderKey,
        enabled: true,
        target: { kind: 'positive', slot },
        text: id,
        merge: 'append',
    }
}

const moduleRef = createEntityProvenanceRef('module', { id: 'module:hero', revision: 3 })
const stepRef = createEntityProvenanceRef('recipe-step', { id: 'step:hero', revision: 5 })
const recipeRef = createEntityProvenanceRef('recipe', { id: 'recipe:scene', revision: 7 })
const runtimeRef = createRequestProvenanceRef('request:generate', ['paramsOverride'])
const engineRef = createExternalProvenanceRef('composition-engine-defaults')
const profileRef = createEntityProvenanceRef('profile', { id: 'profile:main', revision: 2 })
const characterRef = createEntityProvenanceRef('character', { id: 'character:alice', revision: 4 })

function randomTrace(
    streamKey: string,
    drawIndex: number,
    provenance?: ProvenanceRef,
): RandomTraceEntry {
    return {
        ruleId: `rule:${streamKey}`,
        streamKey,
        drawIndex,
        seed: 42,
        result: 'selected',
        selectedOptionIds: ['option:selected'],
        ...(provenance === undefined ? {} : { provenance }),
    }
}

describe('Composition provenance', () => {
    it('creates stable entity, request, and external source references defensively', () => {
        const entityPath: Array<string | number> = ['steps', 0]
        const requestPath: Array<string | number> = ['contributions', 1]
        const externalPath: Array<string | number> = ['defaults', 'model']

        const entity = createEntityProvenanceRef('recipe-step', {
            id: 'step:one',
            revision: 9,
        }, entityPath)
        const request = createRequestProvenanceRef('request:one', requestPath)
        const external = createExternalProvenanceRef('engine-defaults', {
            digest: 'sha256:abc',
            path: externalPath,
        })

        entityPath.push('changed')
        requestPath.push('changed')
        externalPath.push('changed')

        expect(entity).toEqual({
            kind: 'entity',
            entityKind: 'recipe-step',
            entityId: 'step:one',
            revision: 9,
            path: ['steps', 0],
        })
        expect(request).toEqual({
            kind: 'request',
            requestId: 'request:one',
            path: ['contributions', 1],
        })
        expect(external).toEqual({
            kind: 'external',
            source: 'engine-defaults',
            digest: 'sha256:abc',
            path: ['defaults', 'model'],
        })
    })

    it('uses collision-safe identities when stable IDs contain separators', () => {
        const left = createExternalProvenanceRef('source:a', { digest: 'b' })
        const right = createExternalProvenanceRef('source', { digest: 'a:b' })

        expect(provenanceRefIdentity(left)).not.toBe(provenanceRefIdentity(right))
    })

    it('records every winner category in deterministic canonical order', () => {
        const snapshot = collectCompositionProvenance({
            prompts: [
                {
                    contribution: contribution('contribution:additional', 'additional', 'b'),
                    applicationIndex: 1,
                    sourceChain: [moduleRef, stepRef, recipeRef],
                },
                {
                    contribution: contribution('contribution:base', 'base', 'a'),
                    applicationIndex: 0,
                    retainedAfterReplace: false,
                    supersededByContributionId: 'contribution:replacement',
                    sourceChain: [moduleRef, stepRef, recipeRef, runtimeRef, moduleRef],
                },
            ],
            params: [
                {
                    field: 'steps',
                    winner: { layer: 'workflow-runtime-override', sourceRef: runtimeRef },
                    sourceChain: [
                        { layer: 'profile-defaults', sourceRef: profileRef },
                        { layer: 'engine-defaults', sourceRef: engineRef },
                    ],
                },
                {
                    field: 'model',
                    winner: { layer: 'profile-defaults', sourceRef: profileRef },
                    sourceChain: [{ layer: 'engine-defaults', sourceRef: engineRef }],
                },
            ],
            characters: [
                {
                    characterId: 'character:bob',
                    field: 'position',
                    winnerSource: runtimeRef,
                    sourceChain: [characterRef],
                },
                {
                    characterId: 'character:alice',
                    field: 'negative',
                    winnerSource: runtimeRef,
                    sourceChain: [characterRef],
                },
                {
                    characterId: 'character:alice',
                    field: 'positive',
                    winnerSource: characterRef,
                },
            ],
            outputPolicy: [
                {
                    fieldPath: ['format'],
                    winnerSource: runtimeRef,
                    sourceChain: [profileRef],
                },
                {
                    fieldPath: ['destination'],
                    winnerSource: profileRef,
                },
            ],
            randomSelections: [
                {
                    trace: randomTrace('fragment:z', 1, moduleRef),
                    sourceChain: [recipeRef],
                },
                {
                    trace: randomTrace('fragment:a', 0, stepRef),
                    sourceChain: [recipeRef],
                },
            ],
        })

        expect(snapshot.version).toBe(COMPOSITION_PROVENANCE_VERSION)
        expect(snapshot.prompts.map(item => item.contributionId)).toEqual([
            'contribution:base',
            'contribution:additional',
        ])
        expect(snapshot.prompts[0].sourceChain).toEqual([
            moduleRef,
            stepRef,
            recipeRef,
            runtimeRef,
        ])
        expect(snapshot.prompts[0]).toMatchObject({
            retainedAfterReplace: false,
            supersededByContributionId: 'contribution:replacement',
        })
        expect(snapshot.prompts[1].retainedAfterReplace).toBe(true)
        expect(snapshot.params.map(item => item.field)).toEqual(['model', 'steps'])
        expect(snapshot.params[1].sourceChain.map(item => item.layer)).toEqual([
            'engine-defaults',
            'profile-defaults',
            'workflow-runtime-override',
        ])
        expect(snapshot.params[1].winner).toEqual({
            layer: 'workflow-runtime-override',
            sourceRef: runtimeRef,
        })
        expect(snapshot.characters.map(item => `${item.characterId}:${item.field}`)).toEqual([
            'character:alice:positive',
            'character:alice:negative',
            'character:bob:position',
        ])
        expect(snapshot.outputPolicy.map(item => item.fieldPath)).toEqual([
            ['destination'],
            ['format'],
        ])
        expect(snapshot.randomSelections.map(item => item.trace.streamKey)).toEqual([
            'fragment:a',
            'fragment:z',
        ])
        expect(snapshot.randomSelections[0].sourceChain).toEqual([recipeRef, stepRef])
    })

    it('produces the same snapshot for different record insertion orders', () => {
        const baseInput = {
            contribution: contribution('contribution:base', 'base', 'a'),
            applicationIndex: 0,
            sourceChain: [moduleRef, recipeRef],
        } as const
        const additionalInput = {
            contribution: contribution('contribution:additional', 'additional', 'b'),
            applicationIndex: 1,
            sourceChain: [moduleRef, recipeRef],
        } as const

        expect(collectCompositionProvenance({
            prompts: [baseInput, additionalInput],
        })).toEqual(collectCompositionProvenance({
            prompts: [additionalInput, baseInput],
        }))
    })

    it('collector snapshots are defensive, recursively frozen, and JSON serializable', () => {
        const mutableRuntimeRef = createRequestProvenanceRef('request:mutable', ['before'])
        const mutableContribution = contribution('contribution:mutable', 'base', 'a')
        const collector = new CompositionProvenanceCollector().recordPrompt({
            contribution: mutableContribution,
            applicationIndex: 0,
            sourceChain: [mutableRuntimeRef],
        })

        if (mutableRuntimeRef.kind === 'request') mutableRuntimeRef.path?.push('after')
        mutableContribution.target = { kind: 'negative' }
        const snapshot = collector.snapshot()

        expect(snapshot.prompts[0].target).toEqual({ kind: 'positive', slot: 'base' })
        expect(snapshot.prompts[0].sourceChain[0]).toEqual({
            kind: 'request',
            requestId: 'request:mutable',
            path: ['before'],
        })
        expect(Object.isFrozen(snapshot)).toBe(true)
        expect(Object.isFrozen(snapshot.prompts)).toBe(true)
        expect(Object.isFrozen(snapshot.prompts[0].sourceChain[0])).toBe(true)
        expect(() => {
            (snapshot.prompts as unknown as PromptContributionProvenanceMutation[]).push({})
        }).toThrow(TypeError)
        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    })

    it('flattens structured provenance into stable deduplicated plan references', () => {
        const snapshot = collectCompositionProvenance({
            prompts: [{
                contribution: contribution('contribution:base', 'base', 'a'),
                applicationIndex: 0,
                sourceChain: [moduleRef, recipeRef],
            }],
            params: [{
                field: 'steps',
                winner: { layer: 'workflow-runtime-override', sourceRef: runtimeRef },
                sourceChain: [
                    { layer: 'module-defaults', sourceRef: moduleRef },
                    { layer: 'recipe-override', sourceRef: recipeRef },
                ],
            }],
            characters: [{
                characterId: 'character:alice',
                field: 'positive',
                winnerSource: characterRef,
                sourceChain: [moduleRef, characterRef],
            }],
            randomSelections: [{
                trace: randomTrace('fragment:weather', 0, moduleRef),
                sourceChain: [recipeRef],
            }],
        })

        const flattened = flattenProvenanceRefs(snapshot)

        expect(flattened).toEqual([
            createEntityProvenanceRef('prompt-contribution', {
                id: 'contribution:base',
                revision: 1,
            }),
            moduleRef,
            recipeRef,
            runtimeRef,
            characterRef,
        ])
        expect(new Set(flattened.map(provenanceRefIdentity)).size).toBe(flattened.length)
        expect(Object.isFrozen(flattened)).toBe(false)
    })

    it('can freeze any serializable plan-like value without retaining caller references', () => {
        const source = {
            planId: 'plan:one',
            nested: { values: [false, 0, 'kept'] },
        }
        const snapshot = createImmutableSerializableSnapshot(source)

        source.nested.values[2] = 'changed'

        expect(snapshot).toEqual({
            planId: 'plan:one',
            nested: { values: [false, 0, 'kept'] },
        })
        expect(Object.isFrozen(snapshot.nested.values)).toBe(true)
    })

    it('freezes __proto__ as an own data key without prototype mutation', () => {
        const source = JSON.parse('{"extensions":{"__proto__":{"polluted":"yes"}}}') as {
            extensions: Record<string, unknown>
        }
        const snapshot = createImmutableSerializableSnapshot(source)

        expect(Object.prototype.hasOwnProperty.call(snapshot.extensions, '__proto__')).toBe(true)
        expect((snapshot.extensions as { polluted?: string }).polluted).toBeUndefined()
        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(source)
        expect(Object.isFrozen(snapshot.extensions)).toBe(true)
    })
})

type PromptContributionProvenanceMutation = Record<string, unknown>
