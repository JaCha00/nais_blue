import { beforeEach, describe, expect, it } from 'vitest'

import { useAuthStore, waitForApiTokenReady } from '@/stores/auth-store'

describe('local API token source-edit readiness', () => {
    beforeEach(() => {
        useAuthStore.setState({
            isCredentialStateInitialized: true,
            token: '',
            token2: '',
            isVerified: false,
            isVerified2: false,
            slot1Enabled: true,
            slot2Enabled: true,
            tokenDialogOpen: false,
        })
    })

    it('is immediately ready when a persisted token is active', async () => {
        useAuthStore.setState({ token: 'local-token', isVerified: true })

        await expect(waitForApiTokenReady()).resolves.toBe(true)
        expect(useAuthStore.getState().tokenDialogOpen).toBe(false)
    })

    it('opens direct token entry when no active token exists', async () => {
        await expect(waitForApiTokenReady()).resolves.toBe(false)
        expect(useAuthStore.getState().tokenDialogOpen).toBe(true)
    })
})
