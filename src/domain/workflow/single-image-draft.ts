import {
    DEFAULT_RIGHTS_OWNER,
    MAX_RIGHTS_OWNER_LENGTH,
    isRightsEffectiveDate,
    isRightsOwner,
} from './bluehair-rights-policy'
import { isR2BucketName, isResolvedR2Prefix } from '@/domain/r2/types'
import { DEFAULT_NAI_IMAGE_MODEL } from '@/domain/generation/model-default'

export const WORKFLOW_DRAFT_STORE_KEY = 'nai-blue-workflow-drafts'
export const SINGLE_IMAGE_DRAFT_SCHEMA_VERSION = 2 as const
export const BATCH_IMAGE_DRAFT_SCHEMA_VERSION = 2 as const

const LEGACY_WORKFLOW_DRAFT_SCHEMA_VERSION = 1 as const

export const SINGLE_IMAGE_NODE_IDS = [
    'model',
    'prompt',
    'resolution',
    'settings',
    'output',
    'metadata',
    'rights',
    'delivery',
    'review',
] as const

export type SingleImageNodeId = typeof SINGLE_IMAGE_NODE_IDS[number]
export type SingleImageDraftStatus = 'draft' | 'review' | 'queued' | 'completed'
export type SingleImageMetadataMode = 'embedded' | 'sidecar-only' | 'strip-and-sidecar' | 'strip-only'

export type CredentialDispatchPolicy =
    | { readonly kind: 'auto' }
    | { readonly kind: 'pinned'; readonly credentialId: string }

export interface SingleImageGenerationSettings {
    readonly steps: number
    readonly cfgScale: number
    readonly cfgRescale: number
    readonly sampler: string
    readonly scheduler: string
    readonly smea: boolean
    readonly smeaDyn: boolean
    readonly variety: boolean
    readonly seed: number
    readonly qualityToggle: boolean
    readonly ucPreset: number
    /** Missing on schema-v2 drafts created before V5 means opaque output. */
    readonly transparentBackground?: boolean
}

export interface SingleImageOutputSettings {
    readonly autoSave: boolean
    readonly directory: string
    readonly useAbsolutePath: boolean
    readonly capabilityFallbackDirectory: string
    readonly imageFormat: 'png' | 'webp'
    readonly metadataMode: SingleImageMetadataMode
    readonly collisionPolicy: 'unique' | 'overwrite' | 'error'
    /** Folder plan selected for this job. The resolved path is copied below. */
    readonly generationFolderId?: string | null
    readonly generationFolderPath?: string | null
    /** Folder-local prompt copied into the job so later folder edits cannot change it. */
    readonly folderCommonPrompt?: string
    /** Explicit, job-local consent. Missing on legacy drafts means disabled. */
    readonly autoR2UploadProfileId?: string | null
    /** Resolved R2 destination copied into the job at selection time. */
    readonly r2Bucket?: string | null
    readonly r2Prefix?: string | null
    /** Explicit consent to discard the provider original after the release is verified. */
    readonly deleteOriginalAfterRelease?: boolean
    /** Optional public rights notice added only after deep-cleaning. */
    readonly rightsXmpEnabled?: boolean
    /** Job-local owner label. Missing on older drafts means bluehair.blue. */
    readonly rightsOwner?: string
    /** User-specified YYYY-MM-DD. Never inferred from the system clock. */
    readonly rightsEffectiveDate?: string | null
}

export interface WorkflowCharacterPrompt {
    readonly id: string
    readonly name?: string
    readonly prompt: string
    readonly negative: string
    readonly enabled: boolean
    readonly position: { readonly x: number; readonly y: number }
}

export interface WorkflowCharacterPrompts {
    readonly positionEnabled: boolean
    readonly items: readonly WorkflowCharacterPrompt[]
}

export interface SingleImageDraftPayload {
    readonly mode: 'text-to-image'
    readonly model: string | null
    readonly prompt: {
        readonly positive: string
        readonly negative: string
    }
    readonly characterPrompts: WorkflowCharacterPrompts
    readonly resolution: {
        readonly width: number
        readonly height: number
    } | null
    readonly generation: SingleImageGenerationSettings
    readonly credentialPolicy: CredentialDispatchPolicy
    readonly output: SingleImageOutputSettings
}

export interface SingleImageDraft {
    readonly schemaVersion: typeof SINGLE_IMAGE_DRAFT_SCHEMA_VERSION
    readonly id: string
    readonly kind: 'single-image'
    readonly revision: number
    readonly status: SingleImageDraftStatus
    readonly currentNodeId: SingleImageNodeId
    readonly payload: SingleImageDraftPayload
    readonly createdAt: string
    readonly updatedAt: string
    readonly lastSnapshotId: string | null
}

export const BATCH_IMAGE_NODE_IDS = [
    'model',
    'prompt',
    'count',
    'scenes',
    'resolution',
    'settings',
    'output',
    'metadata',
    'rights',
    'delivery',
    'review',
] as const

export type BatchImageNodeId = typeof BATCH_IMAGE_NODE_IDS[number]
export type BatchImageMode = 'same-settings' | 'variations' | 'scenes'
export type BatchVariationOrder = 'random' | 'sequential'

export function singleImageNodePath(
    metadataMode: SingleImageMetadataMode,
): readonly SingleImageNodeId[] {
    return [
        'model',
        'prompt',
        'resolution',
        'settings',
        'output',
        'metadata',
        ...(metadataMode === 'strip-and-sidecar'
            ? ['rights', 'delivery'] as const
            : []),
        'review',
    ]
}

export function batchImageNodePath(
    mode: BatchImageMode,
    metadataMode: SingleImageMetadataMode,
): readonly BatchImageNodeId[] {
    return [
        'model',
        'prompt',
        mode === 'scenes' ? 'scenes' : 'count',
        'resolution',
        'settings',
        'output',
        'metadata',
        ...(metadataMode === 'strip-and-sidecar'
            ? ['rights', 'delivery'] as const
            : []),
        'review',
    ]
}

export interface BatchImageScene {
    readonly id: string
    readonly name: string
    readonly positive: string
    readonly negative: string
    readonly count: number
}

export interface BatchImageDraftPayload extends SingleImageDraftPayload {
    readonly batchMode: BatchImageMode
    readonly count: number
    readonly variationOrder: BatchVariationOrder
    readonly scenes: readonly BatchImageScene[]
}

export interface BatchImageDraft {
    readonly schemaVersion: typeof BATCH_IMAGE_DRAFT_SCHEMA_VERSION
    readonly id: string
    readonly kind: 'batch-image'
    readonly revision: number
    readonly status: SingleImageDraftStatus
    readonly currentNodeId: BatchImageNodeId
    readonly payload: BatchImageDraftPayload
    readonly createdAt: string
    readonly updatedAt: string
    readonly lastSnapshotId: string | null
}

export type WorkflowDraft = SingleImageDraft | BatchImageDraft

export type SingleImageDraftIssueCode =
    | 'model-required'
    | 'prompt-required'
    | 'character-prompt-invalid'
    | 'resolution-required'
    | 'resolution-invalid'
    | 'generation-settings-invalid'
    | 'output-invalid'
    | 'rights-owner-invalid'
    | 'rights-effective-date-required'
    | 'credential-invalid'

export interface CreateSingleImageDraftInput {
    readonly id: string
    readonly now: string
    readonly seed: number
    readonly model?: string | null
    readonly output?: Partial<SingleImageOutputSettings>
}

export interface ReviseSingleImageDraftInput {
    readonly updatedAt: string
    readonly status?: SingleImageDraftStatus
    readonly currentNodeId?: SingleImageNodeId
    readonly payload?: SingleImageDraftPayload
    readonly lastSnapshotId?: string | null
}

export interface CreateBatchImageDraftInput extends CreateSingleImageDraftInput {
    readonly batchMode: BatchImageMode
}

export interface ReviseBatchImageDraftInput {
    readonly updatedAt: string
    readonly status?: SingleImageDraftStatus
    readonly currentNodeId?: BatchImageNodeId
    readonly payload?: BatchImageDraftPayload
    readonly lastSnapshotId?: string | null
}

const METADATA_MODES = new Set<SingleImageMetadataMode>([
    'embedded',
    'sidecar-only',
    'strip-and-sidecar',
    'strip-only',
])

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function isTimestamp(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isSeed(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff
}

function isGenerationSettings(value: unknown): value is SingleImageGenerationSettings {
    if (!isRecord(value)) return false
    return Number.isSafeInteger(value.steps)
        && (value.steps as number) >= 1
        && typeof value.cfgScale === 'number'
        && Number.isFinite(value.cfgScale)
        && value.cfgScale >= 0
        && typeof value.cfgRescale === 'number'
        && Number.isFinite(value.cfgRescale)
        && value.cfgRescale >= 0
        && value.cfgRescale <= 1
        && typeof value.sampler === 'string'
        && value.sampler.length > 0
        && typeof value.scheduler === 'string'
        && value.scheduler.length > 0
        && typeof value.smea === 'boolean'
        && typeof value.smeaDyn === 'boolean'
        && typeof value.variety === 'boolean'
        && isSeed(value.seed)
        && typeof value.qualityToggle === 'boolean'
        && Number.isSafeInteger(value.ucPreset)
        && (value.ucPreset as number) >= 0
        && (value.transparentBackground === undefined
            || typeof value.transparentBackground === 'boolean')
}

function isResolution(value: unknown): value is NonNullable<SingleImageDraftPayload['resolution']> {
    if (!isRecord(value)) return false
    return Number.isSafeInteger(value.width)
        && Number.isSafeInteger(value.height)
        && (value.width as number) >= 64
        && (value.height as number) >= 64
        && (value.width as number) <= 8_192
        && (value.height as number) <= 8_192
        && (value.width as number) % 64 === 0
        && (value.height as number) % 64 === 0
}

function isOutputSettings(value: unknown): value is SingleImageOutputSettings {
    if (!isRecord(value)) return false
    return typeof value.autoSave === 'boolean'
        && typeof value.directory === 'string'
        && value.directory.length > 0
        && typeof value.useAbsolutePath === 'boolean'
        && typeof value.capabilityFallbackDirectory === 'string'
        && value.capabilityFallbackDirectory.length > 0
        && (value.imageFormat === 'png' || value.imageFormat === 'webp')
        && typeof value.metadataMode === 'string'
        && METADATA_MODES.has(value.metadataMode as SingleImageMetadataMode)
        && (value.generationFolderId === undefined
            || value.generationFolderId === null
            || isBoundedId(value.generationFolderId))
        && (value.generationFolderPath === undefined
            || value.generationFolderPath === null
            || (typeof value.generationFolderPath === 'string' && value.generationFolderPath.length <= 2_000))
        && (value.folderCommonPrompt === undefined
            || (typeof value.folderCommonPrompt === 'string' && value.folderCommonPrompt.length <= 20_000))
        && (value.autoR2UploadProfileId === undefined
            || value.autoR2UploadProfileId === null
            || isBoundedId(value.autoR2UploadProfileId))
        && (value.r2Bucket === undefined
            || value.r2Bucket === null
            || isR2BucketName(value.r2Bucket))
        && (value.r2Prefix === undefined
            || value.r2Prefix === null
            || isResolvedR2Prefix(value.r2Prefix))
        && (value.deleteOriginalAfterRelease === undefined
            || typeof value.deleteOriginalAfterRelease === 'boolean')
        && (value.rightsXmpEnabled === undefined
            || typeof value.rightsXmpEnabled === 'boolean')
        && (value.rightsOwner === undefined
            || (typeof value.rightsOwner === 'string'
                && value.rightsOwner.length <= MAX_RIGHTS_OWNER_LENGTH
                && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value.rightsOwner)))
        && (value.rightsEffectiveDate === undefined
            || value.rightsEffectiveDate === null
            || (typeof value.rightsEffectiveDate === 'string' && value.rightsEffectiveDate.length <= 10))
        && (value.collisionPolicy === 'unique'
            || value.collisionPolicy === 'overwrite'
            || value.collisionPolicy === 'error')
}

function isCredentialPolicy(value: unknown): value is CredentialDispatchPolicy {
    if (!isRecord(value)) return false
    if (value.kind === 'auto') return true
    return value.kind === 'pinned' && isBoundedId(value.credentialId)
}

function isWorkflowCharacterPrompt(value: unknown): value is WorkflowCharacterPrompt {
    if (!isRecord(value) || !isRecord(value.position)) return false
    return isBoundedId(value.id)
        && (value.name === undefined || (typeof value.name === 'string' && value.name.length <= 256))
        && typeof value.prompt === 'string'
        && typeof value.negative === 'string'
        && typeof value.enabled === 'boolean'
        && typeof value.position.x === 'number'
        && Number.isFinite(value.position.x)
        && value.position.x >= 0
        && value.position.x <= 1
        && typeof value.position.y === 'number'
        && Number.isFinite(value.position.y)
        && value.position.y >= 0
        && value.position.y <= 1
}

function isWorkflowCharacterPrompts(value: unknown): value is WorkflowCharacterPrompts {
    if (!isRecord(value)
        || typeof value.positionEnabled !== 'boolean'
        || !Array.isArray(value.items)
        || !value.items.every(isWorkflowCharacterPrompt)) return false
    return new Set(value.items.map(character => character.id)).size === value.items.length
}

function hasUsablePromptText(value: string): boolean {
    return value.split(/\r?\n/).some(line => {
        const trimmed = line.trim()
        return trimmed.length > 0 && !trimmed.startsWith('#')
    })
}

function createDefaultPayload(input: CreateSingleImageDraftInput): SingleImageDraftPayload {
    const output: SingleImageOutputSettings = {
        autoSave: input.output?.autoSave ?? true,
        directory: input.output?.directory ?? 'NAI_Blue_Output',
        useAbsolutePath: input.output?.useAbsolutePath ?? false,
        capabilityFallbackDirectory: input.output?.capabilityFallbackDirectory ?? 'NAI_Blue_Output',
        imageFormat: input.output?.imageFormat ?? 'png',
        metadataMode: input.output?.metadataMode ?? 'embedded',
        collisionPolicy: input.output?.collisionPolicy ?? 'unique',
        generationFolderId: input.output?.generationFolderId ?? null,
        generationFolderPath: input.output?.generationFolderPath ?? null,
        folderCommonPrompt: input.output?.folderCommonPrompt ?? '',
        autoR2UploadProfileId: input.output?.autoR2UploadProfileId ?? null,
        r2Bucket: input.output?.r2Bucket ?? null,
        r2Prefix: input.output?.r2Prefix ?? null,
        deleteOriginalAfterRelease: input.output?.deleteOriginalAfterRelease ?? false,
        rightsXmpEnabled: input.output?.rightsXmpEnabled ?? false,
        rightsOwner: input.output?.rightsOwner ?? DEFAULT_RIGHTS_OWNER,
        rightsEffectiveDate: input.output?.rightsEffectiveDate ?? null,
    }
    if (!isOutputSettings(output)) throw new TypeError('Workflow draft output settings are invalid')
    return Object.freeze({
        mode: 'text-to-image',
        model: input.model ?? DEFAULT_NAI_IMAGE_MODEL,
        prompt: Object.freeze({ positive: '', negative: '' }),
        characterPrompts: Object.freeze({
            positionEnabled: false,
            items: Object.freeze([]),
        }),
        resolution: Object.freeze({ width: 832, height: 1216 }),
        generation: Object.freeze({
            steps: 28,
            cfgScale: 5,
            cfgRescale: 0,
            sampler: 'k_euler_ancestral',
            scheduler: 'karras',
            smea: true,
            smeaDyn: true,
            variety: false,
            seed: input.seed,
            qualityToggle: true,
            ucPreset: 0,
            transparentBackground: false,
        }),
        credentialPolicy: Object.freeze({ kind: 'auto' as const }),
        output: Object.freeze(output),
    })
}

/**
 * Creates the complete recommended T2I payload once so autosave and Queue
 * materialization never depend on the mutable expert Generation store.
 */
export function createSingleImageDraft(input: CreateSingleImageDraftInput): SingleImageDraft {
    if (!isBoundedId(input.id) || !isTimestamp(input.now) || !isSeed(input.seed)) {
        throw new TypeError('Single-image draft identity, timestamp, or seed is invalid')
    }
    return Object.freeze({
        schemaVersion: SINGLE_IMAGE_DRAFT_SCHEMA_VERSION,
        id: input.id,
        kind: 'single-image',
        revision: 0,
        status: 'draft',
        currentNodeId: 'prompt',
        payload: createDefaultPayload(input),
        createdAt: input.now,
        updatedAt: input.now,
        lastSnapshotId: null,
    })
}

export function createBatchImageDraft(input: CreateBatchImageDraftInput): BatchImageDraft {
    if (!['same-settings', 'variations', 'scenes'].includes(input.batchMode)) {
        throw new TypeError('Batch-image draft mode is invalid')
    }
    const single = createSingleImageDraft(input)
    return Object.freeze({
        ...single,
        kind: 'batch-image',
        currentNodeId: 'prompt',
        payload: Object.freeze({
            ...single.payload,
            batchMode: input.batchMode,
            count: 4,
            variationOrder: 'random',
            scenes: Object.freeze([]),
        }),
    })
}

/** Returns product-facing blocking issue codes without importing UI copy. */
export function listSingleImageDraftIssues(draft: SingleImageDraft): SingleImageDraftIssueCode[] {
    const issues: SingleImageDraftIssueCode[] = []
    if (draft.payload.model === null || draft.payload.model.trim().length === 0) issues.push('model-required')
    if (draft.payload.prompt.positive.trim().length === 0) issues.push('prompt-required')
    if (draft.payload.characterPrompts.items.some(character => (
        character.enabled && !hasUsablePromptText(character.prompt)
    ))) issues.push('character-prompt-invalid')
    if (draft.payload.resolution === null) issues.push('resolution-required')
    else if (!isResolution(draft.payload.resolution)) issues.push('resolution-invalid')
    if (!isGenerationSettings(draft.payload.generation)) issues.push('generation-settings-invalid')
    if (!isOutputSettings(draft.payload.output)) issues.push('output-invalid')
    else if (draft.payload.output.rightsXmpEnabled === true
        && !isRightsOwner(draft.payload.output.rightsOwner ?? DEFAULT_RIGHTS_OWNER)) {
        issues.push('rights-owner-invalid')
    } else if (draft.payload.output.rightsXmpEnabled === true
        && (draft.payload.output.metadataMode !== 'strip-and-sidecar'
            || !isRightsEffectiveDate(draft.payload.output.rightsEffectiveDate))) {
        issues.push('rights-effective-date-required')
    }
    if (!isCredentialPolicy(draft.payload.credentialPolicy)) issues.push('credential-invalid')
    return issues
}

export function isSingleImageDraftReady(draft: SingleImageDraft): boolean {
    return listSingleImageDraftIssues(draft).length === 0
}

/** Produces the next immutable revision; persistence separately enforces CAS. */
export function reviseSingleImageDraft(
    current: SingleImageDraft,
    input: ReviseSingleImageDraftInput,
): SingleImageDraft {
    if (!isTimestamp(input.updatedAt) || Date.parse(input.updatedAt) < Date.parse(current.updatedAt)) {
        throw new TypeError('Single-image draft updatedAt must be monotonic')
    }
    const next: SingleImageDraft = {
        ...current,
        revision: current.revision + 1,
        updatedAt: input.updatedAt,
        status: input.status ?? current.status,
        currentNodeId: input.currentNodeId ?? current.currentNodeId,
        payload: input.payload ?? current.payload,
        lastSnapshotId: input.lastSnapshotId === undefined
            ? current.lastSnapshotId
            : input.lastSnapshotId,
    }
    if (!isSingleImageDraft(next)) throw new TypeError('Revised single-image draft is invalid')
    return Object.freeze(next)
}

export function reviseBatchImageDraft(
    current: BatchImageDraft,
    input: ReviseBatchImageDraftInput,
): BatchImageDraft {
    if (!isTimestamp(input.updatedAt) || Date.parse(input.updatedAt) < Date.parse(current.updatedAt)) {
        throw new TypeError('Batch-image draft updatedAt must be monotonic')
    }
    const next: BatchImageDraft = {
        ...current,
        revision: current.revision + 1,
        updatedAt: input.updatedAt,
        status: input.status ?? current.status,
        currentNodeId: input.currentNodeId ?? current.currentNodeId,
        payload: input.payload ?? current.payload,
        lastSnapshotId: input.lastSnapshotId === undefined
            ? current.lastSnapshotId
            : input.lastSnapshotId,
    }
    if (!isBatchImageDraft(next)) throw new TypeError('Revised batch-image draft is invalid')
    return Object.freeze(next)
}

function isImagePayload(value: unknown): value is SingleImageDraftPayload {
    return isRecord(value)
        && value.mode === 'text-to-image'
        && (value.model === null || typeof value.model === 'string')
        && isRecord(value.prompt)
        && typeof value.prompt.positive === 'string'
        && typeof value.prompt.negative === 'string'
        && isWorkflowCharacterPrompts(value.characterPrompts)
        && (value.resolution === null || isResolution(value.resolution))
        && isGenerationSettings(value.generation)
        && isCredentialPolicy(value.credentialPolicy)
        && isOutputSettings(value.output)
}

/** Validates persisted input before any revision becomes application authority. */
export function isSingleImageDraft(value: unknown): value is SingleImageDraft {
    if (!isRecord(value)
        || value.schemaVersion !== SINGLE_IMAGE_DRAFT_SCHEMA_VERSION
        || value.kind !== 'single-image'
        || !isBoundedId(value.id)
        || !Number.isSafeInteger(value.revision)
        || (value.revision as number) < 0
        || !['draft', 'review', 'queued', 'completed'].includes(String(value.status))
        || !SINGLE_IMAGE_NODE_IDS.includes(value.currentNodeId as SingleImageNodeId)
        || !isTimestamp(value.createdAt)
        || !isTimestamp(value.updatedAt)
        || Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)
        || (value.lastSnapshotId !== null && !isBoundedId(value.lastSnapshotId))
        || !isImagePayload(value.payload)) {
        return false
    }
    return true
}

export type BatchImageDraftIssueCode = SingleImageDraftIssueCode
    | 'count-invalid'
    | 'scenes-required'
    | 'scene-invalid'

function isBatchImageScene(value: unknown): value is BatchImageScene {
    return isRecord(value)
        && isBoundedId(value.id)
        && typeof value.name === 'string'
        && typeof value.positive === 'string'
        && typeof value.negative === 'string'
        && Number.isSafeInteger(value.count)
        && (value.count as number) >= 1
        && (value.count as number) <= 999
}

function isReadyBatchImageScene(value: BatchImageScene): boolean {
    return value.name.trim().length > 0 && value.positive.trim().length > 0
}

export function listBatchImageDraftIssues(draft: BatchImageDraft): BatchImageDraftIssueCode[] {
    const singleIssues = listSingleImageDraftIssues({
        ...draft,
        kind: 'single-image',
        currentNodeId: SINGLE_IMAGE_NODE_IDS.includes(draft.currentNodeId as SingleImageNodeId)
            ? draft.currentNodeId as SingleImageNodeId
            : 'settings',
    })
    const issues: BatchImageDraftIssueCode[] = draft.payload.batchMode === 'scenes'
        ? singleIssues.filter(issue => issue !== 'prompt-required')
        : [...singleIssues]
    if (!Number.isSafeInteger(draft.payload.count)
        || draft.payload.count < 1
        || draft.payload.count > 9_999) issues.push('count-invalid')
    if (draft.payload.batchMode === 'scenes') {
        if (draft.payload.scenes.length === 0) issues.push('scenes-required')
        else if (!draft.payload.scenes.every(isReadyBatchImageScene)
            || draft.payload.scenes.reduce((sum, scene) => sum + scene.count, 0) > 9_999) {
            issues.push('scene-invalid')
        }
    }
    return [...new Set(issues)]
}

export function isBatchImageDraftReady(draft: BatchImageDraft): boolean {
    return listBatchImageDraftIssues(draft).length === 0
}

export function isBatchImageDraft(value: unknown): value is BatchImageDraft {
    const payload = isRecord(value) ? value.payload : null
    if (!isRecord(value)
        || value.schemaVersion !== BATCH_IMAGE_DRAFT_SCHEMA_VERSION
        || value.kind !== 'batch-image'
        || !isBoundedId(value.id)
        || !Number.isSafeInteger(value.revision)
        || (value.revision as number) < 0
        || !['draft', 'review', 'queued', 'completed'].includes(String(value.status))
        || !BATCH_IMAGE_NODE_IDS.includes(value.currentNodeId as BatchImageNodeId)
        || !isTimestamp(value.createdAt)
        || !isTimestamp(value.updatedAt)
        || Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)
        || (value.lastSnapshotId !== null && !isBoundedId(value.lastSnapshotId))
        || !isRecord(payload)
        || !['same-settings', 'variations', 'scenes'].includes(String(payload.batchMode))
        || !Number.isSafeInteger(payload.count)
        || (payload.count as number) < 1
        || (payload.count as number) > 9_999
        || !['random', 'sequential'].includes(String(payload.variationOrder))
        || !Array.isArray(payload.scenes)
        || !payload.scenes.every(isBatchImageScene)
        || !isImagePayload(payload)) return false
    return true
}

export function isWorkflowDraft(value: unknown): value is WorkflowDraft {
    return isSingleImageDraft(value) || isBatchImageDraft(value)
}

/** Adds the v2 draft-owned character collection without reading mutable expert stores. */
export function migrateWorkflowDraft(value: unknown): unknown {
    if (!isRecord(value)
        || value.schemaVersion !== LEGACY_WORKFLOW_DRAFT_SCHEMA_VERSION
        || (value.kind !== 'single-image' && value.kind !== 'batch-image')
        || !isRecord(value.payload)) return value
    return {
        ...value,
        schemaVersion: value.kind === 'single-image'
            ? SINGLE_IMAGE_DRAFT_SCHEMA_VERSION
            : BATCH_IMAGE_DRAFT_SCHEMA_VERSION,
        payload: {
            ...value.payload,
            characterPrompts: {
                positionEnabled: false,
                items: [],
            },
        },
    }
}
