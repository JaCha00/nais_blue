import { create } from 'zustand'

import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { getUserInfo, verifyToken, type AnlasInfo } from '@/services/novelai-api'
import { getRuntimeAuthMigrationStorage } from '@/services/credentials/auth-migration-storage'
import { AUTH_STORE_KEY } from '@/services/credentials/auth-vault-migration'

export type ApiSlot = 1 | 2

export interface ActiveTokenEntry {
    slot: ApiSlot
    token: string
}

interface LocalAuthState {
    token: string
    token2: string
    slot1Enabled: boolean
    slot2Enabled: boolean
    tier: string | null
    tier2: string | null
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

const DEFAULT_LOCAL_AUTH: LocalAuthState = {
    token: '',
    token2: '',
    slot1Enabled: true,
    slot2Enabled: true,
    tier: null,
    tier2: null,
}

function stringOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function nullableString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * NovelAI tokens depend only on this app's local IndexedDB storage. They are
 * deliberately absent from backup projections, so the desktop can start
 * generation immediately after restart without a separate vault session while
 * exported backups still require token re-entry on another machine.
 */
function parseLocalAuth(raw: string | null): LocalAuthState {
    if (raw === null) return DEFAULT_LOCAL_AUTH
    try {
        const payload = JSON.parse(raw) as Record<string, unknown>
        const state = payload.state && typeof payload.state === 'object'
            ? payload.state as Record<string, unknown>
            : payload
        return {
            token: stringOrEmpty(state.token),
            token2: stringOrEmpty(state.token2),
            slot1Enabled: typeof state.slot1Enabled === 'boolean' ? state.slot1Enabled : true,
            slot2Enabled: typeof state.slot2Enabled === 'boolean' ? state.slot2Enabled : true,
            tier: nullableString(state.tier),
            tier2: nullableString(state.tier2),
        }
    } catch {
        return DEFAULT_LOCAL_AUTH
    }
}

function serializeLocalAuth(state: LocalAuthState): string {
    return JSON.stringify({ state, version: 4 })
}

async function persistLocalAuth(state: LocalAuthState): Promise<void> {
    await getRuntimeAuthMigrationStorage().setStrict(AUTH_STORE_KEY, serializeLocalAuth(state))
}

function localProjection(state: AuthState): LocalAuthState {
    return {
        token: state.token,
        token2: state.token2,
        slot1Enabled: state.slot1Enabled,
        slot2Enabled: state.slot2Enabled,
        tier: state.tier,
        tier2: state.tier2,
    }
}

function reportAuthError(error: unknown, operation: string): void {
    reportDiagnostic(error, {
        operation,
        stage: 'local-auth',
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
            const next: LocalAuthState = slot === 2
                ? { ...localProjection(current), token2: secret, slot2Enabled: true, tier2: verification.tier ?? null }
                : { ...localProjection(current), token: secret, slot1Enabled: true, tier: verification.tier ?? null }
            await persistLocalAuth(next)
            set(slot === 2
                ? { ...next, isVerified2: true, anlas2: null, isLoading: false }
                : { ...next, isVerified: true, anlas: null, isLoading: false })
            await get().refreshAnlas(slot)
            return true
        } catch (error) {
            reportAuthError(error, 'local-auth.register')
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
            reportAuthError(error, 'local-auth.balance')
        }
    },

    refreshAllAnlas: async () => {
        await Promise.all([get().refreshAnlas(1), get().refreshAnlas(2)])
    },

    deleteCredential: async (slot = 1) => {
        const state = get()
        const next: LocalAuthState = slot === 2
            ? { ...localProjection(state), token2: '', slot2Enabled: false, tier2: null }
            : { ...localProjection(state), token: '', slot1Enabled: false, tier: null }
        await persistLocalAuth(next)
        set(slot === 2
            ? { ...next, isVerified2: false, anlas2: null }
            : { ...next, isVerified: false, anlas: null })
    },

    clearToken: async (slot = 1) => get().deleteCredential(slot),

    setSlotEnabled: async (slot, enabled) => {
        const state = get()
        const next: LocalAuthState = slot === 2
            ? { ...localProjection(state), slot2Enabled: enabled }
            : { ...localProjection(state), slot1Enabled: enabled }
        await persistLocalAuth(next)
        set(next)
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
            const stored = parseLocalAuth(await getRuntimeAuthMigrationStorage().getStrict(AUTH_STORE_KEY))
            useAuthStore.setState({
                ...stored,
                isVerified: stored.token.length > 0,
                isVerified2: stored.token2.length > 0,
                isCredentialStateInitialized: true,
                authError: null,
            })
        } catch (error) {
            reportAuthError(error, 'local-auth.hydration')
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

/** Source-edit and history actions use the same direct token readiness gate. */
export async function waitForApiTokenReady(): Promise<boolean> {
    await initializeAuthCredentialState()
    const state = useAuthStore.getState()
    const ready = state.getActiveTokens().length > 0
    if (!ready) state.requestTokenEntry()
    return ready
}
