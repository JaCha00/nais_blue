import { create } from 'zustand'

import {
    CredentialVaultError,
    type CredentialRef,
    type CredentialVaultErrorCode,
} from '@/domain/credentials/types'
import { reportDiagnostic } from '@/services/diagnostics/error-registry'
import { getUserInfo, verifyToken, type AnlasInfo } from '@/services/novelai-api'
import { getRuntimeAuthMigrationStorage } from '@/services/credentials/auth-migration-storage'
import {
    completeLegacyAuthMigration,
    initializeEmptyAuthStateV3,
    inspectAuthPersistence,
    persistAuthStateV3,
    resumeInterruptedAuthMigration,
    type AuthPersistenceInspection,
    type AuthPersistenceStatus,
    type AuthStateV3Persisted,
} from '@/services/credentials/auth-vault-migration'
import { getRuntimeCredentialVault } from '@/services/credentials/stronghold-credential-vault'

export type ApiSlot = 1 | 2

export interface ActiveTokenEntry {
    slot: ApiSlot
    token: string
}

export type CredentialVaultStatus = 'unavailable' | 'locked' | 'unlocking' | 'unlocked' | 'error'

export interface AuthState {
    token: string
    isVerified: boolean
    tier: string | null
    anlas: AnlasInfo | null
    slot1Enabled: boolean
    slot1CredentialRef: CredentialRef | null

    token2: string
    isVerified2: boolean
    tier2: string | null
    anlas2: AnlasInfo | null
    slot2Enabled: boolean
    slot2CredentialRef: CredentialRef | null

    isLoading: boolean
    isCredentialStateInitialized: boolean
    vaultStatus: CredentialVaultStatus
    vaultExists: boolean
    vaultDialogOpen: boolean
    credentialMigrationStatus: AuthPersistenceStatus | 'not-initialized' | 'failed'
    vaultErrorCode: CredentialVaultErrorCode | null

    setVaultDialogOpen: (open: boolean) => void
    requestCredentialUnlock: () => void
    unlockVault: (passphrase: string) => Promise<boolean>
    lockVault: () => Promise<void>
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

let pendingInspection: AuthPersistenceInspection | null = null

function persistedFromState(state: AuthState): AuthStateV3Persisted {
    return {
        slot1CredentialRef: state.slot1CredentialRef,
        slot2CredentialRef: state.slot2CredentialRef,
        slot1Enabled: state.slot1Enabled,
        slot2Enabled: state.slot2Enabled,
        tier: state.tier as AuthStateV3Persisted['tier'],
        tier2: state.tier2 as AuthStateV3Persisted['tier2'],
    }
}

function runtimePatchFromPersisted(persisted: AuthStateV3Persisted): Partial<AuthState> {
    return {
        slot1CredentialRef: persisted.slot1CredentialRef,
        slot2CredentialRef: persisted.slot2CredentialRef,
        slot1Enabled: persisted.slot1Enabled,
        slot2Enabled: persisted.slot2Enabled,
        tier: persisted.tier,
        tier2: persisted.tier2,
    }
}

function vaultErrorCode(error: unknown): CredentialVaultErrorCode {
    return error instanceof CredentialVaultError ? error.code : 'operation-failed'
}

function reportVaultError(error: unknown, operation: string): void {
    reportDiagnostic(error, {
        operation,
        stage: 'credential-vault',
        category: 'auth',
        recoverable: true,
    })
}

async function loadSessionSecret(ref: CredentialRef | null): Promise<string> {
    if (ref === null) return ''
    const secret = await getRuntimeCredentialVault().get(ref)
    if (secret === null || secret.slice(-4) !== ref.lastFour) {
        throw new CredentialVaultError('not-found', 'Credential was not found.')
    }
    return secret
}

export const useAuthStore = create<AuthState>()((set, get) => ({
    token: '',
    isVerified: false,
    tier: null,
    anlas: null,
    slot1Enabled: true,
    slot1CredentialRef: null,

    token2: '',
    isVerified2: false,
    tier2: null,
    anlas2: null,
    slot2Enabled: true,
    slot2CredentialRef: null,

    isLoading: false,
    isCredentialStateInitialized: false,
    vaultStatus: 'unavailable',
    vaultExists: false,
    vaultDialogOpen: false,
    credentialMigrationStatus: 'not-initialized',
    vaultErrorCode: null,

    setVaultDialogOpen: (open) => set({ vaultDialogOpen: open }),
    requestCredentialUnlock: () => set({ vaultDialogOpen: true }),

    unlockVault: async (passphrase) => {
        set({
            isLoading: true,
            vaultStatus: 'unlocking',
            vaultErrorCode: null,
        })
        const vault = getRuntimeCredentialVault()
        const storage = getRuntimeAuthMigrationStorage()
        try {
            const unlockResult = await vault.unlock(passphrase)
            const freshInspection = await inspectAuthPersistence(storage)
            const inspection = pendingInspection?.status === 'legacy-pending'
                && freshInspection.status === 'legacy-pending'
                ? {
                    ...freshInspection,
                    legacySecrets: pendingInspection.legacySecrets,
                    legacyMetadata: pendingInspection.legacyMetadata,
                }
                : freshInspection
            pendingInspection = inspection

            let persisted = inspection.persisted
            if (inspection.status === 'legacy-pending') {
                const migration = await completeLegacyAuthMigration({ storage, vault, inspection })
                persisted = migration.persisted
            } else if (inspection.status === 'v3-verification-pending') {
                const migration = await resumeInterruptedAuthMigration({ storage, vault, inspection })
                persisted = migration.persisted
            } else if (inspection.status === 'empty') {
                persisted = await initializeEmptyAuthStateV3(storage)
            }

            const [token, token2] = await Promise.all([
                loadSessionSecret(persisted.slot1CredentialRef),
                loadSessionSecret(persisted.slot2CredentialRef),
            ])
            pendingInspection = null
            set({
                ...runtimePatchFromPersisted(persisted),
                token,
                token2,
                isVerified: token.length > 0 && persisted.slot1CredentialRef?.verifiedAt !== undefined,
                isVerified2: token2.length > 0 && persisted.slot2CredentialRef?.verifiedAt !== undefined,
                anlas: null,
                anlas2: null,
                isLoading: false,
                vaultStatus: 'unlocked',
                vaultExists: unlockResult.created ? true : get().vaultExists,
                vaultDialogOpen: inspection.status === 'legacy-pending' ? false : get().vaultDialogOpen,
                credentialMigrationStatus: 'complete',
                vaultErrorCode: null,
            })
            return true
        } catch (error) {
            await vault.lock().catch(() => undefined)
            reportVaultError(error, 'credential-vault.unlock')
            const code = vaultErrorCode(error)
            set({
                token: '',
                token2: '',
                isVerified: false,
                isVerified2: false,
                anlas: null,
                anlas2: null,
                isLoading: false,
                vaultStatus: code === 'unavailable' ? 'unavailable' : code === 'wrong-passphrase' ? 'locked' : 'error',
                vaultErrorCode: code,
                vaultDialogOpen: true,
            })
            return false
        }
    },

    lockVault: async () => {
        try {
            await getRuntimeCredentialVault().lock()
        } catch (error) {
            reportVaultError(error, 'credential-vault.lock')
        } finally {
            set({
                token: '',
                token2: '',
                isVerified: false,
                isVerified2: false,
                anlas: null,
                anlas2: null,
                vaultStatus: get().vaultStatus === 'unavailable' ? 'unavailable' : 'locked',
                vaultErrorCode: null,
            })
        }
    },

    verifyAndSave: async (candidate, slot = 1) => {
        if (!getRuntimeCredentialVault().isUnlocked()) {
            set({ vaultDialogOpen: true, vaultStatus: get().vaultStatus === 'unavailable' ? 'unavailable' : 'locked' })
            return false
        }
        const secret = candidate.trim()
        if (secret.length === 0) return false
        set({ isLoading: true, vaultErrorCode: null })
        try {
            const verification = await verifyToken(secret)
            if (!verification.valid) {
                set({ isLoading: false })
                return false
            }

            const state = get()
            const existingRef = slot === 2 ? state.slot2CredentialRef : state.slot1CredentialRef
            const ref = await getRuntimeCredentialVault().set('novelai-token', secret, {
                id: slot === 2 ? 'novelai-slot-2' : 'novelai-slot-1',
                existingRef,
                verifiedAt: new Date().toISOString(),
            })
            const readback = await getRuntimeCredentialVault().get(ref)
            if (readback !== secret) throw new CredentialVaultError('readback-failed', 'Credential vault verification failed.')

            const nextPersisted: AuthStateV3Persisted = {
                ...persistedFromState(state),
                ...(slot === 2
                    ? { slot2CredentialRef: ref, slot2Enabled: true, tier2: verification.tier ?? null }
                    : { slot1CredentialRef: ref, slot1Enabled: true, tier: verification.tier ?? null }),
            }
            await persistAuthStateV3(getRuntimeAuthMigrationStorage(), nextPersisted)
            set(slot === 2
                ? {
                    token2: secret,
                    isVerified2: true,
                    tier2: verification.tier ?? null,
                    slot2Enabled: true,
                    slot2CredentialRef: ref,
                    anlas2: null,
                    isLoading: false,
                }
                : {
                    token: secret,
                    isVerified: true,
                    tier: verification.tier ?? null,
                    slot1Enabled: true,
                    slot1CredentialRef: ref,
                    anlas: null,
                    isLoading: false,
                })

            const userInfo = await getUserInfo(secret)
            if (userInfo !== null) {
                set(slot === 2 ? { anlas2: userInfo.anlas } : { anlas: userInfo.anlas })
            }
            return true
        } catch (error) {
            reportVaultError(error, 'credential-vault.register')
            set({ isLoading: false, vaultErrorCode: vaultErrorCode(error) })
            return false
        }
    },

    reverifyCredential: async (slot = 1) => {
        const state = get()
        const token = slot === 2 ? state.token2 : state.token
        if (token.length === 0) {
            set({ vaultDialogOpen: true })
            return false
        }
        return state.verifyAndSave(token, slot)
    },

    refreshAnlas: async (slot = 1) => {
        const state = get()
        const token = slot === 2 ? state.token2 : state.token
        const verified = slot === 2 ? state.isVerified2 : state.isVerified
        if (!token || !verified) return

        const userInfo = await getUserInfo(token)
        if (userInfo !== null) {
            set(slot === 2 ? { anlas2: userInfo.anlas } : { anlas: userInfo.anlas })
        }
    },

    refreshAllAnlas: async () => {
        await Promise.all([get().refreshAnlas(1), get().refreshAnlas(2)])
    },

    deleteCredential: async (slot = 1) => {
        const state = get()
        const ref = slot === 2 ? state.slot2CredentialRef : state.slot1CredentialRef
        if (ref === null) return
        if (!getRuntimeCredentialVault().isUnlocked()) {
            set({ vaultDialogOpen: true })
            throw new CredentialVaultError('locked', 'Credential vault is locked.')
        }
        set({ isLoading: true, vaultErrorCode: null })
        try {
            await getRuntimeCredentialVault().delete(ref)
            if (await getRuntimeCredentialVault().get(ref) !== null) {
                throw new CredentialVaultError('readback-failed', 'Credential vault verification failed.')
            }
            const nextPersisted: AuthStateV3Persisted = {
                ...persistedFromState(state),
                ...(slot === 2
                    ? { slot2CredentialRef: null, slot2Enabled: false, tier2: null }
                    : { slot1CredentialRef: null, slot1Enabled: false, tier: null }),
            }
            await persistAuthStateV3(getRuntimeAuthMigrationStorage(), nextPersisted)
            set(slot === 2
                ? {
                    token2: '',
                    isVerified2: false,
                    tier2: null,
                    anlas2: null,
                    slot2Enabled: false,
                    slot2CredentialRef: null,
                    isLoading: false,
                }
                : {
                    token: '',
                    isVerified: false,
                    tier: null,
                    anlas: null,
                    slot1Enabled: false,
                    slot1CredentialRef: null,
                    isLoading: false,
                })
        } catch (error) {
            reportVaultError(error, 'credential-vault.delete')
            set({ isLoading: false, vaultErrorCode: vaultErrorCode(error) })
            throw error
        }
    },

    clearToken: async (slot = 1) => get().deleteCredential(slot),

    setSlotEnabled: async (slot, enabled) => {
        const state = get()
        const nextPersisted: AuthStateV3Persisted = {
            ...persistedFromState(state),
            ...(slot === 2 ? { slot2Enabled: enabled } : { slot1Enabled: enabled }),
        }
        try {
            await persistAuthStateV3(getRuntimeAuthMigrationStorage(), nextPersisted)
            set(slot === 2 ? { slot2Enabled: enabled } : { slot1Enabled: enabled })
        } catch (error) {
            reportVaultError(error, 'credential-vault.slot-enabled')
            throw error
        }
    },

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
}))

async function hydrateAuthCredentialState(): Promise<void> {
    const storage = getRuntimeAuthMigrationStorage()
    try {
        let inspection = await inspectAuthPersistence(storage)
        if (inspection.status === 'empty') {
            await initializeEmptyAuthStateV3(storage)
            inspection = await inspectAuthPersistence(storage)
        }
        pendingInspection = {
            ...inspection,
            indexedRaw: null,
            localRaw: null,
        }
        const availability = await getRuntimeCredentialVault().availability()
        useAuthStore.setState({
            ...runtimePatchFromPersisted(inspection.persisted),
            token: '',
            token2: '',
            isVerified: false,
            isVerified2: false,
            anlas: null,
            anlas2: null,
            isLoading: false,
            isCredentialStateInitialized: true,
            vaultStatus: availability.available ? 'locked' : 'unavailable',
            vaultExists: availability.exists,
            vaultDialogOpen: inspection.status === 'legacy-pending',
            credentialMigrationStatus: inspection.status,
            vaultErrorCode: availability.available ? null : 'unavailable',
        })
    } catch (error) {
        reportVaultError(error, 'credential-vault.hydration')
        pendingInspection = null
        useAuthStore.setState({
            token: '',
            token2: '',
            isVerified: false,
            isVerified2: false,
            anlas: null,
            anlas2: null,
            isLoading: false,
            isCredentialStateInitialized: true,
            vaultStatus: 'error',
            vaultDialogOpen: true,
            credentialMigrationStatus: 'failed',
            vaultErrorCode: vaultErrorCode(error),
        })
    }
}

let authCredentialInitializationPromise: Promise<void> | null = null

export async function initializeAuthCredentialState(): Promise<void> {
    if (useAuthStore.getState().isCredentialStateInitialized) return
    authCredentialInitializationPromise ??= hydrateAuthCredentialState()
    try {
        await authCredentialInitializationPromise
    } finally {
        authCredentialInitializationPromise = null
    }
}

/** Wait for startup hydration (and an active unlock) before entering source-edit UI. */
export async function waitForCredentialVaultReady(): Promise<boolean> {
    await initializeAuthCredentialState()
    if (useAuthStore.getState().vaultStatus === 'unlocking') {
        await new Promise<void>((resolve) => {
            const finishWhenSettled = (status: CredentialVaultStatus) => {
                if (status === 'unlocking') return
                unsubscribe()
                resolve()
            }
            const unsubscribe = useAuthStore.subscribe((state) => {
                finishWhenSettled(state.vaultStatus)
            })
            finishWhenSettled(useAuthStore.getState().vaultStatus)
        })
    }

    const state = useAuthStore.getState()
    const ready = state.isCredentialStateInitialized
        && state.vaultStatus !== 'unavailable'
        && state.vaultStatus !== 'error'
    if (!ready) state.requestCredentialUnlock()
    return ready
}
