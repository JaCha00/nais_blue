import { describe, expect, it } from 'vitest'
import {
    assertRemoteImageProcessingConsent,
    REMOTE_IMAGE_PROCESSING_POLICY_VERSION,
} from '@/services/privacy/remote-image-processing'

describe('remote image processing consent', () => {
    it('rejects uploads until the current policy is explicitly accepted', () => {
        expect(() => assertRemoteImageProcessingConsent(0)).toThrowError(
            expect.objectContaining({ name: 'RemoteImageProcessingConsentError' }),
        )
    })

    it('allows the current and newer recorded policy versions', () => {
        expect(() => assertRemoteImageProcessingConsent(REMOTE_IMAGE_PROCESSING_POLICY_VERSION)).not.toThrow()
        expect(() => assertRemoteImageProcessingConsent(REMOTE_IMAGE_PROCESSING_POLICY_VERSION + 1)).not.toThrow()
    })
})
