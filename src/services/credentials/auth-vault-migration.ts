import {
    type CredentialRef,
    type CredentialVault,
} from '@/domain/credentials/types'

export const AUTH_STORE_KEY = 'nais2-auth' as const
export const AUTH_MIGRATION_MARKER_KEY = 'nais2-auth-v3-migration-complete' as const
export const AUTH_STATE_VERSION = 3 as const

const AUTH_MIGRATION_MARKER_VERSION = 1 as const
const SUBSCRIPTION_TIERS = new Set(['paper', 'tablet', 'scroll', 'opus'])
const FORBIDDEN_PERSISTED_FIELDS = new Set([
    'token',
    'token2',
    'sessionPlaintext',
    'anlas',
    'anlas2',
])

export type AuthSubscriptionTier = 'paper' | 'tablet' | 'scroll' | 'opus'

export interface AuthStateV3Persisted {
    slot1CredentialRef: CredentialRef | null
    slot2CredentialRef: CredentialRef | null
    slot1Enabled: boolean
    slot2Enabled: boolean
    tier: AuthSubscriptionTier | null
    tier2: AuthSubscriptionTier | null
}

export interface LegacyAuthSessionMetadata {
    slot1Verified: boolean
    slot2Verified: boolean
}

export interface LegacyAuthSecrets {
    slot1?: string
    slot2?: string
}

export type AuthPersistenceStatus =
    | 'empty'
    | 'legacy-pending'
    | 'v3-verification-pending'
    | 'complete'

export interface AuthPersistenceInspection {
    status: AuthPersistenceStatus
    persisted: AuthStateV3Persisted
    legacySecrets: LegacyAuthSecrets
    legacyMetadata: LegacyAuthSessionMetadata
    indexedRaw: string | null
    localRaw: string | null
    markerRaw: string | null
}

export interface AuthMigrationStorage {
    getStrict(key: string): Promise<string | null>
    setStrict(key: string, value: string): Promise<void>
    getLegacyLocalAuth(): string | null
    setLegacyLocalAuth(value: string): void
}

export interface AuthMigrationResult {
    persisted: AuthStateV3Persisted
    sessionSecrets: LegacyAuthSecrets
}

interface ParsedAuthPayload {
    version: number | null
    state: Record<string, unknown>
}

interface LegacyAuthProjection {
    secrets: LegacyAuthSecrets
    metadata: LegacyAuthSessionMetadata
    persisted: AuthStateV3Persisted
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAuthPayload(raw: string | null): ParsedAuthPayload | null {
    if (raw === null) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(raw) as unknown
    } catch {
        throw new Error('Persisted authentication state is not valid JSON.')
    }
    if (!isRecord(parsed)) throw new Error('Persisted authentication state is not an object.')
    const state = isRecord(parsed.state) ? parsed.state : parsed
    return {
        version: typeof parsed.version === 'number' && Number.isInteger(parsed.version)
            ? parsed.version
            : null,
        state,
    }
}

function normalizeTier(value: unknown): AuthSubscriptionTier | null {
    return typeof value === 'string' && SUBSCRIPTION_TIERS.has(value)
        ? value as AuthSubscriptionTier
        : null
}

function normalizeEnabled(value: unknown, fallback = true): boolean {
    return typeof value === 'boolean' ? value : fallback
}

function normalizeTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
    return value
}

function normalizeCredentialRef(value: unknown, expectedId: string): CredentialRef | null {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || !/^[a-z0-9:_-]{1,96}$/i.test(value.id)
        || value.id !== expectedId
        || value.kind !== 'novelai-token'
        || typeof value.lastFour !== 'string'
        || value.lastFour.length !== 4) {
        return null
    }
    const createdAt = normalizeTimestamp(value.createdAt)
    const updatedAt = normalizeTimestamp(value.updatedAt)
    const verifiedAt = normalizeTimestamp(value.verifiedAt)
    if (createdAt === null || updatedAt === null) return null
    return {
        id: value.id,
        kind: value.kind,
        lastFour: value.lastFour,
        createdAt,
        updatedAt,
        ...(verifiedAt === null ? {} : { verifiedAt }),
    }
}

function emptyPersistedState(): AuthStateV3Persisted {
    return {
        slot1CredentialRef: null,
        slot2CredentialRef: null,
        slot1Enabled: true,
        slot2Enabled: true,
        tier: null,
        tier2: null,
    }
}

function parseV3State(payload: ParsedAuthPayload | null): AuthStateV3Persisted | null {
    if (payload === null || payload.version !== AUTH_STATE_VERSION) return null
    return {
        slot1CredentialRef: normalizeCredentialRef(payload.state.slot1CredentialRef, 'novelai-slot-1'),
        slot2CredentialRef: normalizeCredentialRef(payload.state.slot2CredentialRef, 'novelai-slot-2'),
        slot1Enabled: normalizeEnabled(payload.state.slot1Enabled),
        slot2Enabled: normalizeEnabled(payload.state.slot2Enabled),
        tier: normalizeTier(payload.state.tier),
        tier2: normalizeTier(payload.state.tier2),
    }
}

function legacySecret(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

function legacyProjection(payload: ParsedAuthPayload | null): LegacyAuthProjection {
    const state = payload?.state ?? {}
    const slot1 = legacySecret(state.token)
    const slot2 = legacySecret(state.token2)
    return {
        secrets: {
            ...(slot1 === undefined ? {} : { slot1 }),
            ...(slot2 === undefined ? {} : { slot2 }),
        },
        metadata: {
            slot1Verified: state.isVerified === true,
            slot2Verified: state.isVerified2 === true,
        },
        persisted: {
            ...emptyPersistedState(),
            slot1Enabled: normalizeEnabled(state.slot1Enabled),
            slot2Enabled: normalizeEnabled(state.slot2Enabled),
            tier: normalizeTier(state.tier),
            tier2: normalizeTier(state.tier2),
        },
    }
}

function mergeLegacyProjection(
    primary: LegacyAuthProjection,
    secondary: LegacyAuthProjection,
): LegacyAuthProjection {
    return {
        secrets: {
            ...(primary.secrets.slot1 ?? secondary.secrets.slot1) === undefined
                ? {}
                : { slot1: primary.secrets.slot1 ?? secondary.secrets.slot1 },
            ...(primary.secrets.slot2 ?? secondary.secrets.slot2) === undefined
                ? {}
                : { slot2: primary.secrets.slot2 ?? secondary.secrets.slot2 },
        },
        metadata: {
            slot1Verified: primary.metadata.slot1Verified || secondary.metadata.slot1Verified,
            slot2Verified: primary.metadata.slot2Verified || secondary.metadata.slot2Verified,
        },
        persisted: {
            ...primary.persisted,
            tier: primary.persisted.tier ?? secondary.persisted.tier,
            tier2: primary.persisted.tier2 ?? secondary.persisted.tier2,
        },
    }
}

function hasLegacySecrets(secrets: LegacyAuthSecrets): boolean {
    return secrets.slot1 !== undefined || secrets.slot2 !== undefined
}

function markerIsComplete(raw: string | null): boolean {
    if (raw === null) return false
    try {
        const marker = JSON.parse(raw) as unknown
        return isRecord(marker)
            && marker.version === AUTH_MIGRATION_MARKER_VERSION
            && marker.authVersion === AUTH_STATE_VERSION
    } catch {
        return false
    }
}

function containsForbiddenPersistedField(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(containsForbiddenPersistedField)
    if (!isRecord(value)) return false
    return Object.entries(value).some(([key, child]) => (
        FORBIDDEN_PERSISTED_FIELDS.has(key) || containsForbiddenPersistedField(child)
    ))
}

export function authPayloadContainsRawSecret(value: unknown): boolean {
    if (typeof value === 'string') {
        try {
            return authPayloadContainsRawSecret(JSON.parse(value) as unknown)
        } catch {
            return false
        }
    }
    if (!isRecord(value)) return false
    const state = isRecord(value.state) ? value.state : value
    return legacySecret(state.token) !== undefined || legacySecret(state.token2) !== undefined
}

export function serializeAuthStateV3(state: AuthStateV3Persisted): string {
    const serialized = JSON.stringify({
        state: {
            slot1CredentialRef: state.slot1CredentialRef,
            slot2CredentialRef: state.slot2CredentialRef,
            slot1Enabled: state.slot1Enabled,
            slot2Enabled: state.slot2Enabled,
            tier: state.tier,
            tier2: state.tier2,
        },
        version: AUTH_STATE_VERSION,
    })
    const parsed = JSON.parse(serialized) as unknown
    if (containsForbiddenPersistedField(parsed)) {
        throw new Error('AuthState v3 serialization contained a runtime-only field.')
    }
    return serialized
}

export function parseAuthStateV3(raw: string): AuthStateV3Persisted {
    const parsed = parseV3State(parseAuthPayload(raw))
    if (parsed === null || authPayloadContainsRawSecret(raw)) {
        throw new Error('Persisted authentication state is not a secret-free AuthState v3 payload.')
    }
    return parsed
}

export async function inspectAuthPersistence(
    storage: AuthMigrationStorage,
): Promise<AuthPersistenceInspection> {
    const [indexedRaw, markerRaw] = await Promise.all([
        storage.getStrict(AUTH_STORE_KEY),
        storage.getStrict(AUTH_MIGRATION_MARKER_KEY),
    ])
    const localRaw = storage.getLegacyLocalAuth()
    const indexedPayload = parseAuthPayload(indexedRaw)
    const localPayload = parseAuthPayload(localRaw)
    const indexedV3 = parseV3State(indexedPayload)
    const localV3 = parseV3State(localPayload)
    const legacy = mergeLegacyProjection(
        legacyProjection(indexedPayload),
        legacyProjection(localPayload),
    )
    const persisted = indexedV3 ?? localV3 ?? legacy.persisted
    const rawSecretDetected = hasLegacySecrets(legacy.secrets)
    const completed = markerIsComplete(markerRaw)
    const hasRefs = persisted.slot1CredentialRef !== null || persisted.slot2CredentialRef !== null

    return {
        status: rawSecretDetected
            ? 'legacy-pending'
            : completed
                ? 'complete'
                : hasRefs
                    ? 'v3-verification-pending'
                    : 'empty',
        persisted,
        legacySecrets: legacy.secrets,
        legacyMetadata: legacy.metadata,
        indexedRaw,
        localRaw,
        markerRaw,
    }
}

function exactCredentialReadback(secret: string, readback: string | null): void {
    if (readback === null || readback !== secret) {
        throw new Error('Credential vault readback verification failed.')
    }
}

async function writeAndVerifyAuthV3(
    storage: AuthMigrationStorage,
    persisted: AuthStateV3Persisted,
): Promise<void> {
    const serialized = serializeAuthStateV3(persisted)
    await storage.setStrict(AUTH_STORE_KEY, serialized)
    const indexedReadback = await storage.getStrict(AUTH_STORE_KEY)
    if (indexedReadback !== serialized) throw new Error('AuthState v3 strict readback did not match.')
    parseAuthStateV3(indexedReadback)

    if (storage.getLegacyLocalAuth() !== null) {
        storage.setLegacyLocalAuth(serialized)
        const localReadback = storage.getLegacyLocalAuth()
        if (localReadback !== serialized) throw new Error('AuthState v3 local readback did not match.')
        parseAuthStateV3(localReadback)
    }
}

async function writeAndVerifyMigrationMarker(
    storage: AuthMigrationStorage,
    completedAt: string,
): Promise<void> {
    const marker = JSON.stringify({
        version: AUTH_MIGRATION_MARKER_VERSION,
        authVersion: AUTH_STATE_VERSION,
        completedAt,
    })
    await storage.setStrict(AUTH_MIGRATION_MARKER_KEY, marker)
    const readback = await storage.getStrict(AUTH_MIGRATION_MARKER_KEY)
    if (readback !== marker || !markerIsComplete(readback)) {
        throw new Error('Credential migration marker readback did not match.')
    }
}

function isoNow(now?: () => Date): string {
    return (now?.() ?? new Date()).toISOString()
}

export async function completeLegacyAuthMigration(options: {
    storage: AuthMigrationStorage
    vault: CredentialVault
    inspection: AuthPersistenceInspection
    now?: () => Date
}): Promise<AuthMigrationResult> {
    const { storage, vault, inspection } = options
    if (inspection.status !== 'legacy-pending' || !hasLegacySecrets(inspection.legacySecrets)) {
        throw new Error('No legacy credential migration is pending.')
    }
    if (!vault.isUnlocked()) throw new Error('Credential vault must be unlocked before migration.')

    const completedAt = isoNow(options.now)
    let slot1CredentialRef = inspection.persisted.slot1CredentialRef
    let slot2CredentialRef = inspection.persisted.slot2CredentialRef

    if (inspection.legacySecrets.slot1 !== undefined) {
        slot1CredentialRef = await vault.set('novelai-token', inspection.legacySecrets.slot1, {
            id: 'novelai-slot-1',
            existingRef: slot1CredentialRef,
            ...(inspection.legacyMetadata.slot1Verified ? { verifiedAt: completedAt } : {}),
        })
        exactCredentialReadback(
            inspection.legacySecrets.slot1,
            await vault.get(slot1CredentialRef),
        )
    }
    if (inspection.legacySecrets.slot2 !== undefined) {
        slot2CredentialRef = await vault.set('novelai-token', inspection.legacySecrets.slot2, {
            id: 'novelai-slot-2',
            existingRef: slot2CredentialRef,
            ...(inspection.legacyMetadata.slot2Verified ? { verifiedAt: completedAt } : {}),
        })
        exactCredentialReadback(
            inspection.legacySecrets.slot2,
            await vault.get(slot2CredentialRef),
        )
    }

    const persisted: AuthStateV3Persisted = {
        ...inspection.persisted,
        slot1CredentialRef,
        slot2CredentialRef,
    }
    await writeAndVerifyAuthV3(storage, persisted)
    await writeAndVerifyMigrationMarker(storage, completedAt)
    return { persisted, sessionSecrets: { ...inspection.legacySecrets } }
}

export async function resumeInterruptedAuthMigration(options: {
    storage: AuthMigrationStorage
    vault: CredentialVault
    inspection: AuthPersistenceInspection
    now?: () => Date
}): Promise<AuthMigrationResult> {
    const { storage, vault, inspection } = options
    if (inspection.status !== 'v3-verification-pending') {
        throw new Error('No interrupted AuthState v3 migration is pending.')
    }
    if (!vault.isUnlocked()) throw new Error('Credential vault must be unlocked before verification.')

    const sessionSecrets: LegacyAuthSecrets = {}
    for (const [slot, ref] of [
        ['slot1', inspection.persisted.slot1CredentialRef],
        ['slot2', inspection.persisted.slot2CredentialRef],
    ] as const) {
        if (ref === null) continue
        const secret = await vault.get(ref)
        if (secret === null || secret.slice(-4) !== ref.lastFour) {
            throw new Error('Credential vault reference verification failed.')
        }
        sessionSecrets[slot] = secret
    }

    await writeAndVerifyAuthV3(storage, inspection.persisted)
    await writeAndVerifyMigrationMarker(storage, isoNow(options.now))
    return { persisted: inspection.persisted, sessionSecrets }
}

export async function initializeEmptyAuthStateV3(
    storage: AuthMigrationStorage,
    now?: () => Date,
): Promise<AuthStateV3Persisted> {
    const persisted = emptyPersistedState()
    await writeAndVerifyAuthV3(storage, persisted)
    await writeAndVerifyMigrationMarker(storage, isoNow(now))
    return persisted
}

export async function persistAuthStateV3(
    storage: AuthMigrationStorage,
    persisted: AuthStateV3Persisted,
): Promise<void> {
    await writeAndVerifyAuthV3(storage, persisted)
}
