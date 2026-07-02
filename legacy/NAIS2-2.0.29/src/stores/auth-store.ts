import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getUserInfo, verifyToken, type AnlasInfo } from '@/services/novelai-api'

export type ApiSlot = 1 | 2

export interface ActiveTokenEntry {
    slot: ApiSlot
    token: string
}

interface AuthState {
    // Slot 1 (primary)
    token: string
    isVerified: boolean
    tier: string | null
    anlas: AnlasInfo | null
    slot1Enabled: boolean // user-controlled "use this account" flag — mid-run toggleable

    // Slot 2 (secondary)
    token2: string
    isVerified2: boolean
    tier2: string | null
    anlas2: AnlasInfo | null
    slot2Enabled: boolean

    isLoading: boolean

    setToken: (token: string, slot?: ApiSlot) => void
    verifyAndSave: (token: string, slot?: ApiSlot) => Promise<boolean>
    refreshAnlas: (slot?: ApiSlot) => Promise<void>
    refreshAllAnlas: () => Promise<void>
    clearToken: (slot?: ApiSlot) => void

    setSlotEnabled: (slot: ApiSlot, enabled: boolean) => void
    isSlotActive: (slot: ApiSlot) => boolean

    /**
     * Returns currently active token slots — verified AND user-enabled.
     * Workers re-check this every iteration; flipping `slotXEnabled` to false
     * mid-run causes that worker to exit cleanly after its in-flight image.
     */
    getActiveTokens: () => ActiveTokenEntry[]
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            token: '',
            isVerified: false,
            tier: null,
            anlas: null,
            slot1Enabled: true,

            token2: '',
            isVerified2: false,
            tier2: null,
            anlas2: null,
            slot2Enabled: true,

            isLoading: false,

            setToken: (token, slot = 1) => set(slot === 2 ? { token2: token } : { token }),

            verifyAndSave: async (token, slot = 1) => {
                set({ isLoading: true })

                const result = await verifyToken(token)

                if (result.valid) {
                    if (slot === 2) {
                        // Auto-enable on successful verify so the user doesn't
                        // need to flip another toggle to start using it.
                        set({ token2: token, isVerified2: true, tier2: result.tier || null, slot2Enabled: true })
                    } else {
                        set({ token, isVerified: true, tier: result.tier || null, slot1Enabled: true })
                    }

                    const userInfo = await getUserInfo(token)
                    if (userInfo) {
                        if (slot === 2) set({ anlas2: userInfo.anlas })
                        else set({ anlas: userInfo.anlas })
                    }

                    set({ isLoading: false })
                    return true
                } else {
                    if (slot === 2) {
                        set({ isVerified2: false, tier2: null, anlas2: null })
                    } else {
                        set({ isVerified: false, tier: null, anlas: null })
                    }
                    set({ isLoading: false })
                    return false
                }
            },

            refreshAnlas: async (slot = 1) => {
                const state = get()
                const token = slot === 2 ? state.token2 : state.token
                const verified = slot === 2 ? state.isVerified2 : state.isVerified
                if (!token || !verified) return

                const userInfo = await getUserInfo(token)
                if (userInfo) {
                    if (slot === 2) set({ anlas2: userInfo.anlas })
                    else set({ anlas: userInfo.anlas })
                }
            },

            refreshAllAnlas: async () => {
                await Promise.all([get().refreshAnlas(1), get().refreshAnlas(2)])
            },

            clearToken: (slot = 1) => set(slot === 2
                ? { token2: '', isVerified2: false, tier2: null, anlas2: null, slot2Enabled: false }
                : { token: '', isVerified: false, tier: null, anlas: null, slot1Enabled: false }
            ),

            setSlotEnabled: (slot, enabled) => set(slot === 2
                ? { slot2Enabled: enabled }
                : { slot1Enabled: enabled }
            ),

            isSlotActive: (slot) => {
                const s = get()
                if (slot === 2) return !!s.token2 && s.isVerified2 && s.slot2Enabled
                return !!s.token && s.isVerified && s.slot1Enabled
            },

            getActiveTokens: () => {
                const s = get()
                const tokens: ActiveTokenEntry[] = []
                if (s.token && s.isVerified && s.slot1Enabled) tokens.push({ slot: 1, token: s.token })
                if (s.token2 && s.isVerified2 && s.slot2Enabled) tokens.push({ slot: 2, token: s.token2 })
                return tokens
            },
        }),
        {
            name: 'nais2-auth',
            partialize: (state) => ({
                token: state.token,
                isVerified: state.isVerified,
                tier: state.tier,
                slot1Enabled: state.slot1Enabled,
                token2: state.token2,
                isVerified2: state.isVerified2,
                tier2: state.tier2,
                slot2Enabled: state.slot2Enabled,
            }),
            onRehydrateStorage: () => (state) => {
                // Migration: previously slot1Enabled/slot2Enabled didn't exist.
                // Default both to true so existing dual-API users keep working.
                if (state) {
                    if (typeof state.slot1Enabled !== 'boolean') state.slot1Enabled = true
                    if (typeof state.slot2Enabled !== 'boolean') state.slot2Enabled = true
                }
            },
        }
    )
)
