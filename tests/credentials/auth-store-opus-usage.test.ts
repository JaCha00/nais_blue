import { beforeEach, describe, expect, it, vi } from 'vitest'

const provider = vi.hoisted(() => ({
    getUserInfo: vi.fn(),
    verifyToken: vi.fn(),
}))
const migrationStorage = vi.hoisted(() => {
    let value: string | null = null
    return {
        getStrict: vi.fn(async () => value),
        setStrict: vi.fn(async (_key: string, next: string) => { value = next }),
        getLegacyLocalAuth: vi.fn(() => value),
        setLegacyLocalAuth: vi.fn((next: string) => { value = next }),
    }
})

vi.mock('@/services/novelai-api', () => provider)
vi.mock('@/services/credentials/auth-migration-storage', () => ({
    getRuntimeAuthMigrationStorage: () => migrationStorage,
}))

import { useAuthStore } from '@/stores/auth-store'

const usage = {
    percent: 72.5,
    isNegative: false,
    timeUntilNextPercent: 120,
}

describe('runtime Opus V5 usage state', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        useAuthStore.setState({
            token: 'slot-one-token',
            token2: 'slot-two-token',
            isVerified: true,
            isVerified2: true,
            anlas: null,
            anlas2: null,
            opusUsage: null,
            opusUsage2: null,
            slot1Enabled: true,
            slot2Enabled: true,
        })
    })

    it('refreshes each credential slot without crossing their balances or usage', async () => {
        provider.getUserInfo
            .mockResolvedValueOnce({ anlas: { fixed: 1, purchased: 2, total: 3 }, usage })
            .mockResolvedValueOnce({
                anlas: { fixed: 4, purchased: 5, total: 9 },
                usage: { ...usage, percent: 31 },
            })

        await useAuthStore.getState().refreshAnlas(1)
        await useAuthStore.getState().refreshAnlas(2)

        expect(useAuthStore.getState()).toMatchObject({
            anlas: { fixed: 1, purchased: 2, total: 3 },
            opusUsage: usage,
            anlas2: { fixed: 4, purchased: 5, total: 9 },
            opusUsage2: { ...usage, percent: 31 },
        })
    })

    it('clears stale usage when a successful older response has no usage field', async () => {
        useAuthStore.setState({ opusUsage: usage })
        provider.getUserInfo.mockResolvedValue({ anlas: { fixed: 1, purchased: 2, total: 3 } })

        await useAuthStore.getState().refreshAnlas(1)

        expect(useAuthStore.getState().opusUsage).toBeNull()
        expect(useAuthStore.getState().anlas).toEqual({ fixed: 1, purchased: 2, total: 3 })
    })

    it('clears stale usage when the credential is absent or the provider request fails', async () => {
        useAuthStore.setState({ token: '', isVerified: false, opusUsage: usage })
        await useAuthStore.getState().refreshAnlas(1)
        expect(useAuthStore.getState().opusUsage).toBeNull()
        expect(provider.getUserInfo).not.toHaveBeenCalled()

        useAuthStore.setState({ token: 'slot-one-token', isVerified: true, opusUsage: usage })
        provider.getUserInfo.mockResolvedValue(null)
        await useAuthStore.getState().refreshAnlas(1)
        expect(useAuthStore.getState().opusUsage).toBeNull()
    })

    it('ignores an in-flight response after the credential changes', async () => {
        let resolveRequest: ((value: unknown) => void) | undefined
        provider.getUserInfo.mockReturnValue(new Promise(resolve => {
            resolveRequest = resolve
        }))

        const refresh = useAuthStore.getState().refreshAnlas(1)
        useAuthStore.setState({ token: '', isVerified: false, opusUsage: null })
        resolveRequest?.({ anlas: { fixed: 1, purchased: 2, total: 3 }, usage })
        await refresh

        expect(useAuthStore.getState().opusUsage).toBeNull()
        expect(useAuthStore.getState().anlas).toBeNull()
    })

    it('does not clear a new credential quota when an older request fails late', async () => {
        let rejectRequest: ((reason?: unknown) => void) | undefined
        provider.getUserInfo.mockReturnValue(new Promise((_resolve, reject) => {
            rejectRequest = reject
        }))

        const refresh = useAuthStore.getState().refreshAnlas(1)
        const replacementUsage = { ...usage, percent: 99 }
        useAuthStore.setState({
            token: 'replacement-token',
            isVerified: true,
            opusUsage: replacementUsage,
        })
        rejectRequest?.(new Error('fixture late failure'))
        await refresh

        expect(useAuthStore.getState().opusUsage).toEqual(replacementUsage)
    })

    it('refreshes a slot after it is re-enabled so refilled usage is not stale', async () => {
        const refilledUsage = { ...usage, percent: 96 }
        useAuthStore.setState({ slot1Enabled: false, opusUsage: { ...usage, percent: 20 } })
        provider.getUserInfo.mockResolvedValue({
            anlas: { fixed: 10, purchased: 5, total: 15 },
            usage: refilledUsage,
        })

        await useAuthStore.getState().setSlotEnabled(1, true)

        expect(provider.getUserInfo).toHaveBeenCalledWith('slot-one-token')
        expect(useAuthStore.getState()).toMatchObject({
            slot1Enabled: true,
            opusUsage: refilledUsage,
        })
    })
})
