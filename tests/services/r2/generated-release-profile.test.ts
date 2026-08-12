import { describe, expect, it } from 'vitest'

import { createR2ProfileV2 } from '@/domain/r2/types'
import { deriveGeneratedReleaseProfile } from '@/services/r2/generated-release'

const base = createR2ProfileV2({
    id: 'default',
    name: 'Default R2',
    accountId: 'account',
    jurisdiction: null,
    endpoint: null,
    bucket: 'default-bucket',
    prefix: 'default',
    credentialRef: 'credential',
    transport: 'native-s3',
    conflictPolicy: 'skip-same',
    publicMode: 'private',
    publicBaseUrl: null,
}, '2026-08-12T00:00:00.000Z')

describe('generated R2 release profile', () => {
    it('creates a stable immutable identity for each captured bucket and prefix', () => {
        const first = deriveGeneratedReleaseProfile(base, {
            bucket: 'scene-bucket',
            prefix: 'prime/bluehair/01',
        }, '2026-08-12T01:00:00.000Z')
        const sameTargetLater = deriveGeneratedReleaseProfile(base, {
            bucket: 'scene-bucket',
            prefix: 'prime/bluehair/01',
        }, '2026-08-13T01:00:00.000Z')
        const otherPrefix = deriveGeneratedReleaseProfile(base, {
            bucket: 'scene-bucket',
            prefix: 'prime/bluehair/02',
        })

        expect(first).toMatchObject({ bucket: 'scene-bucket', prefix: 'prime/bluehair/01' })
        expect(first.id).toBe(sameTargetLater.id)
        expect(otherPrefix.id).not.toBe(first.id)
    })

    it('rejects unsafe destinations before any upload job can be planned', () => {
        expect(() => deriveGeneratedReleaseProfile(base, { bucket: 'Invalid_Bucket' })).toThrow()
        expect(() => deriveGeneratedReleaseProfile(base, { prefix: '../escape' })).toThrow()
    })
})
