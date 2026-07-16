import type { JsonObject } from '@/domain/composition/types'
import { SyncTransportError } from '@/domain/sync/transport'
import { sanitizeSyncPayload } from './sanitizer'

export interface SyncedR2ObjectReference {
    readonly profileId: string
    readonly artifactId: string
    readonly variantId: string
    readonly remoteKey: string
    readonly state: 'succeeded'
    readonly updatedAt: string
}

export interface R2ObjectAvailabilityProbe {
    exists(reference: SyncedR2ObjectReference): Promise<boolean>
}

function asReference(value: JsonObject): SyncedR2ObjectReference {
    return {
        profileId: String(value.profileId),
        artifactId: String(value.artifactId),
        variantId: String(value.variantId),
        remoteKey: String(value.remoteKey),
        state: 'succeeded',
        updatedAt: String(value.updatedAt),
    }
}

/**
 * Links a sanitized R2 reference to the existing native HEAD boundary. Missing
 * objects fail explicitly; this function never substitutes JSON image bytes,
 * local paths, thumbnails, or signed URLs.
 */
export async function requireSyncedR2Object(
    value: unknown,
    probe: R2ObjectAvailabilityProbe,
): Promise<SyncedR2ObjectReference> {
    const reference = asReference(sanitizeSyncPayload('artifact.r2-object', value))
    if (!await probe.exists(reference)) {
        throw new SyncTransportError(
            'E_SYNC_R2_OBJECT_MISSING',
            'The synchronized R2 object is not available.',
            true,
        )
    }
    return reference
}
