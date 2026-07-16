import type { CredentialVault } from '@/domain/credentials/types'

export interface NativeLanAgentStartInput {
    readonly bindIp: string
    readonly port: number
    readonly allowCidrs: readonly string[]
    /** Decrypted only from an unlocked Stronghold and retained by native until stop. */
    readonly deviceIdentity: string | null
}

export interface NativeLanAgentStartResult {
    readonly listening: boolean
    readonly bindIp: string
    readonly port: number
    readonly syncScopeId: string
    readonly deviceId: string
    /** Returned once during bootstrap; callers must persist it before reporting success. */
    readonly generatedDeviceIdentity: string | null
}

export interface LanPairedDevice {
    readonly certificateFingerprint: string
    readonly clientRef: string
    readonly deviceId: string
    readonly deviceName: string
    readonly active: boolean
    readonly revoked: boolean
}

export interface NativeLanAgentAdapter {
    start(input: NativeLanAgentStartInput): Promise<NativeLanAgentStartResult>
    stop(): Promise<void>
    listPairedDevices(): Promise<readonly LanPairedDevice[]>
    /** Host-local administrative revoke is keyed by the admitted client certificate fingerprint. */
    revokeDevice(certificateFingerprint: string): Promise<void>
}

export type LanAgentStatus = Omit<NativeLanAgentStartResult, 'generatedDeviceIdentity'>

function assertBindInput(input: {
    readonly bindIp: string
    readonly port: number
    readonly allowCidrs: readonly string[]
}): void {
    if (input.bindIp.length === 0 || input.bindIp.length > 64 || /[\0\r\n]/.test(input.bindIp)) {
        throw new TypeError('bindIp is invalid.')
    }
    if (!Number.isSafeInteger(input.port) || input.port < 1024 || input.port > 65_535) {
        throw new TypeError('port must be an unprivileged TCP port.')
    }
    if (input.allowCidrs.length === 0 || input.allowCidrs.length > 16
        || input.allowCidrs.some(cidr => cidr.length === 0 || cidr.length > 64 || /[\0\r\n]/.test(cidr))) {
        throw new TypeError('allowCidrs must contain bounded explicit network ranges.')
    }
}

function assertRuntimeIdentifier(value: string, field: string): void {
    if (!/^[a-z0-9:_-]{4,512}$/i.test(value)) throw new TypeError(`Native ${field} is invalid.`)
}

function validateStartResult(
    result: NativeLanAgentStartResult,
    input: NativeLanAgentStartInput,
): NativeLanAgentStartResult {
    if (result.listening !== true || result.bindIp !== input.bindIp || result.port !== input.port) {
        throw new TypeError('Native LAN listener status is inconsistent with the explicit bind request.')
    }
    assertRuntimeIdentifier(result.syncScopeId, 'syncScopeId')
    assertRuntimeIdentifier(result.deviceId, 'deviceId')
    if (result.generatedDeviceIdentity !== null
        && (result.generatedDeviceIdentity.length < 4 || result.generatedDeviceIdentity.length > 262_144)) {
        throw new TypeError('Native LAN device identity bundle is invalid.')
    }
    if (input.deviceIdentity !== null && result.generatedDeviceIdentity !== null) {
        throw new TypeError('Native LAN listener unexpectedly replaced an existing device identity.')
    }
    return result
}

/**
 * Explicit-listen gate joining Stronghold to the native TLS listener. Native
 * generates certificates, while this service makes Stronghold the only durable
 * secret authority and returns only non-secret runtime status to the UI.
 */
export class LanAgentService {
    constructor(
        private readonly vault: CredentialVault,
        private readonly native: NativeLanAgentAdapter,
    ) {}

    async start(input: {
        readonly bindIp: string
        readonly port: number
        readonly allowCidrs: readonly string[]
    }): Promise<LanAgentStatus> {
        assertBindInput(input)
        if (!this.vault.isUnlocked()) throw new Error('Credential Vault must be unlocked before LAN sync starts.')
        const existingRef = (await this.vault.listMetadata())
            .find(ref => ref.kind === 'sync-device-identity') ?? null
        const deviceIdentity = existingRef === null ? null : await this.vault.get(existingRef)
        if (existingRef !== null && deviceIdentity === null) {
            throw new Error('The LAN sync device identity is missing from Credential Vault.')
        }
        const nativeInput = { ...input, deviceIdentity }
        let result: NativeLanAgentStartResult
        try {
            result = validateStartResult(await this.native.start(nativeInput), nativeInput)
        } catch (error) {
            await this.native.stop().catch(() => undefined)
            throw error
        }
        if (result.generatedDeviceIdentity !== null) {
            try {
                const ref = await this.vault.set('sync-device-identity', result.generatedDeviceIdentity, {
                    id: 'sync-device-identity',
                    existingRef,
                })
                if (await this.vault.get(ref) !== result.generatedDeviceIdentity) {
                    throw new Error('Credential Vault did not verify the generated LAN sync identity.')
                }
            } catch (error) {
                await this.native.stop().catch(() => undefined)
                throw error
            }
        }
        return {
            listening: result.listening,
            bindIp: result.bindIp,
            port: result.port,
            syncScopeId: result.syncScopeId,
            deviceId: result.deviceId,
        }
    }

    async stop(): Promise<void> {
        await this.native.stop()
    }

    async listPairedDevices(): Promise<readonly LanPairedDevice[]> {
        return this.native.listPairedDevices()
    }

    async revokeDevice(certificateFingerprint: string): Promise<void> {
        if (!/^sha256:[a-f0-9]{64}$/i.test(certificateFingerprint)) {
            throw new TypeError('certificateFingerprint is invalid.')
        }
        await this.native.revokeDevice(certificateFingerprint)
    }
}
