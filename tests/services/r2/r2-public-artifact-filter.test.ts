import { describe, expect, it } from 'vitest'

import { createR2ProfileV2, type NativeR2ScannedArtifact } from '@/domain/r2/types'
import { filterNativeR2ArtifactsForProfile } from '@/services/r2/native-r2-adapter'

const artifacts: NativeR2ScannedArtifact[] = [
    { artifactId: 'image', localVariant: 'result.png', remoteKey: 'result.png', contentSha256: 'sha256:image', contentType: 'image/png', size: 1 },
    { artifactId: 'sidecar', localVariant: 'result.nais-blue.json', remoteKey: 'result.nais-blue.json', contentSha256: 'sha256:json', contentType: 'application/json', size: 1 },
]

function profile(publicMode: 'private' | 'custom') {
    return createR2ProfileV2({
        id: 'profile', name: 'Profile', accountId: 'account', jurisdiction: null, endpoint: null,
        bucket: 'bucket', prefix: '', credentialRef: 'credential', transport: 'native-s3',
        conflictPolicy: 'fail', publicMode, publicBaseUrl: publicMode === 'private' ? null : 'https://example.test',
    })
}

describe('R2 public artifact filter', () => {
    it('keeps private sidecars only for private profiles', () => {
        expect(filterNativeR2ArtifactsForProfile(profile('private'), artifacts)).toEqual(artifacts)
        expect(filterNativeR2ArtifactsForProfile(profile('custom'), artifacts)).toEqual([artifacts[0]])
    })
})
