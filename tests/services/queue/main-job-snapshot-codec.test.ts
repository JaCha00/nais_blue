import { describe, expect, it } from 'vitest'

import type { JsonValue } from '@/domain/composition/types'
import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import type { GenerationJobSnapshot } from '@/domain/queue/types'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'
import type { GenerationParams } from '@/services/novelai-types'
import { QueueExecutionError } from '@/services/queue/durable-queue-coordinator'
import {
    decodeMainJobSnapshot,
    encodeMainJobSnapshot,
} from '@/services/queue/main-job-snapshot-codec'

function params(overrides: Partial<GenerationParams> = {}): GenerationParams {
    return {
        prompt: 'encoded prompt',
        negative_prompt: 'encoded negative',
        model: 'nai-diffusion-4-5-full',
        width: 832,
        height: 1216,
        steps: 28,
        cfg_scale: 5,
        cfg_rescale: 0,
        sampler: 'k_euler_ancestral',
        scheduler: 'karras',
        smea: false,
        smea_dyn: false,
        variety: false,
        seed: 4321,
        ...overrides,
    }
}

function prepared(overrides: Partial<PreparedMainGeneration> = {}): PreparedMainGeneration {
    return {
        params: params(),
        finalPrompt: 'encoded prompt',
        imageFormat: 'png',
        metadataMode: 'embedded',
        streaming: true,
        sourceEdit: false,
        sequenceCommitProposal: null,
        output: {
            autoSave: true,
            directory: 'NAIS_Output',
            useAbsolutePath: false,
            capabilityFallbackDirectory: 'NAIS_Output',
            collisionPolicy: 'unique',
        },
        ...overrides,
    }
}

const dehydrated = {
    parameters: {
        generationParams: { prompt: 'encoded prompt', seed: 4321 } as JsonValue,
        resourceBindings: [],
        resourceArrayLengths: {},
    },
    resources: [],
}

describe('Main Job Snapshot codec', () => {
    it('encodes the stable V1 wire shape and Queue seed filename policy', () => {
        const encoded = encodeMainJobSnapshot(prepared(), dehydrated)

        expect(encoded.compositionPlanHash).toBeNull()
        expect(encoded.snapshot).toMatchObject({
            schemaVersion: 1,
            prompt: { positive: 'encoded prompt', negative: 'encoded negative' },
            parameters: {
                queueExecution: { streaming: true, sourceEdit: false },
                mainWorkflow: {
                    finalPrompt: 'encoded prompt',
                    imageFormat: 'png',
                    metadataMode: 'embedded',
                    output: {
                        directory: 'NAIS_Output',
                        fileName: 'NAIS_4321.png',
                        collisionPolicy: 'unique',
                    },
                },
            },
            outputPolicy: {
                workflow: 'main',
                imageFormat: 'png',
                metadataMode: 'embedded',
            },
            resumability: 'resumable',
        })
        expect(Object.isFrozen(encoded.snapshot)).toBe(true)
    })

    it('round-trips valid payloads and classifies malformed payloads as fatal', () => {
        const costConsent = createAnlasCostConsentSnapshot({
            pricingBasis: 'all-active-opus',
            estimatedAnlas: 0,
            maxAnlas: 0,
            estimatedAt: '2026-08-08T12:00:00.000Z',
            approvedAt: '2026-08-08T12:00:01.000Z',
        })
        const snapshot = encodeMainJobSnapshot(prepared({
            output: {
                autoSave: false,
                directory: 'Custom',
                useAbsolutePath: true,
                capabilityFallbackDirectory: 'Fallback',
                fileName: 'chosen.webp',
                collisionPolicy: 'overwrite',
            },
            imageFormat: 'webp',
        }), dehydrated, costConsent).snapshot

        expect(decodeMainJobSnapshot(snapshot)).toMatchObject({
            queueExecution: { streaming: true, sourceEdit: false },
            mainWorkflow: {
                imageFormat: 'webp',
                costConsent,
                output: { fileName: 'chosen.webp', collisionPolicy: 'overwrite' },
            },
        })

        const malformed = {
            ...snapshot,
            parameters: { queueExecution: { streaming: 'yes' } } as unknown as JsonValue,
        } satisfies GenerationJobSnapshot
        expect(() => decodeMainJobSnapshot(malformed)).toThrowError(QueueExecutionError)
        try {
            decodeMainJobSnapshot(malformed)
        } catch (error) {
            expect(error).toMatchObject({ kind: 'fatal' })
        }
    })
})
