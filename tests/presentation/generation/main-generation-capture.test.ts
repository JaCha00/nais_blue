import { describe, expect, it } from 'vitest'

import {
    capturePreparedMainBatch,
    createDetachedMainGenerationCapture,
} from '@/services/generation/main-generation-capture'
import { hashDetachedGenerationCapture } from '@/application/generation/plan-generation'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'

function prepared(seed: number): PreparedMainGeneration {
    return {
        params: { prompt: 'original', seed } as PreparedMainGeneration['params'],
        finalPrompt: 'original',
        imageFormat: 'png',
        metadataMode: 'embedded',
        streaming: false,
        sourceEdit: false,
        sequenceCommitProposal: null,
        output: {
            autoSave: false,
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
        },
    }
}

describe('Main prepared batch capture', () => {
    it('deeply detaches and freezes the prepared jobs in order', () => {
        const source = [prepared(11), prepared(12)]
        const captured = capturePreparedMainBatch(source)

        ;(source[0].params as { prompt: string }).prompt = 'changed later'

        expect(captured.map(job => job.params.seed)).toEqual([11, 12])
        expect(captured[0].params.prompt).toBe('original')
        expect(Object.isFrozen(captured)).toBe(true)
        expect(Object.isFrozen(captured[0])).toBe(true)
        expect(Object.isFrozen(captured[0].params)).toBe(true)
        expect(Object.isFrozen(captured[0].output)).toBe(true)
    })

    it('binds projected jobs, seeds, policy, and credential readiness into its hash', () => {
        const captured = createDetachedMainGenerationCapture({
            captureId: 'main-capture-1',
            prepared: [prepared(11), prepared(12)],
            materializedSeeds: [11, 12],
            executionPolicy: {
                failurePolicy: 'continue',
                retryPolicyId: 'main-safe-v1',
                maxAttempts: 3,
                maxConcurrency: 1,
                credentialDispatch: { kind: 'auto' },
                pricingBasis: 'paid',
                metadataMode: 'embedded',
            },
            credentialReadinessFingerprint: `sha256:${'a'.repeat(64)}`,
        })

        expect(captured.contentHash).toBe(hashDetachedGenerationCapture(captured))
        expect(captured.jobs.map(job => job.semantic.seed)).toEqual([11, 12])
        expect(Object.isFrozen(captured.jobs[0].prepared.params)).toBe(true)
    })
})
