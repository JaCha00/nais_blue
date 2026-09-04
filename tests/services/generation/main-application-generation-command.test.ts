import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'

const runtime = vi.hoisted(() => ({
    enqueueReviewed: vi.fn(async () => ({
        status: 'enqueued' as const,
        queue: {
            batch: { id: 'batch:main' },
            jobs: [{ id: 'job:main:0', ordinal: 0 }],
        },
    })),
    compatibility: vi.fn(() => ({
        compatibilityProfileId: 'nai:test:capture',
        status: 'captured-pass' as const,
    })),
}))

vi.mock('@/services/queue/main-queue-adapter', () => ({
    enqueueReviewedMainPlan: runtime.enqueueReviewed,
}))
vi.mock('@/services/nai/compatibility', () => ({
    CURRENT_NAI_PAYLOAD_BUILDER_REVISION: 'test-revision',
    queryNaiGenerationCompatibility: runtime.compatibility,
}))

import { enqueuePreparedMainGeneration } from '@/services/generation/main-application-generation-command'

const FOLDER_BINDING = {
    resourceType: 'generation-folder-document' as const,
    resourceId: 'local',
    revision: 3,
    contentHash: `sha256:${'f'.repeat(64)}` as const,
}

function prepared(overrides: Partial<PreparedMainGeneration['output']> = {}): PreparedMainGeneration {
    return {
        params: {
            prompt: 'main prompt',
            negative_prompt: 'lowres',
            model: 'nai-diffusion-4-5-full',
            width: 832,
            height: 1_216,
            steps: 28,
            cfg_scale: 5,
            cfg_rescale: 0,
            sampler: 'k_euler_ancestral',
            scheduler: 'karras',
            smea: false,
            smea_dyn: false,
            variety: false,
            seed: 17,
            imageFormat: 'png',
            metadataMode: 'embedded',
        },
        finalPrompt: 'main prompt',
        imageFormat: 'png',
        metadataMode: 'embedded',
        streaming: false,
        sourceEdit: false,
        sequenceCommitProposal: null,
        output: {
            autoSave: true,
            directory: 'NAI_Blue_Output',
            useAbsolutePath: false,
            capabilityFallbackDirectory: 'NAI_Blue_Output',
            collisionPolicy: 'unique',
            generationFolderId: null,
            generationFolderPath: null,
            autoR2UploadProfileId: null,
            r2Bucket: null,
            r2Prefix: null,
            deleteOriginalAfterRelease: false,
            rightsXmpEnabled: false,
            rightsOwner: 'BlueHair',
            rightsEffectiveDate: null,
            ...overrides,
        },
    }
}

describe('Main application generation command', () => {
    beforeEach(() => vi.clearAllMocks())

    it('reviews the detached capture and returns only its durable handle', async () => {
        const result = await enqueuePreparedMainGeneration({
            prepared: [prepared()],
            captureId: 'main-capture:test',
            idempotencyKey: 'main:test-action',
            pricingBasis: 'paid',
            approvedAt: '2026-09-03T00:00:00.000Z',
            credentialReadinessFingerprint: `sha256:${'d'.repeat(64)}`,
            folderBinding: FOLDER_BINDING,
        })

        expect(result).toEqual({
            status: 'ready',
            batchId: 'batch:main',
            runId: 'batch:main',
            jobIds: ['job:main:0'],
        })
        expect(runtime.enqueueReviewed).toHaveBeenCalledOnce()
        const request = runtime.enqueueReviewed.mock.calls[0][0]
        expect(request.input.source).toMatchObject({
            kind: 'detached-generation-capture',
            capture: {
                captureId: 'main-capture:test',
                materializedSeeds: [17],
                credentialReadinessFingerprint: `sha256:${'d'.repeat(64)}`,
                sourceBindings: [FOLDER_BINDING],
            },
        })
        expect(request.submissionPolicy).toMatchObject({
            kind: 'reviewed',
            costConsent: { estimatedAnlas: expect.any(Number), maxAnlas: expect.any(Number) },
        })
        expect(request.idempotencyScope).toBe('main:test-action')
    })

    it.each([
        [{ collisionPolicy: 'overwrite' as const }, 'unsupported-collision-policy'],
        [{ r2Bucket: 'private-bucket' }, 'unsupported-r2-delivery'],
    ])('blocks unsupported output policy before Queue persistence', async (output, code) => {
        const result = await enqueuePreparedMainGeneration({
            prepared: [prepared(output)],
            captureId: 'main-capture:blocked',
            idempotencyKey: 'main:blocked',
            pricingBasis: 'paid',
            approvedAt: '2026-09-03T00:00:00.000Z',
            credentialReadinessFingerprint: `sha256:${'d'.repeat(64)}`,
            folderBinding: FOLDER_BINDING,
        })

        expect(result.status).toBe('unsupported')
        if (result.status === 'unsupported') expect(result.issues[0]?.code).toBe(code)
        expect(runtime.enqueueReviewed).not.toHaveBeenCalled()
    })
})
