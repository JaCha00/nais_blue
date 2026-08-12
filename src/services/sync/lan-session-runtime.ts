import { canonicalSerialize } from '@/domain/composition/canonical-serialize'
import type { JsonObject } from '@/domain/composition/types'
import type { SyncEntityRecord } from '@/domain/sync'
import { getRuntimePlatform, isAndroidRuntime, isDesktopRuntime } from '@/platform/runtime'
import { usePresetStore, normalizeLegacyPreset, type Preset } from '@/stores/preset-store'
import { LanSyncCoordinator } from './lan-sync-coordinator'
import {
    NativeLanControlAdapter,
    NativeLanQueueAdapter,
    NativeLanSyncTransport,
    detectNativeLanNetwork,
} from './native-lan-transport-adapter'
import { NativeLanEgressCoordinator } from './native-lan-egress-coordinator'
import { NativeLanIngressCoordinator } from './native-lan-ingress-coordinator'
import { IndexedDBSyncOutboxRepository } from './outbox-repository'
import { sanitizeSyncPayload } from './sanitizer'

const LOCAL_SYNC_USER_ID = 'nais-local-user'
const DEVICE_ID_KEY = 'nai-blue-lan-device-id'
const DEFAULT_PORT = 41_921
const HOST_POLL_MS = 750
const CLIENT_IDLE_DELAY_MS = 350
const CLIENT_MAX_PASSES = 24

export type LanSessionPhase =
    | 'idle'
    | 'starting-host'
    | 'awaiting-peer'
    | 'connecting'
    | 'connected'
    | 'syncing'
    | 'error'

export interface LanSessionSnapshot {
    readonly phase: LanSessionPhase
    readonly role: 'host' | 'client' | null
    readonly bindIp: string | null
    readonly allowCidr: string | null
    readonly port: number | null
    readonly invitation: string | null
    readonly confirmationCode: string | null
    readonly expiresAt: string | null
    readonly peerName: string | null
    readonly lastSyncAt: string | null
    readonly transferred: number
    readonly errorCode: string | null
}

const INITIAL_SNAPSHOT: LanSessionSnapshot = Object.freeze({
    phase: 'idle',
    role: null,
    bindIp: null,
    allowCidr: null,
    port: null,
    invitation: null,
    confirmationCode: null,
    expiresAt: null,
    peerName: null,
    lastSyncAt: null,
    transferred: 0,
    errorCode: null,
})

interface ClientSession {
    readonly clientRef: string
    readonly credentialBundle: string
    readonly peerId: string
    readonly displayName: string
}

function runtimeErrorCode(error: unknown): string {
    if (error !== null && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
        return String((error as { code: string }).code).slice(0, 96)
    }
    if (error instanceof TypeError) return 'E_SYNC_INPUT'
    return 'E_SYNC_SESSION'
}

function deviceId(): string {
    const existing = globalThis.localStorage?.getItem(DEVICE_ID_KEY)
        ?? globalThis.localStorage?.getItem('nais2-lan-device-id')
    if (existing && /^device:[a-f0-9-]{36}$/i.test(existing)) return existing
    const created = `device:${crypto.randomUUID()}`
    globalThis.localStorage?.setItem(DEVICE_ID_KEY, created)
    return created
}

function deviceName(): string {
    const platform = getRuntimePlatform()
    return platform === 'android' ? 'NAI Blue Android' : `NAI Blue ${platform}`
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => globalThis.setTimeout(resolve, milliseconds))
}

/**
 * Preset projection depends on the sanitizer's prompt allowlist and the local
 * preset order. Adding only `orderKey` makes the current store portable while
 * tokens, output paths, images, history, and unknown fields remain excluded.
 */
export function projectPresetForLanSync(preset: Preset, index: number): JsonObject {
    return sanitizeSyncPayload('prompt.preset', {
        ...preset,
        orderKey: String(index).padStart(8, '0'),
    })
}

/** Converts a previously sanitized prompt preset back into the local schema. */
export function presetFromLanSyncEntity(entity: SyncEntityRecord): Preset {
    if (entity.entityType !== 'prompt.preset' || entity.op !== 'upsert' || entity.payload === null) {
        throw new TypeError('Sync entity is not an active prompt preset.')
    }
    const normalized = normalizeLegacyPreset(entity.payload)
    if (normalized.id !== entity.entityId) throw new TypeError('Synced preset identity is inconsistent.')
    return normalized
}

/**
 * Process-scoped production caller for Phase 12 LAN primitives. Rust owns TLS,
 * certificates, replay state, and durable queues; this runtime owns explicit
 * user sessions and applies only sanitized prompt presets to Zustand.
 */
export class LanSessionRuntime {
    private snapshot: LanSessionSnapshot = INITIAL_SNAPSHOT
    private readonly listeners = new Set<() => void>()
    private readonly repository = new IndexedDBSyncOutboxRepository({ userId: LOCAL_SYNC_USER_ID })
    private readonly localDeviceId = deviceId()
    private readonly adapter = new NativeLanControlAdapter(this.localDeviceId, deviceName())
    private readonly nativeQueue = new NativeLanQueueAdapter()
    private hostIdentity: string | null = null
    private client: ClientSession | null = null
    private hostTimer: ReturnType<typeof setInterval> | null = null
    private hostTickActive = false

    readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    readonly getSnapshot = (): LanSessionSnapshot => this.snapshot

    private publish(patch: Partial<LanSessionSnapshot>): void {
        this.snapshot = Object.freeze({ ...this.snapshot, ...patch })
        this.listeners.forEach(listener => listener())
    }

    async startHost(input?: {
        readonly bindIp?: string
        readonly allowCidr?: string
        readonly port?: number
    }): Promise<void> {
        if (!isDesktopRuntime) throw new TypeError('LAN hosting requires the desktop app.')
        await this.stop()
        this.publish({ ...INITIAL_SNAPSHOT, phase: 'starting-host', role: 'host' })
        try {
            const detected = input?.bindIp && input.allowCidr
                ? { bindIp: input.bindIp, allowCidr: input.allowCidr }
                : await detectNativeLanNetwork()
            const port = input?.port ?? DEFAULT_PORT
            const started = await this.adapter.start({
                bindIp: detected.bindIp,
                port,
                allowCidrs: [detected.allowCidr],
                deviceIdentity: this.hostIdentity,
            })
            if (started.generatedDeviceIdentity !== null) this.hostIdentity = started.generatedDeviceIdentity
            await this.stageLocalPresets()
            const invitation = await this.adapter.createInvitation({ expiresInSeconds: 120 })
            this.publish({
                phase: 'awaiting-peer',
                role: 'host',
                bindIp: detected.bindIp,
                allowCidr: detected.allowCidr,
                port,
                invitation: invitation.invitation,
                confirmationCode: invitation.confirmationCode,
                expiresAt: invitation.expiresAt,
                errorCode: null,
            })
            this.startHostPolling()
            void this.hostTick()
        } catch (error) {
            await this.adapter.stop().catch(() => undefined)
            this.publish({ phase: 'error', errorCode: runtimeErrorCode(error) })
            throw error
        }
    }

    async refreshInvitation(): Promise<void> {
        if (this.snapshot.role !== 'host') throw new TypeError('LAN host is not running.')
        const invitation = await this.adapter.createInvitation({ expiresInSeconds: 120 })
        this.publish({
            phase: 'awaiting-peer',
            invitation: invitation.invitation,
            confirmationCode: invitation.confirmationCode,
            expiresAt: invitation.expiresAt,
            errorCode: null,
        })
    }

    async connectClient(input: {
        readonly invitation: string
        readonly confirmationCode: string
    }): Promise<void> {
        if (!isAndroidRuntime) throw new TypeError('This pairing flow requires the Android app.')
        await this.stop()
        this.publish({ ...INITIAL_SNAPSHOT, phase: 'connecting', role: 'client' })
        const clientRef = crypto.randomUUID()
        try {
            const accepted = await this.adapter.acceptInvitation({
                invitation: input.invitation.trim(),
                confirmationCode: input.confirmationCode.trim(),
                displayName: deviceName(),
                clientRef,
            })
            this.client = {
                clientRef,
                credentialBundle: accepted.credentialBundle,
                peerId: accepted.peerId,
                displayName: accepted.displayName,
            }
            this.publish({
                phase: 'connected',
                peerName: 'NAI Blue Desktop',
                errorCode: null,
            })
            // Give the host poller one turn to observe the admitted certificate
            // and stage its durable outbound deliveries before the first pull.
            await delay(HOST_POLL_MS)
            await this.synchronizeNow()
        } catch (error) {
            this.client = null
            this.publish({ phase: 'error', errorCode: runtimeErrorCode(error) })
            throw error
        }
    }

    async synchronizeNow(): Promise<void> {
        if (this.snapshot.role === 'host') {
            await this.hostTick(true)
            return
        }
        const client = this.client
        if (client === null) throw new TypeError('Pair with a desktop before syncing.')
        this.publish({ phase: 'syncing', errorCode: null })
        try {
            await this.stageLocalPresets()
            const coordinator = new LanSyncCoordinator(
                this.repository,
                new NativeLanSyncTransport(client.clientRef, client.credentialBundle),
            )
            let transferred = 0
            let idlePasses = 0
            for (let pass = 0; pass < CLIENT_MAX_PASSES; pass += 1) {
                const result = await coordinator.synchronizeOnce({ now: new Date().toISOString(), limit: 100 })
                transferred += result.pulled + result.pushed
                await this.applyPresetProjection()
                const pending = await this.repository.listOutbox()
                if (result.pulled === 0 && result.pushed === 0 && !result.moreInbound && pending.length === 0) {
                    idlePasses += 1
                    if (idlePasses >= 2) break
                } else {
                    idlePasses = 0
                }
                await delay(CLIENT_IDLE_DELAY_MS)
            }
            this.publish({
                phase: 'connected',
                lastSyncAt: new Date().toISOString(),
                transferred,
            })
        } catch (error) {
            this.publish({ phase: 'error', errorCode: runtimeErrorCode(error) })
            throw error
        }
    }

    async stop(): Promise<void> {
        if (this.hostTimer !== null) {
            clearInterval(this.hostTimer)
            this.hostTimer = null
        }
        if (this.snapshot.role === 'host') {
            await this.adapter.closePairing().catch(() => undefined)
            const peers = await this.adapter.listPairedDevices().catch(() => [])
            for (const peer of peers.filter(candidate => candidate.active)) {
                await this.adapter.revokeDevice(peer.certificateFingerprint).catch(() => undefined)
            }
            await this.adapter.stop().catch(() => undefined)
        }
        if (this.client !== null) {
            // The client key is process-scoped, so tell the host to revoke its
            // certificate before dropping the only usable copy. Network loss
            // remains recoverable from the desktop's explicit Stop action.
            await this.adapter.revokeIssuedPeer({
                clientRef: this.client.clientRef,
                credentialBundle: this.client.credentialBundle,
            }).catch(() => undefined)
        }
        this.client = null
        this.publish(INITIAL_SNAPSHOT)
    }

    private startHostPolling(): void {
        if (this.hostTimer !== null) clearInterval(this.hostTimer)
        this.hostTimer = setInterval(() => void this.hostTick(), HOST_POLL_MS)
    }

    private async hostTick(throwOnFailure = false): Promise<void> {
        if (this.snapshot.role !== 'host' || this.hostTickActive) return
        this.hostTickActive = true
        try {
            const peer = (await this.adapter.listPairedDevices()).find(candidate => candidate.active) ?? null
            if (peer === null) {
                if (this.snapshot.expiresAt !== null && Date.parse(this.snapshot.expiresAt) <= Date.now()) {
                    this.publish({ phase: 'awaiting-peer', invitation: null, confirmationCode: null })
                }
                return
            }
            await this.stageLocalPresets()
            const ingress = new NativeLanIngressCoordinator(this.repository, this.nativeQueue)
            const ingressResult = await ingress.processOnce({ receivedAt: new Date().toISOString(), limit: 128 })
            const applied = await this.applyPresetProjection()
            const egress = new NativeLanEgressCoordinator(
                this.repository,
                this.nativeQueue,
                peer.certificateFingerprint,
            )
            const receiptsApplied = await egress.applyRemoteReceipts({ ackedAt: new Date().toISOString(), limit: 128 })
            let enqueued = 0
            for (let index = 0; index < 100; index += 1) {
                const result = await egress.publishNext(new Date().toISOString())
                if (!result.enqueued) break
                enqueued += 1
            }
            this.publish({
                phase: 'connected',
                peerName: peer.deviceName,
                invitation: null,
                confirmationCode: null,
                errorCode: null,
                ...(ingressResult.envelopesApplied + applied + receiptsApplied + enqueued === 0 ? {} : {
                    lastSyncAt: new Date().toISOString(),
                    transferred: ingressResult.envelopesApplied + receiptsApplied + enqueued,
                }),
            })
        } catch (error) {
            this.publish({ phase: 'error', errorCode: runtimeErrorCode(error) })
            if (throwOnFailure) throw error
        } finally {
            this.hostTickActive = false
        }
    }

    private async stageLocalPresets(): Promise<number> {
        await this.repository.initialize()
        const presets = usePresetStore.getState().presets
        let staged = 0
        for (const [index, preset] of presets.entries()) {
            const payload = projectPresetForLanSync(preset, index)
            const current = await this.repository.getEntity('prompt.preset', preset.id)
            if (current?.op === 'upsert'
                && current.payload !== null
                && canonicalSerialize(current.payload) === canonicalSerialize(payload)) continue
            await this.repository.applyLocalMutation({
                opId: `op:${this.localDeviceId}:${crypto.randomUUID()}`,
                entityType: 'prompt.preset',
                entityId: preset.id,
                op: 'upsert',
                deviceId: this.localDeviceId,
                userId: LOCAL_SYNC_USER_ID,
                createdAt: new Date().toISOString(),
                payload,
            })
            staged += 1
        }
        return staged
    }

    private async applyPresetProjection(): Promise<number> {
        const entities = (await this.repository.listEntities('prompt.preset'))
            .filter(entity => entity.conflictOfEntityId === null && entity.op === 'upsert')
        let applied = 0
        for (const entity of entities) {
            const preset = presetFromLanSyncEntity(entity)
            const existing = usePresetStore.getState().presets.find(candidate => candidate.id === preset.id)
            if (existing !== undefined
                && canonicalSerialize(projectPresetForLanSync(existing, 0))
                === canonicalSerialize(projectPresetForLanSync(preset, 0))) continue
            usePresetStore.getState().upsertPresetFromSync(preset)
            applied += 1
        }
        return applied
    }
}

let runtime: LanSessionRuntime | null = null

export function getLanSessionRuntime(): LanSessionRuntime {
    runtime ??= new LanSessionRuntime()
    return runtime
}

export function resetLanSessionRuntimeForTests(): void {
    runtime = null
}
