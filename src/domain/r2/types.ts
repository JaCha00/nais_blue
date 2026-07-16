export const R2_TRANSPORTS = ['native-s3', 'wrangler', 'relay'] as const
export type R2Transport = typeof R2_TRANSPORTS[number]

export const R2_CONFLICT_POLICIES = ['fail', 'skip-same', 'overwrite', 'suffix'] as const
export type R2ConflictPolicy = typeof R2_CONFLICT_POLICIES[number]

export type R2PublicMode = 'private' | 'r2-dev' | 'custom'

export interface R2ProfileV2 {
    readonly schemaVersion: 2
    readonly id: string
    readonly name: string
    readonly accountId: string
    readonly jurisdiction: string | null
    readonly endpoint: string | null
    readonly bucket: string
    readonly prefix: string
    readonly credentialRef: string
    readonly transport: R2Transport
    readonly conflictPolicy: R2ConflictPolicy
    readonly publicMode: R2PublicMode
    readonly publicBaseUrl: string | null
    readonly createdAt: string
    readonly updatedAt: string
}

export type UploadJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface UploadCompletedPart {
    readonly partNumber: number
    readonly etag: string
    readonly size: number
}

export interface UploadMultipartState {
    readonly uploadId: string | null
    readonly completedParts: readonly UploadCompletedPart[]
    readonly partSize: number
}

export interface UploadJob {
    readonly id: string
    readonly profileId: string
    readonly artifactId: string
    readonly localVariant: string
    readonly remoteKey: string
    readonly contentSha256: string
    readonly contentType: string
    readonly size: number
    readonly state: UploadJobState
    readonly attempt: number
    readonly maxAttempts: number
    readonly nextAttemptAt: string
    readonly multipart: UploadMultipartState
    readonly diagnosticEventId: string | null
    readonly createdAt: string
    readonly updatedAt: string
    readonly version: number
}

export interface NativeR2ScannedArtifact {
    readonly artifactId: string
    readonly localVariant: string
    readonly remoteKey: string
    readonly contentSha256: string
    readonly contentType: string
    readonly size: number
}

export interface R2ManifestV2Item {
    readonly profileId: string
    readonly artifactId: string
    readonly localVariant: string
    readonly remoteKey: string
    readonly contentSha256: string
    readonly size: number
    readonly completedAt: string
}

export interface R2ManifestV2 {
    readonly schemaVersion: 2
    readonly profileId: string
    readonly bucket: string
    readonly prefix: string
    readonly updatedAt: string
    readonly items: readonly R2ManifestV2Item[]
}

export function createR2ProfileV2(
    input: Omit<R2ProfileV2, 'schemaVersion' | 'createdAt' | 'updatedAt'>,
    now = new Date().toISOString(),
): R2ProfileV2 {
    return {
        schemaVersion: 2,
        ...input,
        createdAt: now,
        updatedAt: now,
    }
}

export function deterministicR2Suffix(remoteKey: string, contentSha256: string): string {
    const suffix = contentSha256.replace(/^sha256:/, '').slice(0, 12)
    const slash = remoteKey.lastIndexOf('/')
    const dot = remoteKey.lastIndexOf('.')
    if (dot > slash + 1) return `${remoteKey.slice(0, dot)}-${suffix}${remoteKey.slice(dot)}`
    return `${remoteKey}-${suffix}`
}
