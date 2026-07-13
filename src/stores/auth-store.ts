import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { getUserInfo, verifyToken, type AnlasInfo } from '@/services/novelai-api'

export type ApiSlot = 1 | 2

export interface ActiveTokenEntry {
    slot: ApiSlot
    token: string
}

interface AuthState {
    // Slot 1 keeps B's original field names so existing generation,
    // backup/import flows continue to read the primary token.
    token: string
    isVerified: boolean
    tier: string | null
    anlas: AnlasInfo | null
    slot1Enabled: boolean

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
    getActiveTokens: () => ActiveTokenEntry[]
}

type PersistedAuthState = Partial<Pick<AuthState,
    'token' | 'isVerified' | 'tier' | 'slot1Enabled' |
    'token2' | 'isVerified2' | 'tier2' | 'slot2Enabled'
>>

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
                        set({ token2: token, isVerified2: true, tier2: result.tier || null, slot2Enabled: true })
                    } else {
                        set({ token, isVerified: true, tier: result.tier || null, slot1Enabled: true })
                    }

                    const userInfo = await getUserInfo(token)
                    if (userInfo) {
                        if (slot === 2) {
                            set({ anlas2: userInfo.anlas })
                        } else {
                            set({ anlas: userInfo.anlas })
                        }
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
                    if (slot === 2) {
                        set({ anlas2: userInfo.anlas })
                    } else {
                        set({ anlas: userInfo.anlas })
                    }
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
                const state = get()
                if (slot === 2) return !!state.token2 && state.isVerified2 && state.slot2Enabled
                return !!state.token && state.isVerified && state.slot1Enabled
            },

            getActiveTokens: () => {
                const state = get()
                const tokens: ActiveTokenEntry[] = []
                if (state.token && state.isVerified && state.slot1Enabled) tokens.push({ slot: 1, token: state.token })
                if (state.token2 && state.isVerified2 && state.slot2Enabled) tokens.push({ slot: 2, token: state.token2 })
                return tokens
            },
        }),
        {
            name: 'nais2-auth',
            storage: createJSONStorage(() => indexedDBStorage),
            version: 2,
            migrate: (persistedState, version) => {
                const state = persistedState as PersistedAuthState

                if (version < 2) {
                    return {
                        ...state,
                        slot1Enabled: typeof state.slot1Enabled === 'boolean' ? state.slot1Enabled : true,
                        token2: typeof state.token2 === 'string' ? state.token2 : '',
                        isVerified2: typeof state.isVerified2 === 'boolean' ? state.isVerified2 : false,
                        tier2: typeof state.tier2 === 'string' ? state.tier2 : null,
                        slot2Enabled: typeof state.slot2Enabled === 'boolean' ? state.slot2Enabled : true,
                    }
                }

                return {
                    ...state,
                    slot1Enabled: typeof state.slot1Enabled === 'boolean' ? state.slot1Enabled : true,
                    slot2Enabled: typeof state.slot2Enabled === 'boolean' ? state.slot2Enabled : true,
                }
            },
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
                if (!state) return
                // Migration boundary: older B persisted only slot 1. Missing
                // flags default enabled so existing verified users keep working.
                if (typeof state.slot1Enabled !== 'boolean') state.slot1Enabled = true
                if (typeof state.slot2Enabled !== 'boolean') state.slot2Enabled = true
            },
        }
    )
)
