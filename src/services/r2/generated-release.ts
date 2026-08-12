import { DEFAULT_R2_PROFILE_ID, type NativeR2ScannedArtifact } from '@/domain/r2/types'
import { sha256Bytes } from '@/lib/binary-digest'
import { runtimeCapabilities } from '@/platform/capabilities'
import type { OutputWriteResult } from '@/services/output/output-writer'
import { createRuntimeOutputPlatformAdapter } from '@/services/output/tauri-output-adapter'
import { nativeR2CredentialStatus } from './native-r2-adapter'
import { getRuntimeR2UploadCoordinator, getRuntimeR2UploadRepository } from './runtime'

export type GeneratedR2ReleaseResult =
    | { readonly status: 'uploaded'; readonly artifactCount: number; readonly sidecarUploaded: boolean }
    | { readonly status: 'unavailable'; readonly reason: 'runtime' | 'profile' | 'credential' | 'output' }
    | { readonly status: 'pending-or-failed'; readonly failed: number; readonly pending: number }

function remoteKey(prefix: string, fileName: string): string {
    const safeName = fileName.replace(/\\/g, '/').split('/').pop()?.trim() ?? ''
    if (!safeName || safeName === '.' || safeName === '..') throw new Error('Generated R2 release filename is invalid')
    const cleanPrefix = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    return [cleanPrefix, safeName].filter(Boolean).join('/')
}

/**
 * Uploads only the exact verified output set. Public profiles never receive the
 * prompt-bearing sidecar; private profiles require and upload the pair.
 */
export async function releaseGeneratedOutputToR2(input: {
    readonly profileId: string
    readonly sourceJobId: string
    readonly imageFormat: 'png' | 'webp'
    readonly output: OutputWriteResult
}): Promise<GeneratedR2ReleaseResult> {
    if (!runtimeCapabilities.r2ForegroundUpload.supported) {
        return { status: 'unavailable', reason: 'runtime' }
    }
    if (input.profileId !== DEFAULT_R2_PROFILE_ID) {
        return { status: 'unavailable', reason: 'profile' }
    }

    const repository = getRuntimeR2UploadRepository()
    const profile = await repository.getProfile(input.profileId)
    if (!profile
        || profile.transport !== 'native-s3'
        || !profile.accountId.trim()
        || !profile.bucket.trim()) {
        return { status: 'unavailable', reason: 'profile' }
    }
    const credential = await nativeR2CredentialStatus(profile.credentialRef).catch(() => null)
    if (!credential?.available) return { status: 'unavailable', reason: 'credential' }

    const finalImage = input.output.finalImage
    if (!finalImage) return { status: 'unavailable', reason: 'output' }
    const artifacts: NativeR2ScannedArtifact[] = [{
        artifactId: `${input.sourceJobId}:release-image`,
        localVariant: input.output.file.displayPath,
        remoteKey: remoteKey(profile.prefix, input.output.fileName),
        contentSha256: finalImage.contentChecksum,
        contentType: `image/${input.imageFormat}`,
        size: finalImage.byteSize,
    }]

    if (profile.publicMode === 'private') {
        if (!input.output.sidecarFile) return { status: 'unavailable', reason: 'output' }
        const sidecarBytes = await createRuntimeOutputPlatformAdapter().readFile(input.output.sidecarFile)
        artifacts.push({
            artifactId: `${input.sourceJobId}:release-sidecar`,
            localVariant: input.output.sidecarFile.displayPath,
            remoteKey: remoteKey(profile.prefix, input.output.sidecarFile.displayPath),
            contentSha256: await sha256Bytes(sidecarBytes),
            contentType: 'application/json',
            size: sidecarBytes.byteLength,
        })
    }

    const coordinator = getRuntimeR2UploadCoordinator()
    const plan = await coordinator.plan(profile, artifacts, 'current-session')
    await coordinator.enqueuePlan(plan)
    await coordinator.runUntilIdle(profile)
    const settled = await Promise.all(plan.jobs.map(job => repository.getJob(job.id)))
    const failed = settled.filter(job => job?.state === 'failed' || job?.state === 'cancelled').length
    const pending = settled.filter(job => job?.state === 'queued' || job?.state === 'running' || job === null).length
    if (failed > 0 || pending > 0) return { status: 'pending-or-failed', failed, pending }
    return {
        status: 'uploaded',
        artifactCount: artifacts.length,
        sidecarUploaded: profile.publicMode === 'private',
    }
}

/** Removes only the transaction-owned private original, never the published image. */
export async function discardGeneratedProviderOriginal(output: OutputWriteResult): Promise<boolean> {
    if (!output.providerOriginalFile) return false
    await createRuntimeOutputPlatformAdapter().remove(output.providerOriginalFile)
    return true
}
