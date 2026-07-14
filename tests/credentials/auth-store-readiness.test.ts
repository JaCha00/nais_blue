import { beforeEach, describe, expect, it } from 'vitest'

import {
    useAuthStore,
    waitForCredentialVaultReady,
} from '@/stores/auth-store'

describe('credential vault source-edit readiness', () => {
    beforeEach(() => {
        useAuthStore.setState({
            isCredentialStateInitialized: true,
            vaultStatus: 'locked',
            vaultDialogOpen: false,
            vaultErrorCode: null,
        })
    })

    it('treats a hydrated locked vault as ready for source-edit composition', async () => {
        await expect(waitForCredentialVaultReady()).resolves.toBe(true)
        expect(useAuthStore.getState().vaultDialogOpen).toBe(false)
    })

    it('fails closed and opens recovery UI when native vault availability failed', async () => {
        useAuthStore.setState({ vaultStatus: 'unavailable' })

        await expect(waitForCredentialVaultReady()).resolves.toBe(false)
        expect(useAuthStore.getState().vaultDialogOpen).toBe(true)
    })

    it('waits for an in-flight unlock to reach a terminal status', async () => {
        useAuthStore.setState({ vaultStatus: 'unlocking' })
        let settled = false
        const readiness = waitForCredentialVaultReady().then(result => {
            settled = true
            return result
        })

        await Promise.resolve()
        expect(settled).toBe(false)
        useAuthStore.setState({ vaultStatus: 'unlocked' })
        await expect(readiness).resolves.toBe(true)
    })
})
