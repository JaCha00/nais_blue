import { describe, expect, it } from 'vitest'

import type { JsonValue } from '@/domain/composition/types'
import type { GenerationJobSnapshot } from '@/domain/queue/types'
import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import {
    createStyleEvaluationContext,
    styleCombinationIdentity,
} from '@/domain/style-lab'
import type { GenerationParams } from '@/services/novelai-types'
import { QueueExecutionError } from '@/services/queue/durable-queue-coordinator'
import {
    decodeStyleLabJobSnapshot,
    encodeStyleLabJobSnapshot,
    type EncodeStyleLabJobSnapshotInput,
} from '@/services/style-lab/style-lab-job-snapshot-codec'

const tags = [{ tag: 'watercolor', kind: 'style', weight: 1 }] as const
const identity = styleCombinationIdentity(tags)
const context = createStyleEvaluationContext({
    prompt: { base: 'portrait' },
    plan: { model: 'nai-diffusion-4-5-full' },
    model: 'nai-diffusion-4-5-full',
    sampler: 'k_euler_ancestral',
    seedPack: [2468],
    createdAt: 1_000,
})

function params(overrides: Partial<GenerationParams> = {}): GenerationParams {
    return {
        prompt: 'watercolor portrait',
        negative_prompt: 'low quality',
        model: context.model,
        width: 832,
        height: 1216,
        steps: 28,
        cfg_scale: 5,
        cfg_rescale: 0,
        sampler: context.sampler,
        scheduler: 'karras',
        smea: false,
        smea_dyn: false,
        variety: false,
        seed: 2468,
        ...overrides,
    }
}

function input(overrides: Partial<EncodeStyleLabJobSnapshotInput> = {}): EncodeStyleLabJobSnapshotInput {
    return {
        combination: {
            id: 'combo-a',
            tags,
            ...identity,
            generation: 2,
        },
        context,
        params: params(),
        prompt: 'watercolor portrait',
        seed: 2468,
        requestedAt: 2_000,
        reservationId: 'reservation-a',
        output: {
            directory: 'nai-blue-style',
            useAbsolutePath: false,
            capabilityFallbackDirectory: 'nai-blue-style',
            fileName: 'NAI_Blue_STYLELAB_fixture.webp',
            collisionPolicy: 'unique',
            imageFormat: 'webp',
            metadataMode: 'embedded',
        },
        planHash: {
            version: 'composition-plan-hash-v2',
            algorithm: 'sha256-utf8-v1',
            canonicalization: 'composition-canonical-json-v1',
            digest: 'style-plan-digest',
        },
        ...overrides,
    }
}

const dehydrated = {
    parameters: {
        generationParams: { prompt: 'watercolor portrait', seed: 2468 } as JsonValue,
        resourceBindings: [],
        resourceArrayLengths: {},
    },
    resources: [],
}

describe('Style Lab Job Snapshot codec', () => {
    it('encodes and decodes the stable V1 render identity and output policy', () => {
        const encoded = encodeStyleLabJobSnapshot(input(), dehydrated)

        expect(encoded.compositionPlanHash).toBe('sha256:style-plan-digest')
        expect(encoded.snapshot).toMatchObject({
            schemaVersion: 1,
            prompt: { positive: 'watercolor portrait', negative: 'low quality' },
            parameters: {
                queueExecution: { streaming: false, sourceEdit: false },
                styleLabWorkflow: {
                    comboId: 'combo-a',
                    renderHash: identity.renderHash,
                    context: { id: context.id, seedPack: [2468] },
                    seed: 2468,
                    reservationId: 'reservation-a',
                    output: { imageFormat: 'webp', fileName: 'NAI_Blue_STYLELAB_fixture.webp' },
                },
            },
            outputPolicy: { workflow: 'style-lab', imageFormat: 'webp' },
            resumability: 'resumable',
        })
        expect(decodeStyleLabJobSnapshot(encoded.snapshot).styleLabWorkflow.renderHash)
            .toBe(identity.renderHash)
        expect(Object.isFrozen(encoded.snapshot)).toBe(true)
    })

    it('preserves a valid Guided cost approval in the immutable workflow snapshot', () => {
        const instant = '2026-08-10T00:00:00.000Z'
        const costConsent = createAnlasCostConsentSnapshot({
            pricingBasis: 'all-active-opus', estimatedAnlas: 0, maxAnlas: 0,
            estimatedAt: instant, approvedAt: instant,
        })
        const encoded = encodeStyleLabJobSnapshot(input({ costConsent }), dehydrated)

        expect(decodeStyleLabJobSnapshot(encoded.snapshot).styleLabWorkflow.costConsent)
            .toEqual(costConsent)
    })

    it('rejects a render identity that no longer matches the snapshotted tags', () => {
        const snapshot = encodeStyleLabJobSnapshot(input(), dehydrated).snapshot
        const parameters = structuredClone(snapshot.parameters) as Record<string, unknown>
        const workflow = parameters.styleLabWorkflow as Record<string, unknown>
        workflow.renderHash = 'style-render:tampered'
        const malformed = { ...snapshot, parameters: parameters as JsonValue } satisfies GenerationJobSnapshot

        expect(() => decodeStyleLabJobSnapshot(malformed)).toThrowError(QueueExecutionError)
        try {
            decodeStyleLabJobSnapshot(malformed)
        } catch (error) {
            expect(error).toMatchObject({
                kind: 'fatal',
                message: 'Style-Lab queue snapshot identity is inconsistent',
            })
        }
    })
})
