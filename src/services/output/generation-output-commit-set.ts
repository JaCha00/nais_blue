import { createOutputCommitSet } from '@/domain/output-commit-set'
import type { OutputCommitSet, OutputPathClaimKind } from '@/domain/queue/types'
import { shouldWriteNaiBlueSidecar } from '@/lib/generation-metadata'
import { runtimeCapabilities, type RuntimePlatform } from '@/platform/capabilities'
import type { GenerationParams } from '@/services/novelai-types'
import {
    OUTPUT_FILENAME_POLICY_REVISION,
    OUTPUT_PATH_NORMALIZATION_REVISION,
    PRIVATE_ORIGINAL_DIRECTORY,
    toArtifactSidecarPath,
    toDiagnosticSidecarPath,
    toSidecarFileName,
} from './filename-policy'

export interface GenerationOutputClaimPlan {
    readonly fileName: string
    readonly imageFormat: 'png' | 'webp'
    readonly metadataMode: GenerationParams['metadataMode']
    readonly preserveProviderOriginal: boolean
    readonly artifactSidecar?: boolean
    readonly diagnosticSidecar?: boolean
}

export function outputFilesystemSemantics(
    platform: RuntimePlatform = runtimeCapabilities.platform,
): OutputCommitSet['filesystemSemantics'] {
    if (platform === 'android') return 'android'
    if (platform === 'macos' || platform === 'ios') return 'macos'
    if (platform === 'linux') return 'linux'
    // Windows is the conservative fallback for the current desktop/web test
    // runtime: it rejects the broadest set of aliases before persistence.
    return 'windows'
}

export function generationOutputClaimKinds(
    plan: GenerationOutputClaimPlan,
): readonly OutputPathClaimKind[] {
    return Object.freeze([
        'image' as const,
        ...(shouldWriteNaiBlueSidecar(plan.metadataMode, plan.imageFormat, true)
            ? ['metadata-sidecar' as const]
            : []),
        ...(plan.artifactSidecar === true ? ['artifact-sidecar' as const] : []),
        ...(plan.diagnosticSidecar === true ? ['diagnostic-sidecar' as const] : []),
        ...(plan.preserveProviderOriginal ? ['provider-original' as const] : []),
    ])
}

export function generationOutputRelativePath(
    kind: OutputPathClaimKind,
    fileName: string,
): string {
    switch (kind) {
        case 'image': return fileName
        case 'metadata-sidecar': return toSidecarFileName(fileName)
        case 'artifact-sidecar': return toArtifactSidecarPath(fileName)
        case 'diagnostic-sidecar': return toDiagnosticSidecarPath(fileName)
        case 'provider-original': return `${PRIVATE_ORIGINAL_DIRECTORY}/${fileName}`
    }
}

/** Plans exactly the permanent files OutputWriter will publish for one generation. */
export function createGenerationOutputCommitSet(input: GenerationOutputClaimPlan & {
    readonly directoryAuthorityId: string
    readonly directoryAuthorityFingerprint: `sha256:${string}`
    readonly filesystemSemantics?: OutputCommitSet['filesystemSemantics']
}) {
    const kinds = generationOutputClaimKinds(input)
    return createOutputCommitSet({
        directoryAuthorityId: input.directoryAuthorityId,
        directoryAuthorityFingerprint: input.directoryAuthorityFingerprint,
        filesystemSemantics: input.filesystemSemantics ?? outputFilesystemSemantics(),
        filenamePolicyRevision: OUTPUT_FILENAME_POLICY_REVISION,
        pathNormalizationRevision: OUTPUT_PATH_NORMALIZATION_REVISION,
        claims: kinds.map(kind => ({
            claimId: kind,
            kind,
            relativePath: generationOutputRelativePath(kind, input.fileName),
        })),
    })
}
