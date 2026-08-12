import { appDataDir, join } from '@tauri-apps/api/path'
import { BaseDirectory, exists, mkdir, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs'
import { runtimeCapabilities } from '@/platform/capabilities'
import { isDesktopRuntime } from '@/platform/runtime'
import { useAssetModuleStore } from '@/stores/asset-module-store'
import { usePresetStore } from '@/stores/preset-store'
import { useSettingsStore } from '@/stores/settings-store'
import {
    AGENT_GUIDE_FILE,
    AGENT_REQUEST_EXAMPLE_FILE,
    AGENT_REQUEST_FILE,
    AGENT_RESULT_FILE,
    AGENT_SNAPSHOT_FILE,
    AGENT_WORKSPACE_DIRECTORY,
    AGENT_WORKSPACE_SCHEMA_VERSION,
    createAgentRequestExample,
    createAgentWorkspaceSnapshot,
    parseAgentEditRequest,
    patchAgentPreset,
    type AgentEditAction,
    type AgentEditRequest,
    type AgentEditResult,
    type AgentWorkspaceDirectories,
    type AgentWorkspaceSnapshot,
} from './agent-workspace-contract'

const POLL_INTERVAL_MS = 900
const REFRESH_DEBOUNCE_MS = 350

export interface AgentWorkspaceBridgeStatus {
    supported: boolean
    running: boolean
    workspacePath: string | null
    revision: number
    lastSnapshotAt: string | null
    lastRequestId: string | null
    lastResult: AgentEditResult['status'] | null
    lastMessage: string | null
    lastError: string | null
}

const listeners = new Set<() => void>()
let bridgeStatus: AgentWorkspaceBridgeStatus = {
    supported: false,
    running: false,
    workspacePath: null,
    revision: 0,
    lastSnapshotAt: null,
    lastRequestId: null,
    lastResult: null,
    lastMessage: null,
    lastError: null,
}

let stopBridge: (() => void) | null = null
let workspaceRevision = 0
let lastDataFingerprint = ''
let lastRequestId: string | null = null

function updateStatus(patch: Partial<AgentWorkspaceBridgeStatus>): void {
    bridgeStatus = { ...bridgeStatus, ...patch }
    listeners.forEach(listener => listener())
}

export function getAgentWorkspaceBridgeStatus(): AgentWorkspaceBridgeStatus {
    return bridgeStatus
}

export function subscribeAgentWorkspaceBridge(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function currentDirectories(): AgentWorkspaceDirectories {
    const settings = useSettingsStore.getState()
    return {
        output: { path: settings.savePath, useAbsolutePath: settings.useAbsolutePath },
        scene: { path: settings.sceneSavePath, useAbsolutePath: settings.useAbsoluteScenePath },
        styleLab: { path: settings.styleLabSavePath, useAbsolutePath: settings.useAbsoluteStyleLabPath },
        tools: { path: settings.toolsSavePath, useAbsolutePath: settings.useAbsoluteToolsPath },
        library: { path: settings.libraryPath, useAbsolutePath: settings.useAbsoluteLibraryPath },
    }
}

function snapshotSource(): Omit<Parameters<typeof createAgentWorkspaceSnapshot>[0], 'revision' | 'generatedAt'> {
    const preset = usePresetStore.getState()
    return {
        activePresetId: preset.activePresetId,
        presets: preset.presets,
        directories: currentDirectories(),
        assetProfile: useAssetModuleStore.getState().profile,
    }
}

function sourceFingerprint(source: ReturnType<typeof snapshotSource>): string {
    return JSON.stringify(source)
}

async function ensureWorkspaceDirectory(): Promise<void> {
    if (!(await exists(AGENT_WORKSPACE_DIRECTORY, { baseDir: BaseDirectory.AppData }))) {
        await mkdir(AGENT_WORKSPACE_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true })
    }
}

async function writeWorkspaceText(path: string, content: string): Promise<void> {
    await writeTextFile(path, content, { baseDir: BaseDirectory.AppData })
}

function workspaceGuide(): string {
    return `# NAI Blue Agent Workspace

This directory is a local desktop-only bridge. It never contains API credentials or image bytes.

1. Read \`snapshot.json\` and note its \`revision\`.
2. Copy \`request.example.json\` to \`request.json\`.
3. Keep \`baseRevision\` equal to the snapshot revision, use a unique \`requestId\`, and edit one action.
4. Set \`status\` to \`ready\` only after the JSON is complete.
5. Read \`result.json\`. If it says \`stale\`, reread the snapshot and create a new request.

Supported actions are \`preset.patch\`, \`paths.patch\`, and \`asset-profile.replace\`.
Unknown fields, credentials, base64, image bytes, oversized values, and stale revisions are rejected.
`
}

async function readExistingRevision(): Promise<number> {
    if (!(await exists(AGENT_SNAPSHOT_FILE, { baseDir: BaseDirectory.AppData }))) return 0
    try {
        const raw = JSON.parse(await readTextFile(AGENT_SNAPSHOT_FILE, { baseDir: BaseDirectory.AppData })) as { revision?: unknown }
        return typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision) && raw.revision >= 0
            ? raw.revision
            : 0
    } catch {
        return 0
    }
}

async function readLastResult(): Promise<void> {
    if (!(await exists(AGENT_RESULT_FILE, { baseDir: BaseDirectory.AppData }))) return
    try {
        const result = JSON.parse(await readTextFile(AGENT_RESULT_FILE, { baseDir: BaseDirectory.AppData })) as AgentEditResult
        if (result.schemaVersion === AGENT_WORKSPACE_SCHEMA_VERSION && typeof result.requestId === 'string') {
            lastRequestId = result.requestId
            updateStatus({
                lastRequestId: result.requestId,
                lastResult: result.status,
                lastMessage: result.message,
            })
        }
    } catch {
        // A damaged result is diagnostic-only; a future request can replace it.
    }
}

/**
 * Materializes an allowlisted store projection for external agents. The source
 * stores remain authoritative; snapshot writes are recoverable read models and
 * never include credential, history, diagnostic, or image-byte repositories.
 */
export async function refreshAgentWorkspaceSnapshot(force = false): Promise<AgentWorkspaceSnapshot> {
    if (!isDesktopRuntime || !runtimeCapabilities.externalProfileFileWatch.supported) {
        throw new Error('Agent Workspace requires the desktop Tauri app.')
    }
    await ensureWorkspaceDirectory()
    const source = snapshotSource()
    const fingerprint = sourceFingerprint(source)
    if (force || fingerprint !== lastDataFingerprint) {
        workspaceRevision += 1
        lastDataFingerprint = fingerprint
    }
    const snapshot = createAgentWorkspaceSnapshot({
        ...source,
        revision: workspaceRevision,
    })
    await Promise.all([
        writeWorkspaceText(AGENT_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2)),
        writeWorkspaceText(AGENT_REQUEST_EXAMPLE_FILE, JSON.stringify(createAgentRequestExample(snapshot), null, 2)),
        writeWorkspaceText(AGENT_GUIDE_FILE, workspaceGuide()),
    ])
    updateStatus({
        revision: snapshot.revision,
        lastSnapshotAt: snapshot.generatedAt,
        lastError: null,
    })
    return snapshot
}

async function applyPathPatch(patch: Extract<AgentEditAction, { type: 'paths.patch' }>['patch']): Promise<void> {
    const settings = useSettingsStore.getState()
    if (patch.output) settings.setSavePath(patch.output.path, patch.output.useAbsolutePath)
    if (patch.scene) settings.setSceneSavePath(patch.scene.path, patch.scene.useAbsolutePath)
    if (patch.styleLab) settings.setStyleLabSavePath(patch.styleLab.path, patch.styleLab.useAbsolutePath)
    if (patch.tools) settings.setToolsSavePath(patch.tools.path, patch.tools.useAbsolutePath)
    if (patch.library) settings.setLibraryPath(patch.library.path, patch.library.useAbsolutePath)
}

async function applyRequest(request: AgentEditRequest): Promise<void> {
    if (request.action.type === 'preset.patch') {
        const action = request.action
        const store = usePresetStore.getState()
        const current = store.presets.find(preset => preset.id === action.presetId)
        if (!current) throw new Error(`Preset not found: ${action.presetId}`)
        store.replacePresetFromExternal(patchAgentPreset(current, action.patch))
        return
    }
    if (request.action.type === 'paths.patch') {
        await applyPathPatch(request.action.patch)
        return
    }
    const profileStore = useAssetModuleStore.getState()
    const replacement = { ...request.action.profile, revision: profileStore.profile.revision }
    const result = await profileStore.saveToDisk(replacement, 'agent')
    if (result.status === 'conflict') throw new Error('Asset Profile changed while applying the request.')
}

async function writeResult(result: AgentEditResult): Promise<void> {
    await writeWorkspaceText(AGENT_RESULT_FILE, JSON.stringify(result, null, 2))
    lastRequestId = result.requestId
    updateStatus({
        lastRequestId: result.requestId,
        lastResult: result.status,
        lastMessage: result.message,
        lastError: result.status === 'rejected' ? result.message : null,
    })
}

async function processRequestFile(): Promise<void> {
    let raw: unknown
    try {
        raw = JSON.parse(await readTextFile(AGENT_REQUEST_FILE, { baseDir: BaseDirectory.AppData }))
        const request = parseAgentEditRequest(raw)
        if (request === null || request.requestId === lastRequestId) return
        if (request.baseRevision !== workspaceRevision) {
            await writeResult({
                schemaVersion: AGENT_WORKSPACE_SCHEMA_VERSION,
                requestId: request.requestId,
                status: 'stale',
                processedAt: new Date().toISOString(),
                baseRevision: request.baseRevision,
                appliedRevision: null,
                message: `Snapshot revision changed from ${request.baseRevision} to ${workspaceRevision}. Read snapshot.json and retry.`,
            })
            return
        }
        await applyRequest(request)
        const snapshot = await refreshAgentWorkspaceSnapshot(true)
        await writeResult({
            schemaVersion: AGENT_WORKSPACE_SCHEMA_VERSION,
            requestId: request.requestId,
            status: 'applied',
            processedAt: new Date().toISOString(),
            baseRevision: request.baseRevision,
            appliedRevision: snapshot.revision,
            message: 'The requested app data change was validated and applied.',
        })
    } catch (error) {
        const candidate = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {}
        await writeResult({
            schemaVersion: AGENT_WORKSPACE_SCHEMA_VERSION,
            requestId: typeof candidate.requestId === 'string' ? candidate.requestId : 'invalid-request',
            status: 'rejected',
            processedAt: new Date().toISOString(),
            baseRevision: typeof candidate.baseRevision === 'number' ? candidate.baseRevision : null,
            appliedRevision: null,
            message: errorMessage(error),
        })
    }
}

async function requestFingerprint(): Promise<string> {
    if (!(await exists(AGENT_REQUEST_FILE, { baseDir: BaseDirectory.AppData }))) return 'missing'
    const info = await stat(AGENT_REQUEST_FILE, { baseDir: BaseDirectory.AppData })
    return `${info.mtime?.getTime() ?? 'no-mtime'}:${info.size}`
}

export async function getAgentWorkspaceAbsolutePath(): Promise<string> {
    return join(await appDataDir(), AGENT_WORKSPACE_DIRECTORY)
}

/**
 * Starts one desktop-only bridge owner. Stable-fingerprint polling avoids
 * parsing a request while an editor is still writing it; store subscriptions
 * keep the read-only snapshot current without turning files into authority.
 */
export async function startAgentWorkspaceBridge(): Promise<() => void> {
    if (stopBridge) return stopBridge
    const supported = isDesktopRuntime && runtimeCapabilities.externalProfileFileWatch.supported
    if (!supported) {
        updateStatus({ supported: false, running: false, lastError: null })
        return () => undefined
    }

    await ensureWorkspaceDirectory()
    workspaceRevision = await readExistingRevision()
    await readLastResult()
    const workspacePath = await getAgentWorkspaceAbsolutePath()
    await refreshAgentWorkspaceSnapshot(true)

    let stopped = false
    let pollTimer: number | null = null
    let refreshTimer: number | null = null
    let observedFingerprint: string | null = null
    let processedFingerprint: string | null = null

    const scheduleRefresh = () => {
        if (refreshTimer !== null) window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(() => {
            refreshTimer = null
            void refreshAgentWorkspaceSnapshot().catch(error => updateStatus({ lastError: errorMessage(error) }))
        }, REFRESH_DEBOUNCE_MS)
    }
    const unsubscribers = [
        usePresetStore.subscribe(scheduleRefresh),
        useSettingsStore.subscribe(scheduleRefresh),
        useAssetModuleStore.subscribe(scheduleRefresh),
    ]

    const poll = async () => {
        if (stopped) return
        try {
            const fingerprint = await requestFingerprint()
            if (fingerprint !== observedFingerprint) {
                observedFingerprint = fingerprint
            } else if (fingerprint !== 'missing' && fingerprint !== processedFingerprint) {
                processedFingerprint = fingerprint
                await processRequestFile()
            }
        } catch (error) {
            updateStatus({ lastError: errorMessage(error) })
        } finally {
            if (!stopped) pollTimer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
        }
    }

    stopBridge = () => {
        stopped = true
        if (pollTimer !== null) window.clearTimeout(pollTimer)
        if (refreshTimer !== null) window.clearTimeout(refreshTimer)
        unsubscribers.forEach(unsubscribe => unsubscribe())
        stopBridge = null
        updateStatus({ running: false })
    }
    updateStatus({
        supported: true,
        running: true,
        workspacePath,
        revision: workspaceRevision,
        lastError: null,
    })
    void poll()
    return stopBridge
}
