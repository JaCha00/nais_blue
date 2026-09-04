import { describe, expect, it } from 'vitest'

import { DEFAULT_R2_PROFILE_ID, type R2ProfileV2 } from '@/domain/r2/types'
import { matchR2Readiness, r2ReadinessProfileId } from '@/hooks/useDefaultR2Readiness'

const profile = (id: string, bucket: string, prefix: string): R2ProfileV2 => ({
    schemaVersion: 2,
    id,
    name: id,
    accountId: 'account',
    jurisdiction: null,
    endpoint: null,
    bucket,
    prefix,
    credentialRef: `credential:${id}`,
    transport: 'native-s3',
    conflictPolicy: 'fail',
    publicMode: 'private',
    publicBaseUrl: null,
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
})

describe('R2 readiness profile selection', () => {
    it('keeps the default fallback and selects a custom profile', () => {
        expect(r2ReadinessProfileId(null, true)).toBe(DEFAULT_R2_PROFILE_ID)
        expect(r2ReadinessProfileId('profile-special', true)).toBe('profile-special')
    })

    it('skips reads for a cleared or disabled selection', () => {
        expect(r2ReadinessProfileId(null, false)).toBeNull()
        expect(r2ReadinessProfileId('profile-special', false)).toBeNull()
    })

    it('rejects stale profile A readiness after the manager selects profile B', () => {
        const profileA = profile('profile-a', 'bucket-a', 'prefix-a')
        const profileB = profile('profile-b', 'bucket-b', 'prefix-b')

        expect(matchR2Readiness('profile-b', { status: 'ready', profile: profileA })).toEqual({
            profile: null,
            ready: false,
        })
        expect(matchR2Readiness('profile-b', { status: 'ready', profile: profileB })).toEqual({
            profile: profileB,
            ready: true,
        })
    })
})
