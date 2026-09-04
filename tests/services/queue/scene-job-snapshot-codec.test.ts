import { describe, expect, it } from 'vitest'

import type { JsonValue } from '@/domain/composition/types'
import type { GenerationJobSnapshot } from '@/domain/queue/types'
import type { GenerationParams } from '@/services/novelai-types'
import { QueueExecutionError } from '@/services/queue/durable-queue-coordinator'
import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import {
    decodeSceneJobSnapshot,
    encodeSceneJobSnapshot,
    type EncodeSceneJobSnapshotInput,
} from '@/services/queue/scene-job-snapshot-codec'

function params(overrides: Partial<GenerationParams> = {}): GenerationParams {
    return {
        prompt: 'scene prompt',
        negative_prompt: 'scene negative',
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
        seed: 9876,
        imageFormat: 'webp',
        metadataMode: 'embedded',
        ...overrides,
    }
}

function input(overrides: Partial<EncodeSceneJobSnapshotInput> = {}): EncodeSceneJobSnapshotInput {
    return {
        scene: { id: 'scene-a', name: 'Opening' },
        params: params(),
        finalPrompt: 'scene prompt',
        mimeType: 'image/webp',
        saveContext: { activePresetId: 'preset-a', sceneSavePath: 'NAI_Blue_Scene' },
        outputContext: {
            useAbsoluteScenePath: false,
            metadataMode: 'embedded',
            presetName: 'Preset A',
            presetPathSegments: ['Preset A'],
            sceneName: 'Opening',
        },
        streaming: true,
        sequenceCommitProposal: null,
        planHash: {
            version: 'composition-plan-hash-v2',
            algorithm: 'sha256-utf8-v1',
            canonicalization: 'composition-canonical-json-v1',
            digest: 'scene-plan-digest',
        },
        sceneBinding: {
            resourceType: 'scene-document',
            resourceId: 'preset-a:scene-a',
            revision: 1,
            contentHash: `sha256:${'a'.repeat(64)}`,
        },
        batch: {
            request: {
                actor: { kind: 'user', id: 'scene-queue' },
                preset: { id: 'preset-a', expectedRevision: 1 },
                items: [{ sceneId: 'scene-a', count: 1 }],
                seedPolicy: { kind: 'random' },
                execution: { failurePolicy: 'continue' },
                budget: { maxImages: 1, maxAnlas: 0 },
            },
            count: 1,
            estimatedAnlas: 0,
            planHash: `sha256:${'b'.repeat(64)}`,
        },
        costConsent: createAnlasCostConsentSnapshot({
            pricingBasis: 'all-active-opus',
            estimatedAnlas: 0,
            maxAnlas: 0,
            estimatedAt: '2026-09-04T00:00:00.000Z',
            approvedAt: '2026-09-04T00:00:00.000Z',
        }),
        ...overrides,
    }
}

const dehydrated = {
    parameters: {
        generationParams: { prompt: 'scene prompt', seed: 9876 } as JsonValue,
        resourceBindings: [],
        resourceArrayLengths: {},
    },
    resources: [],
}

describe('Scene Job Snapshot codec', () => {
    it('encodes the stable V1 Scene wire shape and composition identity', () => {
        const encoded = encodeSceneJobSnapshot(input(), dehydrated)

        expect(encoded.sceneId).toBe('scene-a')
        expect(encoded.compositionPlanHash).toBe('sha256:scene-plan-digest')
        expect(encoded.snapshot).toMatchObject({
            schemaVersion: 1,
            prompt: { positive: 'scene prompt', negative: 'scene negative' },
            parameters: {
                queueExecution: { streaming: true, sourceEdit: false },
                sceneWorkflow: {
                    scene: { id: 'scene-a', name: 'Opening' },
                    finalPrompt: 'scene prompt',
                    mimeType: 'image/webp',
                    saveContext: { activePresetId: 'preset-a', sceneSavePath: 'NAI_Blue_Scene' },
                    outputContext: { presetName: 'Preset A', sceneName: 'Opening' },
                },
            },
            outputPolicy: {
                workflow: 'scene',
                outputContext: { presetName: 'Preset A', sceneName: 'Opening' },
            },
            resumability: 'resumable',
        })
        expect(Object.isFrozen(encoded.snapshot)).toBe(true)
        expect(encoded.snapshot.providerExecutionEnvelope).toMatchObject({
            schemaVersion: 1,
            provider: 'novelai',
            payloadBuilderRevision: expect.any(String),
            modelCatalogRevision: expect.any(String),
            compatibilityProfileId: expect.any(String),
            semanticIntentHash: expect.stringMatching(/^sha256:/),
            responseMode: 'streaming',
        })
    })

    it('round-trips source-edit execution flags and rejects malformed payloads as fatal', () => {
        const snapshot = encodeSceneJobSnapshot(input({
            params: params({ sourceImage: 'data:image/png;base64,U09VUkNF' }),
            planHash: null,
        }), dehydrated).snapshot

        expect(decodeSceneJobSnapshot(snapshot)).toMatchObject({
            queueExecution: { streaming: true, sourceEdit: true },
            sceneWorkflow: { scene: { id: 'scene-a' }, mimeType: 'image/webp' },
        })

        const malformed = {
            ...snapshot,
            parameters: { queueExecution: { streaming: 'yes' } } as unknown as JsonValue,
        } satisfies GenerationJobSnapshot
        expect(() => decodeSceneJobSnapshot(malformed)).toThrowError(QueueExecutionError)
        try {
            decodeSceneJobSnapshot(malformed)
        } catch (error) {
            expect(error).toMatchObject({ kind: 'fatal' })
        }
    })

    it('round-trips the enqueue-time folder and R2 destination', () => {
        const snapshot = encodeSceneJobSnapshot(input({
            outputContext: {
                useAbsoluteScenePath: true,
                metadataMode: 'strip-and-sidecar',
                presetName: 'Preset A',
                presetPathSegments: ['Preset A'],
                sceneName: 'Opening',
                generationFolderId: 'folder-01',
                generationFolderPath: 'Prime / 01',
                directory: 'D:\\Images\\Prime\\01',
                capabilityFallbackDirectory: 'NAI_Blue_Scene',
                autoR2UploadProfileId: 'asset-profile-default-r2',
                r2Bucket: 'scene-bucket',
                r2Prefix: 'prime/bluehair/01',
                sceneSubfoldersEnabled: false,
                filenameTemplate: 'opening_{seed}_{timestamp}',
            },
        }), dehydrated).snapshot

        expect(decodeSceneJobSnapshot(snapshot).sceneWorkflow.outputContext).toMatchObject({
            generationFolderId: 'folder-01',
            directory: 'D:\\Images\\Prime\\01',
            r2Bucket: 'scene-bucket',
            r2Prefix: 'prime/bluehair/01',
            sceneSubfoldersEnabled: false,
            filenameTemplate: 'opening_{seed}_{timestamp}',
        })
    })

    it('rejects a Scene batch whose public request shape is malformed', () => {
        const snapshot = encodeSceneJobSnapshot(input(), dehydrated).snapshot
        const parameters = snapshot.parameters as unknown as Record<string, unknown>
        const sceneWorkflow = parameters.sceneWorkflow as Record<string, unknown>
        const batch = sceneWorkflow.batch as Record<string, unknown>
        const malformed = {
            ...snapshot,
            parameters: {
                ...parameters,
                sceneWorkflow: {
                    ...sceneWorkflow,
                    batch: {
                        ...batch,
                        request: {
                            ...(batch.request as Record<string, unknown>),
                            budget: { maxImages: 'one', maxAnlas: 0 },
                        },
                    },
                },
            },
        } as unknown as GenerationJobSnapshot

        expect(() => decodeSceneJobSnapshot(malformed)).toThrowError(QueueExecutionError)
    })
})
