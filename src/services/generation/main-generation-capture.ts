import type {
    DetachedGenerationCapture,
    GenerationExecutionPolicySnapshot,
    Sha256Digest,
    VersionedBinding,
} from '@/application/generation/generation-plan-contract'
import { hashDetachedGenerationCapture } from '@/application/generation/plan-generation'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'
import { projectPreparedMainGenerationJob } from './main-prepared-job-projection'

function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

/** Detaches Store materialization before it crosses into Application review. */
export function capturePreparedMainBatch(
    prepared: readonly PreparedMainGeneration[],
): readonly PreparedMainGeneration[] {
    return deepFreeze(structuredClone(prepared))
}

export interface CreateDetachedMainGenerationCaptureInput {
    readonly captureId: string
    readonly prepared: readonly PreparedMainGeneration[]
    readonly materializedSeeds: readonly number[]
    readonly sourceBindings?: readonly VersionedBinding[]
    readonly executionPolicy: GenerationExecutionPolicySnapshot
    readonly credentialReadinessFingerprint: Sha256Digest
}

/** Builds the single self-verifying source that Application will review and replay. */
export function createDetachedMainGenerationCapture(
    input: CreateDetachedMainGenerationCaptureInput,
): DetachedGenerationCapture<PreparedMainGeneration> {
    const prepared = capturePreparedMainBatch(input.prepared)
    if (prepared.length !== input.materializedSeeds.length
        || prepared.some((job, ordinal) => job.params.seed !== input.materializedSeeds[ordinal])) {
        throw new TypeError('Detached Main capture seeds must match every prepared job in order.')
    }
    const content: Omit<DetachedGenerationCapture<PreparedMainGeneration>, 'contentHash'> = {
        schemaVersion: 1,
        captureId: input.captureId,
        sourceBindings: structuredClone(input.sourceBindings ?? []),
        materializedSeeds: [...input.materializedSeeds],
        jobs: prepared.map(projectPreparedMainGenerationJob),
        executionPolicy: structuredClone(input.executionPolicy),
        credentialReadinessFingerprint: input.credentialReadinessFingerprint,
    }
    return deepFreeze({
        ...content,
        contentHash: hashDetachedGenerationCapture(content),
    })
}
