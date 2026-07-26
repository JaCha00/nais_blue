import { normalizeAssetProfile } from '@/services/asset-profile-file'
import type { Preset } from '@/stores/preset-store'
import type { AssetProfile } from '@/types/asset-profile'

export const AGENT_WORKSPACE_SCHEMA_VERSION = 1 as const
export const AGENT_WORKSPACE_DIRECTORY = 'agent-workspace'
export const AGENT_SNAPSHOT_FILE = `${AGENT_WORKSPACE_DIRECTORY}/snapshot.json`
export const AGENT_REQUEST_FILE = `${AGENT_WORKSPACE_DIRECTORY}/request.json`
export const AGENT_REQUEST_EXAMPLE_FILE = `${AGENT_WORKSPACE_DIRECTORY}/request.example.json`
export const AGENT_RESULT_FILE = `${AGENT_WORKSPACE_DIRECTORY}/result.json`
export const AGENT_GUIDE_FILE = `${AGENT_WORKSPACE_DIRECTORY}/README.md`

const PRESET_PATCH_FIELDS = [
    'name', 'basePrompt', 'additionalPrompt', 'detailPrompt', 'negativePrompt',
    'model', 'steps', 'cfgScale', 'cfgRescale', 'sampler', 'scheduler',
    'smea', 'smeaDyn', 'variety', 'qualityToggle', 'ucPreset', 'selectedResolution',
] as const

const DIRECTORY_KEYS = ['output', 'scene', 'styleLab', 'tools', 'library'] as const
const FORBIDDEN_AGENT_KEY = /(?:token|secret|password|credential|authorization|cookie|private.?key|signed.?url|base64|image.?bytes)/i

export interface AgentDirectoryValue {
    path: string
    useAbsolutePath: boolean
}

export type AgentWorkspaceDirectories = Record<typeof DIRECTORY_KEYS[number], AgentDirectoryValue>

export interface AgentWorkspaceSnapshot {
    schemaVersion: typeof AGENT_WORKSPACE_SCHEMA_VERSION
    revision: number
    generatedAt: string
    updatedBy: 'app'
    editable: {
        activePresetId: string
        presets: Preset[]
        directories: AgentWorkspaceDirectories
        assetProfile: AssetProfile
    }
    privacy: {
        credentialsIncluded: false
        imageBytesIncluded: false
        historyIncluded: false
        note: string
    }
    editing: {
        requestFile: typeof AGENT_REQUEST_FILE
        resultFile: typeof AGENT_RESULT_FILE
        rule: string
    }
}

export type AgentPresetPatch = Partial<Pick<Preset, typeof PRESET_PATCH_FIELDS[number]>>

export type AgentEditAction =
    | {
        type: 'preset.patch'
        presetId: string
        patch: AgentPresetPatch
    }
    | {
        type: 'paths.patch'
        patch: Partial<AgentWorkspaceDirectories>
    }
    | {
        type: 'asset-profile.replace'
        profile: AssetProfile
    }

export interface AgentEditRequest {
    schemaVersion: typeof AGENT_WORKSPACE_SCHEMA_VERSION
    requestId: string
    baseRevision: number
    status: 'ready'
    action: AgentEditAction
}

export interface AgentEditResult {
    schemaVersion: typeof AGENT_WORKSPACE_SCHEMA_VERSION
    requestId: string
    status: 'applied' | 'stale' | 'rejected'
    processedAt: string
    baseRevision: number | null
    appliedRevision: number | null
    message: string
}

function record(value: unknown, field: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${field} must be an object.`)
    }
    return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
    const unexpected = Object.keys(value).find(key => !allowed.includes(key))
    if (unexpected !== undefined) throw new TypeError(`${field}.${unexpected} is not supported.`)
}

function boundedString(value: unknown, field: string, maxLength: number, allowEmpty = false): string {
    if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && value.trim().length === 0)) {
        throw new TypeError(`${field} is invalid.`)
    }
    return value
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new TypeError(`${field} is invalid.`)
    }
    return value
}

function boolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw new TypeError(`${field} must be true or false.`)
    return value
}

function validateResolution(value: unknown): Preset['selectedResolution'] {
    const resolution = record(value, 'action.patch.selectedResolution')
    exactKeys(resolution, ['label', 'width', 'height'], 'action.patch.selectedResolution')
    const width = finiteNumber(resolution.width, 'action.patch.selectedResolution.width', 64, 8_192)
    const height = finiteNumber(resolution.height, 'action.patch.selectedResolution.height', 64, 8_192)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width % 64 !== 0 || height % 64 !== 0) {
        throw new TypeError('Resolution width and height must be multiples of 64.')
    }
    return {
        label: boundedString(resolution.label, 'action.patch.selectedResolution.label', 80),
        width,
        height,
    }
}

function validatePresetPatch(value: unknown): AgentPresetPatch {
    const patch = record(value, 'action.patch')
    exactKeys(patch, PRESET_PATCH_FIELDS, 'action.patch')
    if (Object.keys(patch).length === 0) throw new TypeError('action.patch must change at least one field.')
    const result: AgentPresetPatch = {}
    for (const field of PRESET_PATCH_FIELDS) {
        if (patch[field] === undefined) continue
        switch (field) {
            case 'name':
                result.name = boundedString(patch[field], `action.patch.${field}`, 120)
                break
            case 'basePrompt':
            case 'additionalPrompt':
            case 'detailPrompt':
            case 'negativePrompt':
                result[field] = boundedString(patch[field], `action.patch.${field}`, 200_000, true)
                break
            case 'model':
            case 'sampler':
            case 'scheduler':
                result[field] = boundedString(patch[field], `action.patch.${field}`, 128)
                break
            case 'steps': {
                const steps = finiteNumber(patch[field], `action.patch.${field}`, 1, 100)
                if (!Number.isSafeInteger(steps)) throw new TypeError('action.patch.steps must be an integer.')
                result.steps = steps
                break
            }
            case 'cfgScale':
                result.cfgScale = finiteNumber(patch[field], `action.patch.${field}`, 0, 100)
                break
            case 'cfgRescale':
                result.cfgRescale = finiteNumber(patch[field], `action.patch.${field}`, 0, 1)
                break
            case 'ucPreset': {
                const preset = finiteNumber(patch[field], `action.patch.${field}`, 0, 4)
                if (!Number.isSafeInteger(preset)) throw new TypeError('action.patch.ucPreset must be an integer.')
                result.ucPreset = preset
                break
            }
            case 'smea':
            case 'smeaDyn':
            case 'variety':
            case 'qualityToggle':
                result[field] = boolean(patch[field], `action.patch.${field}`)
                break
            case 'selectedResolution':
                result.selectedResolution = validateResolution(patch[field])
                break
        }
    }
    return result
}

function validatePath(value: unknown, field: string): AgentDirectoryValue {
    const candidate = record(value, field)
    exactKeys(candidate, ['path', 'useAbsolutePath'], field)
    const path = boundedString(candidate.path, `${field}.path`, 1_024)
    if (/\0|\r|\n/.test(path)) throw new TypeError(`${field}.path contains unsupported characters.`)
    return { path, useAbsolutePath: boolean(candidate.useAbsolutePath, `${field}.useAbsolutePath`) }
}

function validatePathsPatch(value: unknown): Partial<AgentWorkspaceDirectories> {
    const patch = record(value, 'action.patch')
    exactKeys(patch, DIRECTORY_KEYS, 'action.patch')
    if (Object.keys(patch).length === 0) throw new TypeError('action.patch must change at least one path.')
    return Object.fromEntries(Object.entries(patch).map(([key, entry]) => (
        [key, validatePath(entry, `action.patch.${key}`)]
    ))) as Partial<AgentWorkspaceDirectories>
}

/** Prevents the local editable profile from becoming an accidental secret or binary store. */
function assertAgentJsonSafe(value: unknown, path = '$', depth = 0, budget = { nodes: 0 }): void {
    budget.nodes += 1
    if (budget.nodes > 100_000 || depth > 64) throw new TypeError('Asset Profile is too large or deeply nested.')
    if (value === null || typeof value === 'boolean') return
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`)
        return
    }
    if (typeof value === 'string') {
        if (value.length > 1_048_576) throw new TypeError(`${path} contains an oversized string.`)
        return
    }
    if (typeof value !== 'object') throw new TypeError(`${path} contains a non-JSON value.`)
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertAgentJsonSafe(entry, `${path}[${index}]`, depth + 1, budget))
        return
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_AGENT_KEY.test(key)) throw new TypeError(`${path}.${key} is not allowed in Agent Workspace.`)
        // Asset Profile normalization keeps optional object fields as
        // `undefined`; JSON.stringify omits them, so this validator mirrors
        // that boundary while still rejecting undefined inside arrays/root.
        if (entry === undefined) continue
        assertAgentJsonSafe(entry, `${path}.${key}`, depth + 1, budget)
    }
}

export function validateAgentAssetProfile(value: unknown): AssetProfile {
    assertAgentJsonSafe(value)
    return normalizeAssetProfile(value)
}

function validateAction(value: unknown): AgentEditAction {
    const action = record(value, 'action')
    const type = boundedString(action.type, 'action.type', 64)
    if (type === 'preset.patch') {
        exactKeys(action, ['type', 'presetId', 'patch'], 'action')
        return {
            type,
            presetId: boundedString(action.presetId, 'action.presetId', 128),
            patch: validatePresetPatch(action.patch),
        }
    }
    if (type === 'paths.patch') {
        exactKeys(action, ['type', 'patch'], 'action')
        return { type, patch: validatePathsPatch(action.patch) }
    }
    if (type === 'asset-profile.replace') {
        exactKeys(action, ['type', 'profile'], 'action')
        return { type, profile: validateAgentAssetProfile(action.profile) }
    }
    throw new TypeError(`Unsupported agent action: ${type}`)
}

export function parseAgentEditRequest(value: unknown): AgentEditRequest | null {
    const candidate = record(value, 'request')
    if (candidate.status === 'draft') return null
    exactKeys(candidate, ['schemaVersion', 'requestId', 'baseRevision', 'status', 'action'], 'request')
    if (candidate.schemaVersion !== AGENT_WORKSPACE_SCHEMA_VERSION) throw new TypeError('Unsupported request schemaVersion.')
    if (candidate.status !== 'ready') throw new TypeError('request.status must be "draft" or "ready".')
    const baseRevision = finiteNumber(candidate.baseRevision, 'request.baseRevision', 0, Number.MAX_SAFE_INTEGER)
    if (!Number.isSafeInteger(baseRevision)) throw new TypeError('request.baseRevision must be an integer.')
    return {
        schemaVersion: AGENT_WORKSPACE_SCHEMA_VERSION,
        requestId: boundedString(candidate.requestId, 'request.requestId', 128),
        baseRevision,
        status: 'ready',
        action: validateAction(candidate.action),
    }
}

export function patchAgentPreset(current: Preset, patch: AgentPresetPatch): Preset {
    return {
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        isDefault: current.isDefault,
    }
}

export function createAgentWorkspaceSnapshot(input: {
    revision: number
    generatedAt?: string
    activePresetId: string
    presets: readonly Preset[]
    directories: AgentWorkspaceDirectories
    assetProfile: AssetProfile
}): AgentWorkspaceSnapshot {
    return {
        schemaVersion: AGENT_WORKSPACE_SCHEMA_VERSION,
        revision: input.revision,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        updatedBy: 'app',
        editable: {
            activePresetId: input.activePresetId,
            presets: input.presets.map(preset => ({ ...preset, selectedResolution: { ...preset.selectedResolution } })),
            directories: Object.fromEntries(DIRECTORY_KEYS.map(key => [key, { ...input.directories[key] }])) as AgentWorkspaceDirectories,
            assetProfile: validateAgentAssetProfile(input.assetProfile),
        },
        privacy: {
            credentialsIncluded: false,
            imageBytesIncluded: false,
            historyIncluded: false,
            note: 'NovelAI/R2 credentials, image bytes, thumbnails, history and diagnostic logs are never exported here.',
        },
        editing: {
            requestFile: AGENT_REQUEST_FILE,
            resultFile: AGENT_RESULT_FILE,
            rule: 'Read snapshot.json, copy request.example.json to request.json, keep baseRevision unchanged, then set status to ready.',
        },
    }
}

export function createAgentRequestExample(snapshot: AgentWorkspaceSnapshot): Record<string, unknown> {
    const preset = snapshot.editable.presets.find(entry => entry.id === snapshot.editable.activePresetId)
        ?? snapshot.editable.presets[0]
    return {
        schemaVersion: AGENT_WORKSPACE_SCHEMA_VERSION,
        requestId: `agent-edit-${Date.now()}`,
        baseRevision: snapshot.revision,
        status: 'draft',
        action: {
            type: 'preset.patch',
            presetId: preset?.id ?? 'default',
            patch: {
                basePrompt: preset?.basePrompt ?? '',
                steps: preset?.steps ?? 28,
            },
        },
    }
}
