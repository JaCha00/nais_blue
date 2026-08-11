import { create } from 'zustand'

import type { CredentialRef, CredentialVault } from '@/domain/credentials/types'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { getUserInfo, verifyToken, type AnlasInfo } from '@/services/novelai-api'
import { getRuntimeAuthMigrationStorage } from '@/services/credentials/auth-migration-storage'
import {
    completeLegacyAuthMigration,
    initializeEmptyAuthStateV3,
    inspectAuthPersistence,
    loadAuthSessionSecrets,
    persistAuthStateV3,
    resumeInterruptedAuthMigration,
    type AuthStateV3Persisted,
    type AuthSubscriptionTier,
    type LegacyAuthSecrets,
} from '@/services/credentials/auth-vault-migration'
import { getRuntimeCredentialVault } from '@/services/credentials/native-novelai-credential-vault'

export type ApiSlot = 1 | 2

export interface ActiveTokenEntry {
    slot: ApiSlot
    token: string
}

interface LocalAuthState extends AuthStateV3Persisted {
    /** Runtime-only plaintext. Never include this field in persistence projections. */
    token: string
    /** Runtime-only plaintext. Never include this field in persistence projections. */
    token2: string
}

export interface AuthState extends LocalAuthState {
    isVerified: boolean
    anlas: AnlasInfo | null
    isVerified2: boolean
    anlas2: AnlasInfo | null
    isLoading: boolean
    isCredentialStateInitialized: boolean
    tokenDialogOpen: boolean
    authError: string | null

    setTokenDialogOpen: (open: boolean) => void
    requestTokenEntry: () => void
    verifyAndSave: (token: string, slot?: ApiSlot) => Promise<boolean>
    reverifyCredential: (slot?: ApiSlot) => Promise<boolean>
    refreshAnlas: (slot?: ApiSlot) => Promise<void>
    refreshAllAnlas: () => Promise<void>
    deleteCredential: (slot?: ApiSlot) => Promise<void>
    clearToken: (slot?: ApiSlot) => Promise<void>
    setSlotEnabled: (slot: ApiSlot, enabled: boolean) => Promise<void>
    isSlotActive: (slot: ApiSlot) => boolean
    getActiveTokens: () => ActiveTokenEntry[]
}

/**
 * Cost previews depend on every enabled credential because generation rotates
 * across active slots. Unknown or mixed tiers use the conservative paid path;
 * only an all-Opus active set can safely display the free base allowance.
 */
export function selectActiveCredentialsAreOpus(
    state: Pick<AuthState, 'token' | 'token2' | 'slot1Enabled' | 'slot2Enabled' | 'tier' | 'tier2'>,
): boolean {
    const tiers = [
        ...(state.slot1Enabled && state.token ? [state.tier] : []),
        ...(state.slot2Enabled && state.token2 ? [state.tier2] : []),
    ]
    return tiers.length > 0 && tiers.every(tier => tier === 'opus')
}

const DEFAULT_LOCAL_AUTH: LocalAuthState = {
    token: '',
    token2: '',
    slot1CredentialRef: null,
    slot2CredentialRef: null,
    slot1Enabled: true,
    slot2Enabled: true,
    tier: null,
    tier2: null,
}

function persistedProjection(state: AuthState | LocalAuthState): AuthStateV3Persisted {
    return {
        slot1CredentialRef: state.slot1CredentialRef,
        slot2CredentialRef: state.slot2CredentialRef,
        slot1Enabled: state.slot1Enabled,
        slot2Enabled: state.slot2Enabled,
        tier: state.tier,
        tier2: state.tier2,
    }
}

function hydrateSessionState(
    persisted: AuthStateV3Persisted,
    secrets: LegacyAuthSecrets = {},
): LocalAuthState {
    return {
        ...persisted,
        token: secrets.slot1 ?? '',
        token2: secrets.slot2 ?? '',
    }
}

async function ensureVaultUnlocked(vault: CredentialVault): Promise<void> {
    if (!vault.isUnlocked()) await vault.unlock('')
}

function refForSlot(state: LocalAuthState, slot: ApiSlot): CredentialRef | null {
    return slot === 2 ? state.slot2CredentialRef : state.slot1CredentialRef
}

function tierForVerification(tier: AuthSubscriptionTier | undefined): AuthSubscriptionTier | null {
    return tier ?? null
}

function reportAuthError(error: unknown, operation: string): void {
    reportDiagnostic(error, {
        operation,
        stage: 'credential-vault',
        category: 'auth',
        recoverable: true,
    })
}

export const useAuthStore = create<AuthState>()((set, get) => ({
    ...DEFAULT_LOCAL_AUTH,
    isVerified: false,
    anlas: null,
    isVerified2: false,
    anlas2: null,
    isLoading: false,
    isCredentialStateInitialized: false,
    tokenDialogOpen: false,
    authError: null,

    setTokenDialogOpen: (open) => set({ tokenDialogOpen: open }),
    requestTokenEntry: () => set({ tokenDialogOpen: true }),

    verifyAndSave: async (candidate, slot = 1) => {
        const secret = candidate.trim()
        if (secret.length === 0) return false
        set({ isLoading: true, authError: null })
        try {
            const verification = await verifyToken(secret)
            if (!verification.valid) {
                set({ isLoading: false, authError: 'verification-failed' })
                return false
            }

            const current = get()
            const vault = getRuntimeCredentialVault()
            await ensureVaultUnlocked(vault)
            const existingRef = refForSlot(current, slot)
            const ref = await vault.set('novelai-token', secret, {
                id: slot === 2 ? 'novelai-slot-2' : 'novelai-slot-1',
                existingRef,
                verifiedAt: new Date().toISOString(),
            })
            if (await vault.get(ref) !== secret) {
                throw new Error('Credential vault readback verification failed.')
            }

            const nextPersisted: AuthStateV3Persisted = slot === 2
                ? {
                    ...persistedProjection(current),
                    slot2CredentialRef: ref,
                    slot2Enabled: true,
                    tier2: tierForVerification(verification.tier),
                }
                : {
                    ...persistedProjection(current),
                    slot1CredentialRef: ref,
                    slot1Enabled: true,
                    tier: tierForVerification(verification.tier),
                }
            await persistAuthStateV3(getRuntimeAuthMigrationStorage(), nextPersisted)
            const next: LocalAuthState = slot === 2
                ? { ...nextPersisted, token: current.token, token2: secret }
                : { ...nextPersisted, token: secret, token2: current.token2 }
            set(slot === 2
                ? { ...next, isVerified2: true, anlas2: null, isLoading: false }
                : { ...next, isVerified: true, anlas: null, isLoading: false })
            await get().refreshAnlas(slot)
            return true
        } catch (error) {
            reportAuthError(error, 'credential-vault.register')
            set({ isLoading: false, authError: 'operation-failed' })
            return false
        }
    },

    reverifyCredential: async (slot = 1) => {
        const state = get()
        const token = slot === 2 ? state.token2 : state.token
        if (token.length === 0) {
            state.requestTokenEntry()
            return false
        }
        return state.verifyAndSave(token, slot)
    },

    refreshAnlas: async (slot = 1) => {
        const state = get()
        const token = slot === 2 ? state.token2 : state.token
        const verified = slot === 2 ? state.isVerified2 : state.isVerified
        if (!token || !verified) return
        try {
            const userInfo = await getUserInfo(token)
            if (userInfo !== null) set(slot === 2 ? { anlas2: userInfo.anlas } : { anlas: userInfo.anlas })
        } catch (error) {
            reportAuthError(error, 'credential-vault.balance')
        }
    },

    refreshAllAnlas: async () => {
        await Promise.all([get().refreshAnlas(1), get().refreshAnlas(2)])
    },

    deleteCredential: async (slot = 1) => {
        const state = get()
        const vault = getRuntimeCredentialVault()
        await ensureVaultUnlocked(vault)
        const ref = refForSlot(state, slot)
        if (ref !== null) await vault.delete(ref)
        const nextPersisted: AuthStateV3Persisted = slot === 2
            ? {
                ...persistedProjection(state),
                slot2CredentialRef: null,
                slot2Enabled: false,
                tier2: null,
            }
            : {
                ...persistedProjection(state),
                slot1CredentialRef: null,
                slot1Enabled: false,
                tier: null,
            }
        await persistAuthStateV3(getRuntimeAuthMigrationStorage(), nextPersisted)
        const next: LocalAuthState = slot === 2
            ? { ...nextPersisted, token: state.token, token2: '' }
            : { ...nextPersisted, token: '', token2: state.token2 }
        set(slot === 2
            ? { ...next, isVerified2: false, anlas2: null }
            : { ...next, isVerified: false, anlas: null })
    },

    clearToken: async (slot = 1) => get().deleteCredential(slot),

    setSlotEnabled: async (slot, enabled) => {
        const state = get()
        const nextPersisted: AuthStateV3Persisted = slot === 2
            ? { ...persistedProjection(state), slot2Enabled: enabled }
            : { ...persistedProjection(state), slot1Enabled: enabled }
        await persistAuthStateV3(getRuntimeAuthMigrationStorage(), nextPersisted)
        set(nextPersisted)
    },

    isSlotActive: (slot) => {
        const state = get()
        if (slot === 2) return Boolean(state.token2 && state.isVerified2 && state.slot2Enabled)
        return Boolean(state.token && state.isVerified && state.slot1Enabled)
    },

    getActiveTokens: () => {
        const state = get()
        const tokens: ActiveTokenEntry[] = []
        if (state.token && state.isVerified && state.slot1Enabled) tokens.push({ slot: 1, token: state.token })
        if (state.token2 && state.isVerified2 && state.slot2Enabled) tokens.push({ slot: 2, token: state.token2 })
        return tokens
    },
}))

let authInitializationPromise: Promise<void> | null = null

export async function initializeAuthCredentialState(): Promise<void> {
    if (useAuthStore.getState().isCredentialStateInitialized) return
    authInitializationPromise ??= (async () => {
        try {
            const storage = getRuntimeAuthMigrationStorage()
            const vault = getRuntimeCredentialVault()
            await ensureVaultUnlocked(vault)
            const inspection = await inspectAuthPersistence(storage)
            let persisted: AuthStateV3Persisted
            let sessionSecrets: LegacyAuthSecrets

            if (inspection.status === 'legacy-pending') {
                ({ persisted, sessionSecrets } = await completeLegacyAuthMigration({
                    storage,
                    vault,
                    inspection,
                }))
            } else if (inspection.status === 'v3-verification-pending') {
                ({ persisted, sessionSecrets } = await resumeInterruptedAuthMigration({
                    storage,
                    vault,
                    inspection,
                }))
            } else if (inspection.status === 'empty') {
                persisted = await initializeEmptyAuthStateV3(storage)
                sessionSecrets = {}
            } else {
                persisted = inspection.persisted
                sessionSecrets = await loadAuthSessionSecrets(vault, persisted)
            }

            const hydrated = hydrateSessionState(persisted, sessionSecrets)
            useAuthStore.setState({
                ...hydrated,
                isVerified: hydrated.token.length > 0,
                isVerified2: hydrated.token2.length > 0,
                isCredentialStateInitialized: true,
                authError: null,
            })
        } catch (error) {
            reportAuthError(error, 'credential-vault.hydration')
            useAuthStore.setState({
                ...DEFAULT_LOCAL_AUTH,
                isVerified: false,
                isVerified2: false,
                isCredentialStateInitialized: true,
                authError: 'operation-failed',
            })
        }
    })()
    try {
        await authInitializationPromise
    } finally {
        authInitializationPromise = null
    }
}

/** Source-edit and history actions use the same in-memory token readiness gate. */
export async function waitForApiTokenReady(): Promise<boolean> {
    await initializeAuthCredentialState()
    const state = useAuthStore.getState()
    const ready = state.getActiveTokens().length > 0
    if (!ready) state.requestTokenEntry()
    return ready
}
