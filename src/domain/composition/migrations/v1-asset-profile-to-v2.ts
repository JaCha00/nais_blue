import { hashCanonicalValue } from '../canonical-serialize'
import {
    COMPOSITION_SCHEMA_VERSION,
    type ActorRef,
    type CompositionDocument,
    type CompositionModule,
    type CompositionModuleKind,
    type CompositionProfile,
    type CompositionRecipe,
    type Extensions,
    type IsoTimestamp,
    type JsonObject,
    type JsonValue,
    type OutputPolicy,
    type ParamsOverride,
    type PositivePromptSlot,
    type PromptContribution,
    type PromptTarget,
    type RecipeStep,
} from '../types'
import {
    DeterministicMigrationIdAllocator,
    deterministicCompositionMigrationId,
    type MigrationIdClaim,
} from './deterministic-id'
import {
    emptyMigrationEntityCounts,
    migrationHasFatalIssues,
    type MigrationEntityCounts,
    type MigrationIssue,
    type MigrationReport,
} from './report-types'

export const V1_ASSET_PROFILE_MIGRATION_ID = 'asset-profile-v1-to-composition-v2' as const
export const MIGRATION_FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z' as const

export interface V1AssetProfileMigrationInput {
    profile: unknown
    /** Stable IDs from the character-prompt migration, in the legacy array order. */
    stableCharacterIds?: readonly string[]
    documentId?: string
    profileId?: string
}

export type LegacyUnknownTargetReason = 'unknown-target' | 'character-index-out-of-range'

export interface LegacyUnknownTargetOrphan {
    sourceKind: 'module' | 'recipe-step'
    sourceId: string
    path: Array<string | number>
    legacyTarget: string
    rawValue: JsonValue
    reason: LegacyUnknownTargetReason
    characterIndex?: number
}

export interface V1AssetProfileMigrationResult {
    document: CompositionDocument
    report: MigrationReport
    orphans: LegacyUnknownTargetOrphan[]
}

type UnknownRecord = Record<string, unknown>
type EntityCounterKey = 'documents' | 'profiles' | 'modules' | 'recipes' | 'recipeSteps' | 'promptContributions' | 'orphanTargets'

interface RevisionContext {
    revision: number
    timestamp: IsoTimestamp
    actor: ActorRef
}

interface LegacyEntityEntry {
    key: string
    index: number
    record: UnknownRecord
    path: Array<string | number>
}

interface LegacyPromptDraft {
    legacyTarget: string
    text: string
    order: number
    path: Array<string | number>
}

interface SettingsProjection {
    params: ParamsOverride | undefined
    unknown: JsonObject
}

interface TargetProjectionSuccess {
    success: true
    target: PromptTarget
}

interface TargetProjectionFailure {
    success: false
    reason: LegacyUnknownTargetReason
    characterIndex?: number
}

type TargetProjection = TargetProjectionSuccess | TargetProjectionFailure

const PROFILE_KNOWN_KEYS = new Set([
    'schemaVersion',
    'id',
    'profileId',
    'documentId',
    'revision',
    'updatedBy',
    'updatedAt',
    'settings',
    'output',
    'r2',
    'modules',
    'recipes',
    'defaultRecipeId',
])

const NON_PARAM_SETTING_KEYS = new Set([
    'name',
    'label',
    'target',
    'order',
    'prompt',
    'prompts',
    'targets',
    'negative',
    'negativePrompt',
    'enabled',
    'kind',
])

const KNOWN_SOURCE_MODES = new Set(['text-to-image', 'image-to-image', 'inpaint'])
const KNOWN_METADATA_MODES = new Set(['embedded', 'sidecar-only', 'strip-and-sidecar'])
const KNOWN_MODULE_KINDS = new Set(['prompt', 'character', 'params', 'output', 'composite'])

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toJsonValue(value: unknown, ancestors = new Set<object>()): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value !== 'object') return value === undefined ? null : String(value)
    if (ancestors.has(value)) return '[Circular]'
    ancestors.add(value)
    try {
        if (Array.isArray(value)) return value.map(item => toJsonValue(item, ancestors))
        const result: JsonObject = {}
        for (const key of Object.keys(value).sort()) {
            result[key] = toJsonValue((value as UnknownRecord)[key], ancestors)
        }
        return result
    } finally {
        ancestors.delete(value)
    }
}

function jsonObject(value: unknown): JsonObject {
    const projected = toJsonValue(value)
    return isRecord(projected) ? projected as JsonObject : {}
}

function readNonEmptyString(record: UnknownRecord, ...keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = record[key]
        if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    }
    return undefined
}

function readFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return undefined
}

function isIsoTimestamp(value: unknown): value is IsoTimestamp {
    return typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        && !Number.isNaN(Date.parse(value))
}

function issue(
    issues: MigrationIssue[],
    value: Omit<MigrationIssue, 'path'> & { path: readonly (string | number)[] },
): void {
    issues.push({ ...value, path: [...value.path] })
}

function actorFromLegacy(value: unknown): ActorRef {
    const raw = typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'system'
    const kind: ActorRef['kind'] = raw === 'agent'
        ? 'agent'
        : raw === 'system'
            ? 'system'
            : raw === 'gui'
                ? 'user'
                : 'service'
    return {
        kind,
        id: `asset-profile-actor:${raw}`,
        displayName: raw,
        extensions: { legacy: { updatedBy: raw } },
    }
}

function revisionContext(profile: UnknownRecord, issues: MigrationIssue[]): RevisionContext {
    const rawRevision = profile.revision
    const revision = typeof rawRevision === 'number'
        && Number.isSafeInteger(rawRevision)
        && rawRevision >= 0
        ? rawRevision
        : 0
    if (rawRevision !== undefined && revision !== rawRevision) {
        issue(issues, {
            code: 'M_INVALID_METADATA_REPAIRED',
            severity: 'warning',
            path: ['revision'],
            message: 'Invalid Asset Profile revision was preserved in the report and normalized to zero.',
            repairable: true,
            details: { legacyValue: toJsonValue(rawRevision) },
        })
    }

    const timestamp = isIsoTimestamp(profile.updatedAt)
        ? profile.updatedAt
        : MIGRATION_FALLBACK_TIMESTAMP
    if (profile.updatedAt !== undefined && timestamp !== profile.updatedAt) {
        issue(issues, {
            code: 'M_INVALID_METADATA_REPAIRED',
            severity: 'warning',
            path: ['updatedAt'],
            message: 'Invalid Asset Profile updatedAt was preserved in the report and replaced by the migration epoch.',
            repairable: true,
            details: { legacyValue: toJsonValue(profile.updatedAt) },
        })
    }

    return {
        revision,
        timestamp,
        actor: actorFromLegacy(profile.updatedBy),
    }
}

function revisionFields(context: RevisionContext) {
    return {
        revision: context.revision,
        createdAt: context.timestamp,
        createdBy: context.actor,
        updatedAt: context.timestamp,
        updatedBy: context.actor,
    }
}

function identityWithoutDisplayFields(value: unknown): JsonValue {
    if (Array.isArray(value)) return value.map(identityWithoutDisplayFields)
    if (!isRecord(value)) return toJsonValue(value)
    const result: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
        if (key === 'id' || key === 'name' || key === 'label' || key === 'title' || key === 'displayName') continue
        result[key] = identityWithoutDisplayFields(item)
    }
    return result
}

function entityEntries(
    value: unknown,
    path: readonly (string | number)[],
    issues: MigrationIssue[],
): LegacyEntityEntry[] {
    if (Array.isArray(value)) {
        return value.map((item, index) => ({
            key: String(index),
            index,
            record: isRecord(item) ? item : {},
            path: [...path, index],
        }))
    }
    if (isRecord(value)) {
        return Object.entries(value).map(([key, item], index) => ({
            key,
            index,
            record: isRecord(item) ? item : {},
            path: [...path, key],
        }))
    }
    if (value !== undefined && value !== null) {
        issue(issues, {
            code: 'M_INVALID_SOURCE_REPAIRED',
            severity: 'error',
            path,
            message: 'Expected a legacy entity array or object; migrated it as an empty collection.',
            repairable: true,
            details: { legacyValue: toJsonValue(value) },
        })
    }
    return []
}

function claimPreferredId(
    allocator: DeterministicMigrationIdAllocator,
    preferredId: unknown,
    namespace: string,
    locator: readonly (string | number)[],
    identity: unknown,
    counter: MigrationEntityCounts,
    issues: MigrationIssue[],
    reportPath: readonly (string | number)[],
): MigrationIdClaim {
    const claim = allocator.claim(preferredId, { namespace, locator, identity })
    if (claim.generated) counter.generatedIds += 1
    if (claim.duplicate) counter.repairedIds += 1
    if (claim.generated) {
        issue(issues, {
            code: claim.duplicate ? 'M_DUPLICATE_ID_REPAIRED' : 'M_ID_GENERATED',
            severity: 'warning',
            path: reportPath,
            message: claim.duplicate
                ? 'Duplicate entity ID was replaced with a deterministic migration ID.'
                : 'Missing entity ID was replaced with a deterministic migration ID.',
            repairable: true,
            details: {
                generatedId: claim.id,
                ...(claim.legacyId === undefined ? {} : { legacyId: claim.legacyId }),
            },
        })
    }
    return claim
}

function assignParam(params: ParamsOverride, key: keyof ParamsOverride, value: unknown): boolean {
    switch (key) {
        case 'model':
        case 'sampler':
        case 'scheduler':
        case 'sourceImageResourceId':
        case 'maskResourceId': {
            if (typeof value !== 'string' || value.trim().length === 0) return false
            Object.assign(params, { [key]: value.trim() })
            return true
        }
        case 'sourceMode': {
            if (typeof value !== 'string' || !KNOWN_SOURCE_MODES.has(value)) return false
            Object.assign(params, { sourceMode: value })
            return true
        }
        case 'smea':
        case 'smeaDyn':
        case 'variety':
        case 'seedLocked':
        case 'qualityToggle':
        case 'characterPositionEnabled': {
            if (typeof value !== 'boolean') return false
            Object.assign(params, { [key]: value })
            return true
        }
        case 'width':
        case 'height':
        case 'steps': {
            const number = readFiniteNumber(value)
            if (number === undefined || !Number.isSafeInteger(number) || number < 1) return false
            Object.assign(params, { [key]: number })
            return true
        }
        case 'cfgScale':
        case 'cfgRescale': {
            const number = readFiniteNumber(value)
            if (number === undefined || number < 0 || (key === 'cfgRescale' && number > 1)) return false
            Object.assign(params, { [key]: number })
            return true
        }
        case 'seed': {
            const number = readFiniteNumber(value)
            if (number === undefined || !Number.isSafeInteger(number) || number < 0 || number > 0xffff_ffff) return false
            Object.assign(params, { seed: number })
            return true
        }
        case 'ucPreset': {
            const number = readFiniteNumber(value)
            if (number === undefined || !Number.isSafeInteger(number) || number < 0) return false
            Object.assign(params, { ucPreset: number })
            return true
        }
        case 'strength':
        case 'noise': {
            const number = readFiniteNumber(value)
            if (number === undefined || number < 0 || number > 1) return false
            Object.assign(params, { [key]: number })
            return true
        }
        case 'extensions':
            return false
    }
}

function canonicalParamKey(key: string): keyof ParamsOverride | undefined {
    switch (key) {
        case 'model': return 'model'
        case 'width': return 'width'
        case 'height': return 'height'
        case 'steps': return 'steps'
        case 'cfgScale':
        case 'cfg_scale':
        case 'cfg': return 'cfgScale'
        case 'cfgRescale':
        case 'cfg_rescale': return 'cfgRescale'
        case 'sampler': return 'sampler'
        case 'scheduler': return 'scheduler'
        case 'smea': return 'smea'
        case 'smeaDyn':
        case 'smea_dyn': return 'smeaDyn'
        case 'variety': return 'variety'
        case 'seed': return 'seed'
        case 'seedLocked':
        case 'seed_locked': return 'seedLocked'
        case 'qualityToggle':
        case 'quality_toggle': return 'qualityToggle'
        case 'ucPreset':
        case 'uc_preset': return 'ucPreset'
        case 'sourceMode':
        case 'source_mode': return 'sourceMode'
        case 'sourceImageResourceId':
        case 'source_image_resource_id': return 'sourceImageResourceId'
        case 'maskResourceId':
        case 'mask_resource_id': return 'maskResourceId'
        case 'strength': return 'strength'
        case 'noise': return 'noise'
        case 'characterPositionEnabled':
        case 'character_position_enabled': return 'characterPositionEnabled'
        default: return undefined
    }
}

function projectSettings(value: unknown): SettingsProjection {
    const settings = isRecord(value) ? value : {}
    const params: ParamsOverride = {}
    const unknown: JsonObject = {}
    const assigned = new Set<keyof ParamsOverride>()

    for (const [legacyKey, rawValue] of Object.entries(settings)) {
        if (NON_PARAM_SETTING_KEYS.has(legacyKey)) continue
        const key = canonicalParamKey(legacyKey)
        if (key === undefined || assigned.has(key) || !assignParam(params, key, rawValue)) {
            unknown[legacyKey] = toJsonValue(rawValue)
            continue
        }
        assigned.add(key)
    }

    return {
        params: Object.keys(params).length === 0 ? undefined : params,
        unknown,
    }
}

function legacyExtensions(
    settings: SettingsProjection,
    extra: JsonObject = {},
): Extensions | undefined {
    const legacy: JsonObject = { ...extra }
    if (Object.keys(settings.unknown).length > 0) legacy.settings = settings.unknown
    return Object.keys(legacy).length === 0 ? undefined : { legacy }
}

function recordUnknownSettingsIssue(
    settings: SettingsProjection,
    path: readonly (string | number)[],
    issues: MigrationIssue[],
): void {
    const keys = Object.keys(settings.unknown)
    if (keys.length === 0) return
    issue(issues, {
        code: 'M_UNKNOWN_SETTING_PRESERVED',
        severity: 'info',
        path,
        message: 'Unknown legacy settings were preserved under extensions.legacy.settings.',
        repairable: false,
        details: { keys },
    })
}

function portableSegments(path: string): string[] {
    return path
        .split(/[\\/]+/)
        .map(segment => segment.trim())
        .filter(segment => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.endsWith(':'))
}

function outputPolicy(value: unknown): OutputPolicy {
    const record = isRecord(value) ? value : {}
    const directory = readNonEmptyString(record, 'directory')
    const rawFormat = readNonEmptyString(record, 'format')?.replace(/^\./, '').toLowerCase()
    const format = rawFormat === 'webp' ? 'webp' : 'png'
    const rawTemplate = readNonEmptyString(record, 'filenameTemplate', 'fileName')
    const filenameTemplate = rawTemplate !== undefined
        && rawTemplate !== '.'
        && rawTemplate !== '..'
        && !rawTemplate.includes('/')
        && !rawTemplate.includes('\\')
        && !rawTemplate.includes('\0')
        ? rawTemplate
        : 'NAIS_{timestamp}'
    const rawMetadataMode = readNonEmptyString(record, 'metadataMode')
    const metadataMode = rawMetadataMode !== undefined && KNOWN_METADATA_MODES.has(rawMetadataMode)
        ? rawMetadataMode as OutputPolicy['metadataMode']
        : record.metadataSidecar === true
            ? 'sidecar-only'
            : 'embedded'
    return {
        destination: directory === undefined
            ? { kind: 'memory' }
            : {
                kind: 'filesystem',
                directory: { kind: 'standard', root: 'pictures', segments: portableSegments(directory) },
            },
        format,
        filenameTemplate,
        metadataMode,
        collisionPolicy: 'unique',
        ...(Object.keys(record).length === 0 ? {} : { extensions: { legacy: jsonObject(record) } }),
    }
}

function optionalOutputPolicy(value: unknown): OutputPolicy | undefined {
    return isRecord(value) && Object.keys(value).length > 0 ? outputPolicy(value) : undefined
}

function moduleKind(value: unknown): CompositionModuleKind {
    return typeof value === 'string' && KNOWN_MODULE_KINDS.has(value)
        ? value as CompositionModuleKind
        : 'composite'
}

function collectPromptValue(
    value: unknown,
    legacyTarget: string,
    order: number,
    path: readonly (string | number)[],
    drafts: LegacyPromptDraft[],
): void {
    if (typeof value === 'string') {
        drafts.push({ legacyTarget, text: value, order, path: [...path] })
        return
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectPromptValue(item, legacyTarget, order, [...path, index], drafts))
        return
    }
    if (!isRecord(value)) return

    const nestedText = typeof value.prompt === 'string'
        ? value.prompt
        : typeof value.text === 'string'
            ? value.text
            : undefined
    if (nestedText !== undefined) {
        collectPromptValue(
            nestedText,
            readNonEmptyString(value, 'target') ?? legacyTarget,
            readFiniteNumber(value.order) ?? order,
            [...path, 'prompt'],
            drafts,
        )
        return
    }

    for (const [nestedTarget, nestedValue] of Object.entries(value)) {
        collectPromptValue(nestedValue, nestedTarget, order, [...path, nestedTarget], drafts)
    }
}

function promptDrafts(record: UnknownRecord, path: readonly (string | number)[]): LegacyPromptDraft[] {
    const settings = isRecord(record.settings) ? record.settings : {}
    const source: UnknownRecord = { ...record, ...settings }
    const target = readNonEmptyString(source, 'target') ?? 'main.base'
    const order = readFiniteNumber(source.order) ?? 0
    const drafts: LegacyPromptDraft[] = []
    collectPromptValue(source.prompt, target, order, [...path, 'prompt'], drafts)
    collectPromptValue(source.prompts, target, order, [...path, 'prompts'], drafts)
    collectPromptValue(source.targets, target, order, [...path, 'targets'], drafts)
    const negative = typeof source.negative === 'string'
        ? source.negative
        : typeof source.negativePrompt === 'string'
            ? source.negativePrompt
            : undefined
    if (negative !== undefined) {
        drafts.push({
            legacyTarget: 'main.negative',
            text: negative,
            order,
            path: [...path, source.negative === negative ? 'negative' : 'negativePrompt'],
        })
    }
    return drafts
}

function projectPromptTarget(
    value: string,
    stableCharacterIds: readonly (string | undefined)[],
): TargetProjection {
    const normalized = value.trim().toLowerCase()
    const positiveSlots: Record<string, PositivePromptSlot> = {
        'main.base': 'base',
        'main.positive': 'base',
        base: 'base',
        positive: 'base',
        'main.inpainting': 'inpainting',
        inpainting: 'inpainting',
        'main.additional': 'additional',
        additional: 'additional',
        'main.workflow': 'workflow',
        workflow: 'workflow',
        'main.scene': 'scene',
        scene: 'scene',
        'main.style': 'style',
        style: 'style',
        'main.detail': 'detail',
        detail: 'detail',
        'main.quality': 'quality',
        quality: 'quality',
    }
    const slot = positiveSlots[normalized]
    if (slot !== undefined) return { success: true, target: { kind: 'positive', slot } }
    if (normalized === 'main.negative' || normalized === 'negative') {
        return { success: true, target: { kind: 'negative' } }
    }

    const character = /^(?:v4\.)?(?:char|character)\.(\d+)\.(positive|negative)$/.exec(normalized)
    if (character !== null) {
        const characterIndex = Number(character[1])
        const characterId = stableCharacterIds[characterIndex]
        return characterId === undefined
            ? { success: false, reason: 'character-index-out-of-range', characterIndex }
            : {
                success: true,
                target: {
                    kind: 'character',
                    characterId,
                    polarity: character[2] as 'positive' | 'negative',
                },
            }
    }
    return { success: false, reason: 'unknown-target' }
}

function contributionOrderKey(ownerOrder: number, draft: LegacyPromptDraft, index: number): string {
    const normalizedOrder = Number.isFinite(draft.order) ? draft.order : 0
    return `${String(ownerOrder).padStart(6, '0')}:${String(normalizedOrder).padStart(12, '0')}:${String(index).padStart(6, '0')}`
}

function buildContributions(input: {
    ownerKind: LegacyUnknownTargetOrphan['sourceKind']
    ownerId: string
    ownerOrder: number
    record: UnknownRecord
    path: readonly (string | number)[]
    context: RevisionContext
    allocator: DeterministicMigrationIdAllocator
    stableCharacterIds: readonly (string | undefined)[]
    counter: MigrationEntityCounts
    orphanCounter: MigrationEntityCounts
    issues: MigrationIssue[]
    orphans: LegacyUnknownTargetOrphan[]
}): PromptContribution[] {
    const drafts = promptDrafts(input.record, input.path)
    input.counter.source += drafts.length
    return drafts.flatMap((draft, index): PromptContribution[] => {
        const projected = projectPromptTarget(draft.legacyTarget, input.stableCharacterIds)
        if (!projected.success) {
            const orphan: LegacyUnknownTargetOrphan = {
                sourceKind: input.ownerKind,
                sourceId: input.ownerId,
                path: [...draft.path],
                legacyTarget: draft.legacyTarget,
                rawValue: draft.text,
                reason: projected.reason,
                ...(projected.characterIndex === undefined ? {} : { characterIndex: projected.characterIndex }),
            }
            input.orphans.push(orphan)
            input.counter.orphaned += 1
            input.orphanCounter.source += 1
            input.orphanCounter.migrated += 1
            input.orphanCounter.orphaned += 1
            issue(input.issues, {
                code: projected.reason === 'character-index-out-of-range'
                    ? 'M_CHARACTER_TARGET_OUT_OF_RANGE'
                    : 'M_UNKNOWN_TARGET_ORPHANED',
                severity: projected.reason === 'character-index-out-of-range' ? 'error' : 'warning',
                path: draft.path,
                message: projected.reason === 'character-index-out-of-range'
                    ? 'Character index target was outside the migration-time stable character list and was retained as an orphan.'
                    : 'Unknown prompt target was retained losslessly as a legacy orphan.',
                repairable: true,
                details: {
                    sourceId: input.ownerId,
                    legacyTarget: draft.legacyTarget,
                    rawValue: draft.text,
                    ...(projected.characterIndex === undefined ? {} : { characterIndex: projected.characterIndex }),
                },
            })
            return []
        }

        const claim = input.allocator.claim(undefined, {
            namespace: 'prompt-contribution',
            locator: [input.ownerKind, input.ownerId, 'contribution', index],
            identity: {
                ownerId: input.ownerId,
                legacyTarget: draft.legacyTarget,
                text: draft.text,
                order: draft.order,
            },
        })
        input.counter.generatedIds += 1
        input.counter.migrated += 1
        return [{
            ...revisionFields(input.context),
            id: claim.id,
            orderKey: contributionOrderKey(input.ownerOrder, draft, index),
            enabled: true,
            target: projected.target,
            text: draft.text,
            merge: 'append',
            separator: 'comma-space',
            extensions: {
                legacy: {
                    target: draft.legacyTarget,
                    path: draft.path.map(segment => String(segment)),
                },
            },
        }]
    })
}

function sourceSchemaVersion(profile: UnknownRecord): MigrationReport['sourceSchemaVersion'] {
    return typeof profile.schemaVersion === 'number' && Number.isSafeInteger(profile.schemaVersion)
        ? profile.schemaVersion
        : 'legacy'
}

function counterRecord(): Record<EntityCounterKey, MigrationEntityCounts> {
    return {
        documents: emptyMigrationEntityCounts(1),
        profiles: emptyMigrationEntityCounts(1),
        modules: emptyMigrationEntityCounts(),
        recipes: emptyMigrationEntityCounts(),
        recipeSteps: emptyMigrationEntityCounts(),
        promptContributions: emptyMigrationEntityCounts(),
        orphanTargets: emptyMigrationEntityCounts(),
    }
}

export function migrateV1AssetProfileToV2(
    input: V1AssetProfileMigrationInput,
): V1AssetProfileMigrationResult {
    const issues: MigrationIssue[] = []
    const sourceWasRecord = isRecord(input.profile)
    const profileSource: UnknownRecord = sourceWasRecord ? input.profile as UnknownRecord : {}
    if (!sourceWasRecord && input.profile !== undefined && input.profile !== null) {
        issue(issues, {
            code: 'M_INVALID_SOURCE_REPAIRED',
            severity: 'fatal',
            path: [],
            message: 'Asset Profile source was not an object; produced an empty valid v2 document without mutating the source.',
            repairable: true,
            details: { legacyValue: toJsonValue(input.profile) },
        })
    }
    const context = revisionContext(profileSource, issues)
    const counts = counterRecord()
    counts.profiles.source = sourceWasRecord && Object.keys(profileSource).length > 0 ? 1 : 0
    const allocator = new DeterministicMigrationIdAllocator()

    const documentId = claimPreferredId(
        allocator,
        input.documentId ?? profileSource.documentId,
        'composition-document',
        ['asset-profile', 'document'],
        { source: 'asset-profile-v1' },
        counts.documents,
        issues,
        ['documentId'],
    ).id
    counts.documents.migrated = 1
    const compositionProfileId = claimPreferredId(
        allocator,
        input.profileId ?? profileSource.profileId,
        'composition-profile',
        ['asset-profile', 'profile'],
        { documentId },
        counts.profiles,
        issues,
        ['profileId'],
    ).id
    counts.profiles.migrated = 1

    const moduleEntries = entityEntries(profileSource.modules, ['modules'], issues)
    counts.modules.source = moduleEntries.length
    const moduleKeyToId = new Map<string, string>()
    const moduleLegacyIdToId = new Map<string, string>()
    const moduleClaims = moduleEntries.map(entry => {
        const explicitId = readNonEmptyString(entry.record, 'id')
        const claim = claimPreferredId(
            allocator,
            explicitId,
            'composition-module',
            ['asset-profile', 'modules', entry.index],
            identityWithoutDisplayFields(entry.record),
            counts.modules,
            issues,
            [...entry.path, 'id'],
        )
        counts.modules.migrated += 1
        moduleKeyToId.set(entry.key, claim.id)
        if (explicitId !== undefined && !moduleLegacyIdToId.has(explicitId)) {
            moduleLegacyIdToId.set(explicitId, claim.id)
        }
        return claim
    })

    // Claim every top-level legacy ID before allocating generated nested IDs.
    // This gives existing module/recipe IDs preservation priority.
    const recipeEntries = entityEntries(profileSource.recipes, ['recipes'], issues)
    counts.recipes.source = recipeEntries.length
    const recipeLegacyIdToId = new Map<string, string>()
    const recipeClaims = recipeEntries.map(entry => {
        const explicitId = readNonEmptyString(entry.record, 'id')
        const claim = claimPreferredId(
            allocator,
            explicitId,
            'composition-recipe',
            ['asset-profile', 'recipes', entry.index],
            identityWithoutDisplayFields(entry.record),
            counts.recipes,
            issues,
            [...entry.path, 'id'],
        )
        counts.recipes.migrated += 1
        if (explicitId !== undefined && !recipeLegacyIdToId.has(explicitId)) {
            recipeLegacyIdToId.set(explicitId, claim.id)
        }
        return claim
    })

    const stableCharacterIdsByIndex = (input.stableCharacterIds ?? []).map(id => (
        typeof id === 'string' && id.trim().length > 0 ? id.trim() : undefined
    ))
    const stableCharacterIds = [...new Set(stableCharacterIdsByIndex.filter((id): id is string => id !== undefined))]
    const orphans: LegacyUnknownTargetOrphan[] = []
    const modules: CompositionModule[] = moduleEntries.map((entry, entryIndex) => {
        const claim = moduleClaims[entryIndex]
        const settings = projectSettings(entry.record.settings)
        recordUnknownSettingsIssue(settings, [...entry.path, 'settings'], issues)
        const extraLegacy: JsonObject = {}
        if (claim.duplicate && claim.legacyId !== undefined) extraLegacy.duplicateId = claim.legacyId
        if (entry.record.r2 !== undefined) extraLegacy.r2 = toJsonValue(entry.record.r2)
        if (typeof entry.record.kind === 'string' && !KNOWN_MODULE_KINDS.has(entry.record.kind)) {
            extraLegacy.kind = entry.record.kind
        }
        const extensions = legacyExtensions(settings, extraLegacy)
        const policy = optionalOutputPolicy(entry.record.output)
        return {
            ...revisionFields(context),
            id: claim.id,
            orderKey: `module:${String(entry.index).padStart(6, '0')}`,
            name: readNonEmptyString(entry.record, 'label', 'name') ?? claim.id,
            enabled: typeof entry.record.enabled === 'boolean' ? entry.record.enabled : true,
            kind: moduleKind(entry.record.kind),
            contributions: buildContributions({
                ownerKind: 'module',
                ownerId: claim.id,
                ownerOrder: entry.index,
                record: entry.record,
                path: entry.path,
                context,
                allocator,
                stableCharacterIds: stableCharacterIdsByIndex,
                counter: counts.promptContributions,
                orphanCounter: counts.orphanTargets,
                issues,
                orphans,
            }),
            characterPatches: [],
            ...(settings.params === undefined ? {} : { paramsOverride: settings.params }),
            ...(policy === undefined ? {} : { outputPolicy: policy }),
            resourceBindings: [],
            randomRuleIds: [],
            ...(extensions === undefined ? {} : { extensions }),
        }
    })

    const recipes: CompositionRecipe[] = recipeEntries.map((entry, entryIndex) => {
        const recipeClaim = recipeClaims[entryIndex]
        const rawSteps = Array.isArray(entry.record.steps) ? entry.record.steps : []
        if (entry.record.steps !== undefined && !Array.isArray(entry.record.steps)) {
            issue(issues, {
                code: 'M_INVALID_SOURCE_REPAIRED',
                severity: 'error',
                path: [...entry.path, 'steps'],
                message: 'Recipe steps were not an array and were migrated as an empty collection.',
                repairable: true,
                details: { legacyValue: toJsonValue(entry.record.steps) },
            })
        }
        counts.recipeSteps.source += rawSteps.length
        const steps: RecipeStep[] = rawSteps.map((rawStep, stepIndex) => {
            const stepRecord = isRecord(rawStep) ? rawStep : {}
            const stepPath = [...entry.path, 'steps', stepIndex]
            const rawModuleId = readNonEmptyString(stepRecord, 'moduleId')
            const resolvedModuleId = rawModuleId === undefined
                ? deterministicCompositionMigrationId({
                    namespace: 'missing-module-reference',
                    locator: stepPath,
                    identity: identityWithoutDisplayFields(stepRecord),
                })
                : moduleKeyToId.get(rawModuleId) ?? moduleLegacyIdToId.get(rawModuleId) ?? rawModuleId
            if (rawModuleId === undefined || !modules.some(module => module.id === resolvedModuleId)) {
                issue(issues, {
                    code: 'M_MODULE_REFERENCE_MISSING',
                    severity: 'error',
                    path: [...stepPath, 'moduleId'],
                    message: 'Recipe step module reference could not be resolved and was retained for repair.',
                    repairable: true,
                    details: {
                        migratedModuleId: resolvedModuleId,
                        ...(rawModuleId === undefined ? {} : { legacyModuleId: rawModuleId }),
                    },
                })
            }
            const stepClaim = claimPreferredId(
                allocator,
                stepRecord.id,
                'composition-recipe-step',
                ['asset-profile', 'recipes', recipeClaim.id, 'steps', stepIndex],
                identityWithoutDisplayFields(stepRecord),
                counts.recipeSteps,
                issues,
                [...stepPath, 'id'],
            )
            counts.recipeSteps.migrated += 1
            const settings = projectSettings(stepRecord.settings)
            recordUnknownSettingsIssue(settings, [...stepPath, 'settings'], issues)
            const extraLegacy: JsonObject = {}
            if (rawModuleId !== undefined && rawModuleId !== resolvedModuleId) extraLegacy.moduleId = rawModuleId
            const extensions = legacyExtensions(settings, extraLegacy)
            const policy = optionalOutputPolicy(stepRecord.output)
            return {
                ...revisionFields(context),
                id: stepClaim.id,
                orderKey: `recipe-step:${String(entry.index).padStart(6, '0')}:${String(stepIndex).padStart(6, '0')}`,
                moduleId: resolvedModuleId,
                enabled: typeof stepRecord.enabled === 'boolean' ? stepRecord.enabled : true,
                contributions: buildContributions({
                    ownerKind: 'recipe-step',
                    ownerId: stepClaim.id,
                    ownerOrder: stepIndex,
                    record: stepRecord,
                    path: stepPath,
                    context,
                    allocator,
                    stableCharacterIds: stableCharacterIdsByIndex,
                    counter: counts.promptContributions,
                    orphanCounter: counts.orphanTargets,
                    issues,
                    orphans,
                }),
                characterPatches: [],
                ...(settings.params === undefined ? {} : { paramsOverride: settings.params }),
                ...(policy === undefined ? {} : { outputPolicy: policy }),
                resourceBindings: [],
                randomRuleIds: [],
                ...(extensions === undefined ? {} : { extensions }),
            }
        })

        const settings = projectSettings(entry.record.settings)
        recordUnknownSettingsIssue(settings, [...entry.path, 'settings'], issues)
        const extraLegacy: JsonObject = {}
        if (recipeClaim.duplicate && recipeClaim.legacyId !== undefined) {
            extraLegacy.duplicateId = recipeClaim.legacyId
        }
        if (entry.record.r2 !== undefined) extraLegacy.r2 = toJsonValue(entry.record.r2)
        const extensions = legacyExtensions(settings, extraLegacy)
        const policy = optionalOutputPolicy(entry.record.output)
        return {
            ...revisionFields(context),
            id: recipeClaim.id,
            orderKey: `recipe:${String(entry.index).padStart(6, '0')}`,
            name: readNonEmptyString(entry.record, 'label', 'name') ?? recipeClaim.id,
            enabled: typeof entry.record.enabled === 'boolean' ? entry.record.enabled : true,
            steps,
            ...(settings.params === undefined ? {} : { paramsOverride: settings.params }),
            ...(policy === undefined ? {} : { outputPolicy: policy }),
            ...(extensions === undefined ? {} : { extensions }),
        }
    })

    const profileSettings = projectSettings(profileSource.settings)
    recordUnknownSettingsIssue(profileSettings, ['settings'], issues)
    const topLevelUnknown: JsonObject = {}
    for (const [key, value] of Object.entries(profileSource)) {
        if (!PROFILE_KNOWN_KEYS.has(key)) topLevelUnknown[key] = toJsonValue(value)
    }
    const legacyDocumentData: JsonObject = {
        source: 'asset-profile-v1',
        updatedBy: typeof profileSource.updatedBy === 'string' ? profileSource.updatedBy : 'system',
    }
    if (profileSource.r2 !== undefined) legacyDocumentData.r2 = toJsonValue(profileSource.r2)
    if (Object.keys(topLevelUnknown).length > 0) legacyDocumentData.unknownFields = topLevelUnknown
    if (orphans.length > 0) legacyDocumentData.unknownTargets = toJsonValue(orphans)
    const profileExtensions = legacyExtensions(profileSettings)
    const explicitDefaultRecipeId = readNonEmptyString(profileSource, 'defaultRecipeId')
    const defaultRecipeId = explicitDefaultRecipeId === undefined
        ? recipes.find(recipe => recipe.enabled)?.id
        : recipeLegacyIdToId.get(explicitDefaultRecipeId) ?? explicitDefaultRecipeId

    const profile: CompositionProfile = {
        ...revisionFields(context),
        id: compositionProfileId,
        orderKey: 'profile:000000',
        name: isRecord(profileSource.settings)
            ? readNonEmptyString(profileSource.settings, 'name') ?? 'Migrated Asset Profile'
            : 'Migrated Asset Profile',
        enabled: true,
        moduleIds: modules.map(module => module.id),
        recipeIds: recipes.map(recipe => recipe.id),
        characterIds: stableCharacterIds,
        paramsPresetIds: [],
        resourceBindings: [],
        randomRuleIds: [],
        ...(defaultRecipeId === undefined ? {} : { defaultRecipeId }),
        contributions: [],
        characterPatches: [],
        ...(profileSettings.params === undefined ? {} : { paramsOverride: profileSettings.params }),
        outputPolicy: outputPolicy(profileSource.output),
        ...(profileExtensions === undefined ? {} : { extensions: profileExtensions }),
    }

    const document: CompositionDocument = {
        ...revisionFields(context),
        id: documentId,
        schemaVersion: COMPOSITION_SCHEMA_VERSION,
        profiles: [profile],
        modules,
        recipes,
        characters: [],
        paramsPresets: [],
        resources: [],
        randomRules: [],
        activeProfileId: compositionProfileId,
        extensions: { legacy: legacyDocumentData },
    }

    const sourceCounts: Record<string, number> = {
        documents: sourceWasRecord ? 1 : 0,
        profiles: counts.profiles.source,
        modules: counts.modules.source,
        recipes: counts.recipes.source,
        recipeSteps: counts.recipeSteps.source,
        promptContributions: counts.promptContributions.source,
        orphanTargets: 0,
    }
    const targetCounts: Record<string, number> = {
        documents: 1,
        profiles: document.profiles.length,
        modules: document.modules.length,
        recipes: document.recipes.length,
        recipeSteps: document.recipes.reduce((total, recipe) => total + recipe.steps.length, 0),
        promptContributions: document.modules.reduce((total, module) => total + module.contributions.length, 0)
            + document.recipes.reduce(
                (total, recipe) => total + recipe.steps.reduce((stepTotal, step) => stepTotal + step.contributions.length, 0),
                0,
            ),
        orphanTargets: orphans.length,
    }
    const report: MigrationReport = {
        migrationId: V1_ASSET_PROFILE_MIGRATION_ID,
        sourceSchemaVersion: sourceSchemaVersion(profileSource),
        targetSchemaVersion: COMPOSITION_SCHEMA_VERSION,
        changed: true,
        fatal: migrationHasFatalIssues(issues),
        sourceCounts,
        targetCounts,
        sourceHash: hashCanonicalValue(toJsonValue(input.profile)),
        targetHash: hashCanonicalValue(document),
        entityCounts: counts,
        issues,
        ignoredKeys: [],
    }
    return { document, report, orphans }
}
