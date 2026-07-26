export const REMOTE_IMAGE_PROCESSING_POLICY_VERSION = 1

/**
 * Depends on the persisted user acknowledgement and guards every third-party
 * image-processing call before bytes are read or uploaded. Versioning allows a
 * materially changed provider policy to require consent again in a later release.
 */
export function assertRemoteImageProcessingConsent(consentVersion: number): void {
    if (consentVersion >= REMOTE_IMAGE_PROCESSING_POLICY_VERSION) return
    const error = new Error('Remote image processing consent is required.')
    error.name = 'RemoteImageProcessingConsentError'
    throw error
}
