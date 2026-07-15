import { invoke, isTauri } from '@tauri-apps/api/core'

import {
    SYNC_TRANSPORT_MAX_JSON_BYTES,
    SYNC_TRANSPORT_MAX_OPERATIONS,
    SYNC_TRANSPORT_PROTOCOL_VERSION,
    SyncTransportError,
    assertSyncTransportBatch,
    validateSyncTransportCheckpoint,
    type SyncEnvelope,
    type SyncTransport,
    type SyncTransportManifest,
    type SyncTransportPullResult,
    type SyncTransportPushReceipt,
    type SyncTransportRequestOptions,
} from '@/domain/sync'
import type {
    NativeLanAgentAdapter,
    NativeLanAgentStartInput,
    NativeLanAgentStartResult,
    LanPairedDevice,
} from './lan-agent-service'
import type {
    NativePairingAdapter,
    PairingInvitation,
} from './pairing-service'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_SECRET_BUNDLE_BYTES = 262_144
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/i
const SCOPE_PATTERN = /^lan:[a-f0-9]{64}$/i
const CLIENT_REF_PATTERN = /^[a-f0-9-]{36}$/i
const REQUEST_ID_PATTERN = /^[a-z0-9:_-]{4,160}$/i
const BASE64_PATTERN = /^[a-z0-9+/]+={0,2}$/i

export interface NativeSyncBindings {
    isTauri(): boolean
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

const TAURI_BINDINGS: NativeSyncBindings = {
    isTauri,
    invoke: (command, args) => invoke(command, args),
}

interface NativeDeviceIdentityBundle {
    readonly caPrivateKeyPkcs8Base64: string
    readonly caCertificateDerBase64: string
    readonly syncScopeId: string
    readonly deviceId: string
    readonly deviceName: string
}

interface NativeClientCredentialBundle {
    readonly clientPrivateKeyPkcs8Base64: string
    readonly clientCertificateDerBase64: string
    readonly caCertificateDerBase64: string
    readonly syncEndpoint: string
    readonly syncScopeId: string
    readonly peerFingerprint: string
}

interface NativePairingInvitation {
    readonly pairingEndpoint: string
    readonly syncEndpoint: string
    readonly capability: string
    readonly confirmationCode: string
    readonly caCertificateBase64: string
    readonly expiresAt: number
    readonly syncScopeId: string
}

type StoredNativePairingInvitation = Omit<NativePairingInvitation, 'confirmationCode'>

interface NativeExchangeResult {
    readonly sequence: number
    readonly response: unknown
}

export interface NativeInboundSyncItem {
    readonly requestId: string
    readonly peerFingerprint: string
    readonly sequence: number
    readonly nonce: string
    readonly payload: readonly SyncEnvelope[]
}

export interface NativeOutboundSyncReceipt {
    readonly peerFingerprint: string
    readonly deliveryId: string
    readonly opIds: readonly string[]
    readonly sequence: number
}

function protocolError(message: string): never {
    throw new SyncTransportError('E_SYNC_PROTOCOL_INVALID', message, false)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        protocolError(`${label} must be an object.`)
    }
    return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
    const actual = Object.keys(record)
    if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
        protocolError(`${label} contains an unknown or missing field.`)
    }
}

function boundedString(value: unknown, label: string, maximum: number): string {
    if (typeof value !== 'string'
        || value.trim().length === 0
        || value.length > maximum
        || /[\0\r\n]/.test(value)) {
        protocolError(`${label} is invalid.`)
    }
    return value
}

function base64(value: unknown, label: string, maximum = MAX_SECRET_BUNDLE_BYTES): string {
    const encoded = boundedString(value, label, maximum)
    if (encoded.length < 4 || encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
        protocolError(`${label} is not bounded base64.`)
    }
    return encoded
}

function syncScope(value: unknown, label = 'syncScopeId'): string {
    const scope = boundedString(value, label, 80)
    if (!SCOPE_PATTERN.test(scope)) protocolError(`${label} is invalid.`)
    return scope.toLowerCase()
}

function fingerprint(value: unknown, label = 'peerFingerprint'): string {
    const selected = boundedString(value, label, 80)
    if (!FINGERPRINT_PATTERN.test(selected)) protocolError(`${label} is invalid.`)
    return selected.toLowerCase()
}

function requestId(value: unknown): string {
    const selected = boundedString(value, 'requestId', 160)
    if (!REQUEST_ID_PATTERN.test(selected)) protocolError('requestId is invalid.')
    return selected
}

function timeoutMs(value: number | undefined): number {
    const selected = value ?? DEFAULT_TIMEOUT_MS
    if (!Number.isSafeInteger(selected) || selected < 1_000 || selected > 120_000) {
        throw new TypeError('Sync timeout must be between 1 and 120 seconds.')
    }
    return selected
}

function safeJsonParse(value: string, label: string): unknown {
    if (value.length < 4 || value.length > MAX_SECRET_BUNDLE_BYTES) protocolError(`${label} is invalid.`)
    try {
        return JSON.parse(value) as unknown
    } catch {
        protocolError(`${label} is invalid.`)
    }
}

function localHttpsEndpoint(value: unknown, label: string): string {
    const selected = boundedString(value, label, 256)
    let url: URL
    try {
        url = new URL(selected)
    } catch {
        protocolError(`${label} is invalid.`)
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const octets = host.split('.').map(part => /^\d{1,3}$/.test(part) ? Number(part) : -1)
    const validIpv4 = octets.length === 4 && octets.every(octet => octet >= 0 && octet <= 255)
    const localIpv4 = validIpv4 && (
        octets[0] === 127
        || octets[0] === 10
        || (octets[0] === 172 && Number(octets[1]) >= 16 && Number(octets[1]) <= 31)
        || (octets[0] === 192 && octets[1] === 168)
        || (octets[0] === 169 && octets[1] === 254)
    )
    const localIpv6 = host === '::1'
        || /^f[cd][a-f0-9]*:/i.test(host)
        || /^fe[89ab][a-f0-9]*:/i.test(host)
    if (url.protocol !== 'https:'
        || (!localIpv4 && !localIpv6)
        || url.port.length === 0
        || url.username.length > 0
        || url.password.length > 0
        || url.pathname !== '/'
        || url.search.length > 0
        || url.hash.length > 0) {
        protocolError(`${label} must be an explicit local HTTPS endpoint.`)
    }
    return selected
}

function validateDeviceIdentity(value: unknown): NativeDeviceIdentityBundle {
    const record = asRecord(value, 'Native device identity')
    assertExactKeys(record, [
        'caPrivateKeyPkcs8Base64',
        'caCertificateDerBase64',
        'syncScopeId',
        'deviceId',
        'deviceName',
    ], 'Native device identity')
    return {
        caPrivateKeyPkcs8Base64: base64(record.caPrivateKeyPkcs8Base64, 'device identity private key', 64 * 1024),
        caCertificateDerBase64: base64(record.caCertificateDerBase64, 'device identity certificate'),
        syncScopeId: syncScope(record.syncScopeId),
        deviceId: boundedString(record.deviceId, 'device identity deviceId', 512),
        deviceName: boundedString(record.deviceName, 'device identity deviceName', 96),
    }
}

function validateClientBundle(value: unknown): NativeClientCredentialBundle {
    const record = asRecord(value, 'Native client credential bundle')
    assertExactKeys(record, [
        'clientPrivateKeyPkcs8Base64',
        'clientCertificateDerBase64',
        'caCertificateDerBase64',
        'syncEndpoint',
        'syncScopeId',
        'peerFingerprint',
    ], 'Native client credential bundle')
    return {
        clientPrivateKeyPkcs8Base64: base64(record.clientPrivateKeyPkcs8Base64, 'client private key', 64 * 1024),
        clientCertificateDerBase64: base64(record.clientCertificateDerBase64, 'client certificate'),
        caCertificateDerBase64: base64(record.caCertificateDerBase64, 'client CA certificate'),
        syncEndpoint: localHttpsEndpoint(record.syncEndpoint, 'client syncEndpoint'),
        syncScopeId: syncScope(record.syncScopeId),
        peerFingerprint: fingerprint(record.peerFingerprint),
    }
}

function validateInvitation(value: unknown): NativePairingInvitation {
    const record = asRecord(value, 'Native pairing invitation')
    assertExactKeys(record, [
        'pairingEndpoint',
        'syncEndpoint',
        'capability',
        'confirmationCode',
        'caCertificateBase64',
        'expiresAt',
        'syncScopeId',
    ], 'Native pairing invitation')
    if (!Number.isSafeInteger(record.expiresAt) || Number(record.expiresAt) <= 0) {
        protocolError('Native pairing expiry is invalid.')
    }
    const confirmationCode = boundedString(record.confirmationCode, 'confirmationCode', 6)
    if (!/^\d{6}$/.test(confirmationCode)) protocolError('Native pairing confirmation code is invalid.')
    return {
        pairingEndpoint: localHttpsEndpoint(record.pairingEndpoint, 'pairingEndpoint'),
        syncEndpoint: localHttpsEndpoint(record.syncEndpoint, 'syncEndpoint'),
        capability: boundedString(record.capability, 'pairing capability', 512),
        confirmationCode,
        caCertificateBase64: base64(record.caCertificateBase64, 'pairing CA certificate'),
        expiresAt: Number(record.expiresAt),
        syncScopeId: syncScope(record.syncScopeId),
    }
}

function validateStoredInvitation(value: unknown): StoredNativePairingInvitation {
    const record = asRecord(value, 'Stored pairing invitation')
    assertExactKeys(record, [
        'pairingEndpoint',
        'syncEndpoint',
        'capability',
        'caCertificateBase64',
        'expiresAt',
        'syncScopeId',
    ], 'Stored pairing invitation')
    if (!Number.isSafeInteger(record.expiresAt) || Number(record.expiresAt) <= 0) {
        protocolError('Stored pairing expiry is invalid.')
    }
    return {
        pairingEndpoint: localHttpsEndpoint(record.pairingEndpoint, 'pairingEndpoint'),
        syncEndpoint: localHttpsEndpoint(record.syncEndpoint, 'syncEndpoint'),
        capability: boundedString(record.capability, 'pairing capability', 512),
        caCertificateBase64: base64(record.caCertificateBase64, 'pairing CA certificate'),
        expiresAt: Number(record.expiresAt),
        syncScopeId: syncScope(record.syncScopeId),
    }
}

function validateExchangeResult(value: unknown): NativeExchangeResult {
    const record = asRecord(value, 'Native exchange result')
    assertExactKeys(record, ['sequence', 'response'], 'Native exchange result')
    if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 1) {
        protocolError('Native exchange sequence is invalid.')
    }
    return { sequence: Number(record.sequence), response: record.response }
}

/** Validates the durable native queue item before any Phase 11 write occurs. */
export function validateNativeInboundSyncItem(value: unknown): NativeInboundSyncItem {
    const record = asRecord(value, 'Native inbound item')
    assertExactKeys(record, [
        'requestId', 'peerFingerprint', 'sequence', 'nonce', 'payload',
    ], 'Native inbound item')
    if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 1) {
        protocolError('Native inbound sequence is invalid.')
    }
    const nonce = boundedString(record.nonce, 'inbound nonce', 128)
    if (nonce.length < 16 || !/^[a-z0-9_-]+$/i.test(nonce)) {
        protocolError('Native inbound nonce is invalid.')
    }
    return {
        requestId: requestId(record.requestId),
        peerFingerprint: fingerprint(record.peerFingerprint),
        sequence: Number(record.sequence),
        nonce,
        payload: assertSyncTransportBatch(record.payload),
    }
}

function validateNativeOutboundReceipt(value: unknown): NativeOutboundSyncReceipt {
    const record = asRecord(value, 'Native outbound receipt')
    assertExactKeys(record, ['peerFingerprint', 'deliveryId', 'opIds', 'sequence'], 'Native outbound receipt')
    if (!Array.isArray(record.opIds)
        || record.opIds.length < 1
        || record.opIds.length > SYNC_TRANSPORT_MAX_OPERATIONS
        || record.opIds.some(opId => typeof opId !== 'string' || opId.length === 0 || opId.length > 512)
        || new Set(record.opIds).size !== record.opIds.length) {
        protocolError('Native outbound receipt operation identities are invalid.')
    }
    if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 1) {
        protocolError('Native outbound receipt sequence is invalid.')
    }
    return {
        peerFingerprint: fingerprint(record.peerFingerprint),
        deliveryId: boundedString(record.deliveryId, 'deliveryId', 512),
        opIds: [...record.opIds] as string[],
        sequence: Number(record.sequence),
    }
}

function safeNativeFailure(error: unknown): SyncTransportError {
    if (error instanceof SyncTransportError) return error
    const code = error !== null && typeof error === 'object'
        ? (error as { code?: unknown }).code
        : null
    switch (code) {
        case 'E_SYNC_NOT_PAIRED':
        case 'E_SYNC_PEER_UNKNOWN':
            return new SyncTransportError('E_SYNC_UNPAIRED', 'The paired LAN device is unavailable.', false)
        case 'E_SYNC_REVOKED':
            return new SyncTransportError('E_SYNC_REVOKED', 'The paired LAN device was revoked.', false)
        case 'E_SYNC_PAIRING_DENIED':
            return new SyncTransportError('E_SYNC_PAIRING_EXPIRED', 'The short-lived pairing session is unavailable.', false)
        case 'E_SYNC_REPLAY':
        case 'E_SYNC_REPLAY_OR_CHECKPOINT':
        case 'E_SYNC_ACK_ORDER':
        case 'E_SYNC_INBOUND_ACK_ORDER':
        case 'E_SYNC_RECEIPT_ACK_ORDER':
            return new SyncTransportError('E_SYNC_REPLAY', 'The LAN replay or checkpoint guard rejected the request.', false)
        case 'E_SYNC_CANCELLED':
            return new SyncTransportError('E_SYNC_CANCELLED', 'The LAN sync request was cancelled.', true)
        case 'E_SYNC_CERTIFICATE':
        case 'E_SYNC_TLS':
            return new SyncTransportError('E_SYNC_TAMPERED', 'The authenticated LAN channel could not be verified.', false)
        case 'E_SYNC_PAYLOAD_REJECTED':
        case 'E_SYNC_ENDPOINT':
        case 'E_SYNC_ORIGIN':
        case 'E_SYNC_DELIVERY_COLLISION':
        case 'E_SYNC_SCOPE_MISMATCH':
            return new SyncTransportError('E_SYNC_PROTOCOL_INVALID', 'The native LAN boundary rejected the request.', false)
        default:
            return new SyncTransportError('E_SYNC_TRANSPORT', 'The native LAN sync operation did not complete.', true)
    }
}

async function callNative<T>(
    bindings: NativeSyncBindings,
    command: string,
    args?: Record<string, unknown>,
): Promise<T> {
    if (!bindings.isTauri()) {
        throw new SyncTransportError('E_SYNC_TRANSPORT', 'Secure LAN sync requires the desktop Tauri runtime.', false)
    }
    try {
        return await bindings.invoke<T>(command, args)
    } catch (error) {
        throw safeNativeFailure(error)
    }
}

function abortError(): SyncTransportError {
    return new SyncTransportError('E_SYNC_CANCELLED', 'The LAN sync request was cancelled.', true)
}

/**
 * Bridges explicit desktop listen/pairing commands to the two Stronghold-aware
 * services. Rust owns TLS, certificates, replay state, and durable queues; this
 * adapter validates every DTO and returns secret bundles only as opaque JSON
 * for immediate vault persistence.
 */
export class NativeLanControlAdapter implements NativeLanAgentAdapter, NativePairingAdapter {
    constructor(
        private readonly deviceId: string,
        private readonly deviceName: string,
        private readonly bindings: NativeSyncBindings = TAURI_BINDINGS,
    ) {
        boundedString(deviceId, 'deviceId', 512)
        boundedString(deviceName, 'deviceName', 96)
    }

    async start(input: NativeLanAgentStartInput): Promise<NativeLanAgentStartResult> {
        const identity = input.deviceIdentity === null
            ? undefined
            : validateDeviceIdentity(safeJsonParse(input.deviceIdentity, 'Stored device identity'))
        if (identity !== undefined
            && (identity.deviceId !== this.deviceId || identity.deviceName !== this.deviceName)) {
            protocolError('Stored device identity does not match the local device.')
        }
        const raw = await callNative<unknown>(this.bindings, 'sync_transport_start', {
            request: {
                bindIp: input.bindIp,
                port: input.port,
                allowCidrs: [...input.allowCidrs],
                deviceId: this.deviceId,
                deviceName: this.deviceName,
                ...(identity === undefined ? {} : { deviceIdentity: identity }),
            },
        })
        const result = asRecord(raw, 'Native listener start result')
        assertExactKeys(result, [
            'endpoint', 'syncScopeId', 'deviceId', 'deviceName', 'generatedDeviceIdentity',
        ], 'Native listener start result')
        const endpoint = localHttpsEndpoint(result.endpoint, 'listener endpoint')
        const url = new URL(endpoint)
        const returnedHost = url.hostname.replace(/^\[|\]$/g, '')
        if (returnedHost !== input.bindIp
            || Number(url.port) !== input.port
            || result.deviceId !== this.deviceId
            || result.deviceName !== this.deviceName) {
            protocolError('Native listener result does not match the explicit start request.')
        }
        const generated = result.generatedDeviceIdentity === null
            ? null
            : validateDeviceIdentity(result.generatedDeviceIdentity)
        const returnedScope = syncScope(result.syncScopeId)
        if ((generated !== null && generated.syncScopeId !== returnedScope)
            || (identity !== undefined && identity.syncScopeId !== returnedScope)) {
            protocolError('Native listener identity scope is inconsistent.')
        }
        return {
            listening: true,
            bindIp: returnedHost,
            port: Number(url.port),
            syncScopeId: returnedScope,
            deviceId: this.deviceId,
            generatedDeviceIdentity: generated === null ? null : JSON.stringify(generated),
        }
    }

    async stop(): Promise<void> {
        await callNative<void>(this.bindings, 'sync_transport_stop')
    }

    async revokeDevice(certificateFingerprint: string): Promise<void> {
        await callNative<void>(this.bindings, 'sync_transport_revoke_device', {
            request: { peerFingerprint: fingerprint(certificateFingerprint) },
        })
    }

    /**
     * Rebuilds host administration metadata from the native durable journal.
     * The listener endpoint and certificate material are validated but omitted,
     * leaving only the identities needed to select a host-local revoke target.
     */
    async listPairedDevices(): Promise<LanPairedDevice[]> {
        const raw = asRecord(
            await callNative<unknown>(this.bindings, 'sync_transport_status'),
            'Native listener status',
        )
        assertExactKeys(raw, [
            'running',
            'endpoint',
            'syncScopeId',
            'deviceId',
            'deviceName',
            'pairingOpen',
            'activePeerCount',
            'peers',
        ], 'Native listener status')
        if (typeof raw.running !== 'boolean'
            || typeof raw.pairingOpen !== 'boolean'
            || !Number.isSafeInteger(raw.activePeerCount)
            || Number(raw.activePeerCount) < 0
            || !Array.isArray(raw.peers)
            || raw.peers.length > 512) {
            protocolError('Native listener status is invalid.')
        }
        if (raw.running) {
            localHttpsEndpoint(raw.endpoint, 'listener status endpoint')
            syncScope(raw.syncScopeId)
            boundedString(raw.deviceId, 'listener status deviceId', 512)
            boundedString(raw.deviceName, 'listener status deviceName', 96)
        } else if (raw.endpoint !== null
            || raw.syncScopeId !== null
            || raw.deviceId !== null
            || raw.deviceName !== null
            || raw.pairingOpen
            || raw.activePeerCount !== 0
            || raw.peers.length !== 0) {
            protocolError('Stopped native listener status contains active metadata.')
        }
        const peers = raw.peers.map(value => {
            const peer = asRecord(value, 'Native peer summary')
            assertExactKeys(peer, [
                'fingerprint', 'clientRef', 'deviceId', 'deviceName', 'active', 'revoked',
            ], 'Native peer summary')
            if (typeof peer.active !== 'boolean'
                || typeof peer.revoked !== 'boolean'
                || peer.active === peer.revoked) {
                protocolError('Native peer status is inconsistent.')
            }
            const clientRef = boundedString(peer.clientRef, 'peer clientRef', 64)
            if (!CLIENT_REF_PATTERN.test(clientRef)) protocolError('Native peer clientRef is invalid.')
            return {
                certificateFingerprint: fingerprint(peer.fingerprint),
                clientRef,
                deviceId: boundedString(peer.deviceId, 'peer deviceId', 512),
                deviceName: boundedString(peer.deviceName, 'peer deviceName', 96),
                active: peer.active,
                revoked: peer.revoked,
            }
        })
        if (peers.filter(peer => peer.active).length !== raw.activePeerCount
            || Number(raw.activePeerCount) > 1) {
            protocolError('Native active peer count is inconsistent.')
        }
        return peers
    }

    async createInvitation(input: { readonly expiresInSeconds: number }): Promise<PairingInvitation> {
        const invitation = validateInvitation(await callNative<unknown>(
            this.bindings,
            'sync_transport_open_pairing',
            { request: { ttlSeconds: input.expiresInSeconds } },
        ))
        const now = Math.floor(Date.now() / 1_000)
        if (invitation.expiresAt <= now || invitation.expiresAt > now + input.expiresInSeconds + 5) {
            protocolError('Native pairing expiry does not match the requested short lifetime.')
        }
        const {
            confirmationCode,
            ...storedInvitation
        } = invitation
        return {
            invitation: JSON.stringify(storedInvitation),
            confirmationCode,
            expiresAt: new Date(invitation.expiresAt * 1_000).toISOString(),
        }
    }

    async closePairing(): Promise<void> {
        await callNative<void>(this.bindings, 'sync_transport_close_pairing')
    }

    async acceptInvitation(input: {
        readonly invitation: string
        readonly confirmationCode: string
        readonly displayName: string
        readonly clientRef: string
        readonly signal?: AbortSignal
    }): Promise<{
        readonly peerId: string
        readonly displayName: string
        readonly credentialBundle: string
        readonly certificateFingerprint: string
    }> {
        const storedInvitation = validateStoredInvitation(safeJsonParse(input.invitation, 'Pairing invitation'))
        if (!/^\d{6}$/.test(input.confirmationCode) || !CLIENT_REF_PATTERN.test(input.clientRef)) {
            protocolError('Pairing confirmation or client identity is inconsistent.')
        }
        if (storedInvitation.expiresAt <= Math.floor(Date.now() / 1_000)) {
            throw new SyncTransportError('E_SYNC_PAIRING_EXPIRED', 'The short-lived pairing session is unavailable.', false)
        }
        const invitation: NativePairingInvitation = {
            ...storedInvitation,
            confirmationCode: input.confirmationCode,
        }
        const id = requestId(`pair:${input.clientRef}`)
        const raw = await this.runCancellable(id, input.signal, () => callNative<unknown>(
            this.bindings,
            'sync_transport_pair_client',
            {
                request: {
                    invitation,
                    clientRef: input.clientRef,
                    deviceId: this.deviceId,
                    deviceName: input.displayName,
                    requestId: id,
                    timeoutMs: DEFAULT_TIMEOUT_MS,
                },
            },
        ))
        const result = asRecord(raw, 'Native pairing result')
        assertExactKeys(result, ['peerFingerprint', 'syncScopeId', 'credentialBundle'], 'Native pairing result')
        const bundle = validateClientBundle(result.credentialBundle)
        const returnedFingerprint = fingerprint(result.peerFingerprint)
        const returnedScope = syncScope(result.syncScopeId)
        if (bundle.peerFingerprint !== returnedFingerprint
            || bundle.syncScopeId !== returnedScope
            || returnedScope !== invitation.syncScopeId
            || bundle.syncEndpoint !== invitation.syncEndpoint) {
            protocolError('Native pairing result does not match the invitation.')
        }
        return {
            peerId: returnedScope,
            displayName: input.displayName,
            credentialBundle: JSON.stringify(bundle),
            certificateFingerprint: returnedFingerprint,
        }
    }

    async revokeIssuedPeer(input: {
        readonly clientRef: string
        readonly credentialBundle: string
    }): Promise<void> {
        if (!CLIENT_REF_PATTERN.test(input.clientRef)) protocolError('clientRef is invalid.')
        const bundle = validateClientBundle(safeJsonParse(input.credentialBundle, 'Client credential bundle'))
        const id = requestId(`revoke:${crypto.randomUUID()}`)
        const result = validateExchangeResult(await callNative<unknown>(this.bindings, 'sync_transport_exchange', {
            request: {
                clientRef: input.clientRef,
                requestId: id,
                operation: 'revoke',
                credentialBundle: bundle,
                timeoutMs: DEFAULT_TIMEOUT_MS,
            },
        }))
        const response = asRecord(result.response, 'Native revoke response')
        assertExactKeys(response, ['revoked'], 'Native revoke response')
        if (response.revoked !== true) protocolError('Native revoke response was not affirmative.')
    }

    private async runCancellable<T>(
        id: string,
        signal: AbortSignal | undefined,
        operation: () => Promise<T>,
    ): Promise<T> {
        if (signal?.aborted === true) throw abortError()
        const cancel = () => {
            void callNative<boolean>(this.bindings, 'sync_transport_cancel_request', { requestId: id })
                .catch(() => undefined)
        }
        signal?.addEventListener('abort', cancel, { once: true })
        try {
            return await operation()
        } finally {
            signal?.removeEventListener('abort', cancel)
        }
    }
}

/**
 * Authenticated client transport. Stronghold supplies the decrypted bundle to
 * this short-lived instance; native code combines it with the durable sequence
 * journal, while the adapter projects strict Phase 12 manifest/pull/push DTOs.
 */
export class NativeLanSyncTransport implements SyncTransport {
    readonly kind = 'lan' as const
    readonly peerId: string
    private readonly credentialBundle: NativeClientCredentialBundle

    constructor(
        private readonly clientRef: string,
        credentialBundle: string,
        private readonly bindings: NativeSyncBindings = TAURI_BINDINGS,
    ) {
        if (!CLIENT_REF_PATTERN.test(clientRef)) protocolError('clientRef is invalid.')
        this.credentialBundle = validateClientBundle(safeJsonParse(credentialBundle, 'Client credential bundle'))
        this.peerId = this.credentialBundle.syncScopeId
    }

    async manifest(options?: SyncTransportRequestOptions): Promise<SyncTransportManifest> {
        const result = await this.exchange('manifest', options)
        const response = asRecord(result.response, 'Native manifest response')
        assertExactKeys(response, ['syncScopeId', 'outboundPending'], 'Native manifest response')
        if (syncScope(response.syncScopeId) !== this.peerId
            || !Number.isSafeInteger(response.outboundPending)
            || Number(response.outboundPending) < 0
            || Number(response.outboundPending) > 512) {
            protocolError('Native manifest response is inconsistent.')
        }
        return {
            protocolVersion: SYNC_TRANSPORT_PROTOCOL_VERSION,
            peerId: this.peerId,
            pendingOperations: Number(response.outboundPending),
            maxJsonBytes: SYNC_TRANSPORT_MAX_JSON_BYTES,
            maxOperations: SYNC_TRANSPORT_MAX_OPERATIONS,
            imageMode: 'r2-reference',
        }
    }

    async pull(input: SyncTransportRequestOptions & {
        readonly after: { readonly sequence: number; readonly cursor: string } | null
        readonly limit: number
    }): Promise<SyncTransportPullResult> {
        if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > SYNC_TRANSPORT_MAX_OPERATIONS) {
            throw new TypeError('Sync pull limit is invalid.')
        }
        const after = input.after === null ? null : validateSyncTransportCheckpoint(input.after)
        const result = await this.exchange('pull', input)
        const response = asRecord(result.response, 'Native pull response')
        assertExactKeys(response, ['deliveryId', 'payload', 'hasMore'], 'Native pull response')
        if (typeof response.hasMore !== 'boolean') protocolError('Native pull continuation marker is invalid.')
        if (response.deliveryId === null && response.payload === null) {
            if (response.hasMore) protocolError('Empty native pull response cannot have a continuation.')
            return {
                envelopes: [],
                checkpoint: { sequence: result.sequence, cursor: `idle:${result.sequence}` },
                hasMore: response.hasMore,
            }
        }
        const deliveryId = boundedString(response.deliveryId, 'deliveryId', 512)
        const envelopes = assertSyncTransportBatch(response.payload)
        if (envelopes.length > input.limit) protocolError('Native pull batch exceeded the requested limit.')
        if (after !== null && result.sequence < after.sequence) {
            protocolError('Native pull checkpoint regressed.')
        }
        return {
            envelopes,
            checkpoint: { sequence: result.sequence, cursor: deliveryId },
            hasMore: response.hasMore,
        }
    }

    async acknowledgePull(input: SyncTransportRequestOptions & {
        readonly opIds: readonly string[]
        readonly checkpoint: { readonly sequence: number; readonly cursor: string }
    }): Promise<void> {
        const checkpoint = validateSyncTransportCheckpoint(input.checkpoint)
        if (checkpoint.cursor.startsWith('idle:')) return
        if (new Set(input.opIds).size !== input.opIds.length
            || input.opIds.length > SYNC_TRANSPORT_MAX_OPERATIONS
            || input.opIds.some(id => typeof id !== 'string' || id.length === 0 || id.length > 512)) {
            protocolError('Pull acknowledgement operation identities are invalid.')
        }
        const result = await this.exchange('ack', input, undefined, checkpoint.cursor)
        const response = asRecord(result.response, 'Native acknowledgement response')
        assertExactKeys(response, ['acknowledged', 'duplicate', 'deliveryId'], 'Native acknowledgement response')
        if (response.acknowledged !== true
            || typeof response.duplicate !== 'boolean'
            || response.deliveryId !== checkpoint.cursor) {
            protocolError('Native pull acknowledgement is inconsistent.')
        }
    }

    async push(input: SyncTransportRequestOptions & {
        readonly envelopes: readonly SyncEnvelope[]
    }): Promise<SyncTransportPushReceipt> {
        const envelopes = assertSyncTransportBatch(input.envelopes)
        const selectedRequestId = this.selectedRequestId(input)
        const result = await this.exchange('push', { ...input, requestId: selectedRequestId }, envelopes)
        const response = asRecord(result.response, 'Native push response')
        assertExactKeys(response, ['accepted', 'duplicate', 'requestId'], 'Native push response')
        if (response.accepted !== true
            || typeof response.duplicate !== 'boolean'
            || response.requestId !== selectedRequestId) {
            protocolError('Native push response is inconsistent.')
        }
        return {
            acceptedOpIds: envelopes.map(envelope => envelope.opId),
            checkpoint: { sequence: result.sequence, cursor: `push:${result.sequence}` },
        }
    }

    async cancel(id: string): Promise<void> {
        requestId(id)
        await callNative<boolean>(this.bindings, 'sync_transport_cancel_request', { requestId: id })
    }

    private selectedRequestId(options: SyncTransportRequestOptions | undefined): string {
        return requestId(options?.requestId ?? `sync:${crypto.randomUUID()}`)
    }

    private async exchange(
        operation: 'manifest' | 'push' | 'pull' | 'ack',
        options: SyncTransportRequestOptions | undefined,
        payload?: unknown,
        deliveryId?: string,
    ): Promise<NativeExchangeResult> {
        const id = this.selectedRequestId(options)
        const timeout = timeoutMs(options?.timeoutMs)
        if (options?.signal?.aborted === true) throw abortError()
        const cancel = () => {
            void this.cancel(id).catch(() => undefined)
        }
        options?.signal?.addEventListener('abort', cancel, { once: true })
        try {
            return validateExchangeResult(await callNative<unknown>(this.bindings, 'sync_transport_exchange', {
                request: {
                    clientRef: this.clientRef,
                    requestId: id,
                    operation,
                    credentialBundle: this.credentialBundle,
                    ...(payload === undefined ? {} : { payload }),
                    ...(deliveryId === undefined ? {} : { deliveryId }),
                    timeoutMs: timeout,
                },
            }))
        } finally {
            options?.signal?.removeEventListener('abort', cancel)
        }
    }
}

/** Native queue calls are kept separate from client transport and expose no credentials. */
export class NativeLanQueueAdapter {
    constructor(private readonly bindings: NativeSyncBindings = TAURI_BINDINGS) {}

    async peekInbound(limit: number): Promise<NativeInboundSyncItem[]> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) {
            throw new TypeError('Native inbound peek limit must be between 1 and 128.')
        }
        const raw = await callNative<unknown>(this.bindings, 'sync_transport_peek_inbound', {
            request: { limit },
        })
        if (!Array.isArray(raw) || raw.length > limit) protocolError('Native inbound peek result is invalid.')
        return raw.map(validateNativeInboundSyncItem)
    }

    async acknowledgeInbound(id: string): Promise<void> {
        await callNative<void>(this.bindings, 'sync_transport_ack_inbound', {
            request: { requestId: requestId(id) },
        })
    }

    async enqueueOutbound(input: {
        readonly peerFingerprint: string
        readonly deliveryId: string
        readonly opIds: readonly string[]
        readonly payload: readonly SyncEnvelope[]
    }): Promise<void> {
        const deliveryId = boundedString(input.deliveryId, 'deliveryId', 512)
        const payload = assertSyncTransportBatch(input.payload)
        if (input.opIds.length < 1
            || input.opIds.length > SYNC_TRANSPORT_MAX_OPERATIONS
            || new Set(input.opIds).size !== input.opIds.length
            || input.opIds.some(opId => typeof opId !== 'string' || opId.length === 0 || opId.length > 512)
            || input.opIds.length !== payload.length
            || input.opIds.some((opId, index) => payload[index]?.opId !== opId)) {
            protocolError('Outbound operation identities do not match the sanitized batch.')
        }
        await callNative<void>(this.bindings, 'sync_transport_enqueue_outbound', {
            request: {
                peerFingerprint: fingerprint(input.peerFingerprint),
                deliveryId,
                opIds: [...input.opIds],
                payload,
            },
        })
    }

    async peekOutboundReceipts(limit: number): Promise<NativeOutboundSyncReceipt[]> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) {
            throw new TypeError('Native outbound receipt limit must be between 1 and 128.')
        }
        const raw = await callNative<unknown>(this.bindings, 'sync_transport_peek_outbound_receipts', {
            request: { limit },
        })
        if (!Array.isArray(raw) || raw.length > limit) protocolError('Native outbound receipt result is invalid.')
        return raw.map(validateNativeOutboundReceipt)
    }

    async acknowledgeOutboundReceipt(receipt: NativeOutboundSyncReceipt): Promise<void> {
        if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1) {
            protocolError('Outbound receipt sequence is invalid.')
        }
        await callNative<void>(this.bindings, 'sync_transport_ack_outbound_receipt', {
            request: {
                peerFingerprint: fingerprint(receipt.peerFingerprint),
                deliveryId: boundedString(receipt.deliveryId, 'deliveryId', 512),
                sequence: receipt.sequence,
            },
        })
    }
}
