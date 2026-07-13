import { hashCanonicalValue } from '../canonical-serialize'
import { safeParseCompositionDocument } from '../schema'
import type {
    ActorRef,
    CharacterDefinition,
    CompositionDocument,
    CompositionModule,
    CompositionProfile,
    CompositionRecipe,
    IsoTimestamp,
    JsonObject,
    ParamsPreset,
    PromptContribution,
    RecipeStep,
} from '../types'
import { COMPOSITION_SCHEMA_VERSION } from '../types'
import { validateCompositionSemantics } from '../validation'
import {
    projectCharacterPromptsToV2,
    type CharacterTemplateGroupSnapshot,
    type CharacterTemplatePresetSnapshot,
} from '@/lib/composition/character-prompt-adapter'
import {
    migrateCharacterPromptPersistedState,
} from '@/lib/composition/character-prompt-migration'
import {
    projectLegacyParamsPresets,
} from '@/lib/composition/params-preset-adapter'
import {
    migrateGenerationPresetPersistedState,
} from '@/lib/composition/preset-store-migration'
import { DeterministicMigrationIdAllocator } from './deterministic-id'
import {
    emptyMigrationEntityCounts,
    migrationHasFatalIssues,
    type MigrationEntityCounts,
    type MigrationIssue,
    type MigrationReport,
} from './report-types'
import {
    migrateV1AssetProfileToV2,
    type LegacyUnknownTargetOrphan,
} from './v1-asset-profile-to-v2'

const MIGRATION_ID = 'legacy-stores-to-composition-v2' as const
const MIGRATED_FRAGMENT_STORE_SCHEMA_VERSION = 2 as const
const MIGRATED_FRAGMENT_FILE_SCHEMA_VERSION = 2 as const
const MIGRATED_FRAGMENT_SEQUENCE_SCHEMA_VERSION = 1 as const

export const LEGACY_COMPOSITION_STORE_ALIASES = Object.freeze({
    scenes: ['nais2-scenes', 'scenes', 'scene-store'],
    scenePrompts: ['nais2-scene-prompts', 'scene-prompts', 'scenePrompts'],
    fragments: ['nais2-wildcards', 'wildcards', 'fragments'],
    fragmentContent: ['nais2-wildcard-content', 'wildcard-content', 'fragmentContent'],
    characterPrompts: ['nais2-character-prompts', 'character-prompts', 'characterPrompts'],
    characterPositions: ['nais2-character-positions', 'character-positions', 'characterPositions'],
    generationPresets: ['nais2-presets', 'generation-presets', 'generationPresets'],
    promptPresets: ['nais2-prompt-library', 'novelaiPromptEditorState', 'prompt-presets', 'promptPresets'],
    assetProfile: ['nais2-asset-modules', 'asset-profile', 'assetProfile'],
} as const)

const STORE_ALIASES = LEGACY_COMPOSITION_STORE_ALIASES

const KNOWN_STORE_KEYS: ReadonlySet<string> = new Set<string>(Object.values(STORE_ALIASES).flat())

export interface LegacyStoresMigrationInput {
    /** Named Zustand/legacy store payloads. Persist wrappers are accepted. */
    stores?: Readonly<Record<string, unknown>>
    /** Raw export, record map, or array of IndexedDB snapshot entries. */
    indexedDbSnapshots?: unknown
    scenes?: unknown
    scenePrompts?: unknown
    fragments?: unknown
    fragmentContent?: unknown
    characterPrompts?: unknown
    characterPositions?: unknown
    generationPresets?: unknown
    promptPresets?: unknown
    assetProfileJson?: unknown
}

export interface MigratedSceneCardSidecar {
    id: string
    name: string
    scenePrompt: string
    queueCount: number
    width?: number
    height?: number
    excludePinned?: boolean
    createdAt: number
    compositionRef: {
        recipeId: string
        selectionKind: 'asset'
        recipeRevision: number
        migrationMarker: {
            kind: 'legacy-scene-prompt'
            schemaVersion: 2
        }
        extensions?: JsonObject
    }
    extensions?: JsonObject
}

export interface MigratedScenePresetSidecar {
    id: string
    name: string
    createdAt: number
    scenes: MigratedSceneCardSidecar[]
}

export interface MigratedSceneStoreSidecar {
    presets: MigratedScenePresetSidecar[]
    activePresetId: string | null
}

export interface MigratedFragmentSidecar {
    schemaVersion: typeof MIGRATED_FRAGMENT_STORE_SCHEMA_VERSION
    meta: MigratedFragmentFileMeta[]
    contents: Record<string, string[]>
    sequenceState: MigratedFragmentSequenceState
}

export interface MigratedFragmentFileMeta {
    schemaVersion: typeof MIGRATED_FRAGMENT_FILE_SCHEMA_VERSION
    id: string
    contentKey: string
    name: string
    folder: string
    lineCount: number
    createdAt: number
    updatedAt: number
}

export interface MigratedFragmentSequenceState {
    schemaVersion: typeof MIGRATED_FRAGMENT_SEQUENCE_SCHEMA_VERSION
    revision: number
    counters: Record<string, number>
}

export interface MigratedPromptWindowSidecar {
    id: string
    title: string
    text: string
    excluded: boolean
}

export interface MigratedPromptTabSidecar {
    id: string
    name: string
    windows: MigratedPromptWindowSidecar[]
}

export interface MigratedPromptPresetSidecar {
    tabs: MigratedPromptTabSidecar[]
    activeLeftId: string | null
    activeRightId: string | null
}

export interface LegacyStoresMigrationSidecars {
    scenes: MigratedSceneStoreSidecar
    fragments: MigratedFragmentSidecar
    promptPresets: MigratedPromptPresetSidecar
    assetProfileOrphans: LegacyUnknownTargetOrphan[]
    ignoredLegacyKeys: string[]
}

export interface LegacyStoresMigrationResult {
    document: CompositionDocument
    report: MigrationReport
    /** Detached raw source retained for rollback; migration never writes into it. */
    rawSources: LegacyStoresMigrationInput
    sidecars: LegacyStoresMigrationSidecars
}

type UnknownRecord = Record<string, unknown>

interface EntityFields {
    revision: number
    createdAt: IsoTimestamp
    createdBy: ActorRef
    updatedAt: IsoTimestamp
    updatedBy: ActorRef
}

interface StableRecordResult {
    records: UnknownRecord[]
    originalIds: Array<string | undefined>
    generatedIds: number
    repairedIds: number
}

interface SceneProjectionResult {
    sidecar: MigratedSceneStoreSidecar
    modules: CompositionModule[]
    recipes: CompositionRecipe[]
}

interface PromptPresetProjectionResult {
    sidecar: MigratedPromptPresetSidecar
    modules: CompositionModule[]
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeInteger(value: unknown, fallback = 0): number {
    const number = finiteNumber(value)
    return number === undefined ? fallback : Math.trunc(number)
}

function timestampNumber(value: unknown): number {
    return Math.max(0, safeInteger(value, 0))
}

function orderKey(namespace: string, index: number): string {
    return `${namespace}:${String(index).padStart(8, '0')}`
}

function unwrapPersistedState(value: unknown): unknown {
    let current = value
    if (typeof current === 'string' && /^[\s]*[{[]/.test(current)) {
        try {
            current = JSON.parse(current) as unknown
        } catch {
            // Invalid JSON remains a raw rollback source and projects as empty.
        }
    }
    for (let depth = 0; depth < 3; depth += 1) {
        if (!isRecord(current) || !('state' in current)) break
        current = current.state
    }
    return current
}

function identityValueWithoutDisplay(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(identityValueWithoutDisplay)
    if (!isRecord(value)) return value
    const result: UnknownRecord = {}
    for (const [key, item] of Object.entries(value)) {
        if (['id', 'name', 'title', 'label', 'displayName'].includes(key)) continue
        result[key] = identityValueWithoutDisplay(item)
    }
    return result
}

function identityWithoutDisplay(record: UnknownRecord): UnknownRecord {
    return identityValueWithoutDisplay(record) as UnknownRecord
}

function detachedInput(input: LegacyStoresMigrationInput, issues: MigrationIssue[]): LegacyStoresMigrationInput {
    try {
        return structuredClone(input)
    } catch (error) {
        issues.push({
            code: 'M_RAW_SOURCE_NOT_CLONEABLE',
            severity: 'fatal',
            path: [],
            message: 'Raw migration input is not structured-cloneable; old authority must remain active.',
            repairable: false,
            details: { error: error instanceof Error ? error.message : String(error) },
        })
        return {}
    }
}

function collectSnapshotStores(
    value: unknown,
    stores: Map<string, unknown>,
    seen: WeakSet<object> = new WeakSet(),
): void {
    if (value !== null && typeof value === 'object') {
        if (seen.has(value)) return
        seen.add(value)
    }
    if (Array.isArray(value)) {
        for (const entry of value) collectSnapshotStores(entry, stores, seen)
        return
    }
    if (!isRecord(value)) return

    const entryKey = nonEmptyString(value.storeKey)
        ?? nonEmptyString(value.key)
        ?? nonEmptyString(value.name)
        ?? nonEmptyString(value.dbName)
    if (entryKey !== undefined) {
        const payload = value.value
            ?? value.payload
            ?? value.data
            ?? value.snapshot
            ?? value.stores
            ?? value.objectStores
        if (payload !== undefined && !stores.has(entryKey)) stores.set(entryKey, payload)
    }

    for (const containerKey of ['stores', 'snapshots', 'entries']) {
        const container = value[containerKey]
        if (container !== undefined) collectSnapshotStores(container, stores, seen)
    }

    for (const [key, payload] of Object.entries(value)) {
        if (key.startsWith('_') || key === 'stores' || key === 'snapshots' || key === 'entries') continue
        if (KNOWN_STORE_KEYS.has(key) || key.startsWith('nais2-') || /marketplace|supabase/i.test(key)) {
            if (!stores.has(key)) stores.set(key, payload)
        }
    }
}

function collectNamedStores(input: LegacyStoresMigrationInput): Map<string, unknown> {
    const stores = new Map<string, unknown>()
    collectSnapshotStores(input.indexedDbSnapshots, stores)
    for (const [key, value] of Object.entries(input.stores ?? {})) stores.set(key, value)
    return stores
}

function readStore(
    explicit: unknown,
    aliases: readonly string[],
    stores: ReadonlyMap<string, unknown>,
): unknown {
    if (explicit !== undefined) return explicit
    for (const key of aliases) {
        if (stores.has(key)) return stores.get(key)
    }
    return undefined
}

function reportMalformedJsonSource(
    sourceName: string,
    value: unknown,
    issues: MigrationIssue[],
): void {
    if (typeof value !== 'string') return
    try {
        JSON.parse(value)
    } catch (error) {
        issues.push({
            code: 'M_INVALID_SOURCE_JSON',
            severity: 'fatal',
            path: [sourceName],
            message: `${sourceName} contains invalid serialized JSON; old authority must remain active.`,
            repairable: false,
            details: { error: error instanceof Error ? error.message : String(error) },
        })
    }
}

function stableRecords(
    values: readonly unknown[],
    namespace: string,
    locator: readonly (string | number)[],
    issues: MigrationIssue[],
    reservedIds: readonly string[] = [],
): StableRecordResult {
    const records = values.map(value => isRecord(value) ? value : {})
    const allocator = new DeterministicMigrationIdAllocator(reservedIds)
    const originalIds: Array<string | undefined> = []
    let generatedIds = 0
    let repairedIds = 0
    const migrated = records.map((record, index) => {
        const preferredId = nonEmptyString(record.id)
        originalIds.push(preferredId)
        const claim = allocator.claim(preferredId, {
            namespace,
            locator: [...locator, index],
            identity: identityWithoutDisplay(record),
        })
        if (claim.generated) {
            generatedIds += 1
            if (claim.duplicate) repairedIds += 1
            issues.push({
                code: claim.duplicate ? 'M_DUPLICATE_ID_REPAIRED' : 'M_ID_GENERATED',
                severity: 'warning',
                path: [...locator, index, 'id'],
                message: claim.duplicate
                    ? `Duplicate ${namespace} ID was replaced deterministically.`
                    : `Missing ${namespace} ID was generated deterministically.`,
                repairable: true,
                details: {
                    generatedId: claim.id,
                    ...(claim.legacyId === undefined ? {} : { legacyId: claim.legacyId }),
                },
            })
        }
        return { ...record, id: claim.id }
    })
    return { records: migrated, originalIds, generatedIds, repairedIds }
}

function combineCounts(
    target: Record<string, MigrationEntityCounts>,
    source: Readonly<Record<string, MigrationEntityCounts>>,
): void {
    for (const [key, value] of Object.entries(source)) {
        const current = target[key] ?? emptyMigrationEntityCounts()
        target[key] = {
            source: current.source + value.source,
            migrated: current.migrated + value.migrated,
            generatedIds: current.generatedIds + value.generatedIds,
            repairedIds: current.repairedIds + value.repairedIds,
            orphaned: current.orphaned + value.orphaned,
        }
    }
}

function documentEntityIds(document: CompositionDocument): string[] {
    return [
        document.id,
        ...document.profiles.flatMap(profile => [
            profile.id,
            ...profile.contributions.map(item => item.id),
        ]),
        ...document.modules.flatMap(module => [
            module.id,
            ...module.contributions.map(item => item.id),
        ]),
        ...document.recipes.flatMap(recipe => [
            recipe.id,
            ...recipe.steps.flatMap(step => [step.id, ...step.contributions.map(item => item.id)]),
        ]),
        ...document.characters.map(item => item.id),
        ...document.paramsPresets.map(item => item.id),
        ...document.resources.map(item => item.id),
        ...document.randomRules.flatMap(rule => [
            rule.id,
            ...(rule.kind === 'choice' ? rule.options.map(option => option.id) : []),
        ]),
    ]
}

function entityFields(document: CompositionDocument): EntityFields {
    return {
        revision: document.revision,
        createdAt: document.createdAt,
        createdBy: document.createdBy,
        updatedAt: document.updatedAt,
        updatedBy: document.updatedBy,
    }
}

function extractAssetProfile(value: unknown): unknown {
    const state = unwrapPersistedState(value)
    return isRecord(state) && state.profile !== undefined ? state.profile : state
}

function assetProfileReservedIds(value: unknown): string[] {
    const profile = extractAssetProfile(value)
    if (!isRecord(profile)) return []
    const result: string[] = []
    const modules = isRecord(profile.modules) ? profile.modules : {}
    for (const rawModule of Object.values(modules)) {
        if (isRecord(rawModule)) {
            const id = nonEmptyString(rawModule.id)
            if (id !== undefined) result.push(id)
        }
    }
    if (Array.isArray(profile.recipes)) {
        for (const rawRecipe of profile.recipes) {
            if (!isRecord(rawRecipe)) continue
            const id = nonEmptyString(rawRecipe.id)
            if (id !== undefined) result.push(id)
        }
    }
    return [...new Set(result)]
}

function normalizeCharacterTemplates(
    values: readonly unknown[],
    kind: 'preset' | 'group',
    issues: MigrationIssue[],
): UnknownRecord[] {
    return stableRecords(values, `character-template-${kind}`, ['characterPrompts', `${kind}s`], issues).records
}

function templatePresets(values: readonly unknown[], issues: MigrationIssue[]): CharacterTemplatePresetSnapshot[] {
    return normalizeCharacterTemplates(values, 'preset', issues).map(record => ({
        id: stringValue(record.id),
        name: stringValue(record.name, stringValue(record.id)),
        prompt: stringValue(record.prompt),
        negative: stringValue(record.negative),
        ...(nonEmptyString(record.groupId) === undefined ? {} : { groupId: nonEmptyString(record.groupId) }),
    }))
}

function templateGroups(values: readonly unknown[], issues: MigrationIssue[]): CharacterTemplateGroupSnapshot[] {
    return normalizeCharacterTemplates(values, 'group', issues).map(record => ({
        id: stringValue(record.id),
        name: stringValue(record.name, stringValue(record.id)),
        collapsed: record.collapsed === true,
        colorIndex: Math.max(0, safeInteger(record.colorIndex, 0)),
    }))
}

function prepareCharacterRecords(
    source: unknown,
    positionSource: unknown,
    reservedIds: readonly string[],
    issues: MigrationIssue[],
): {
    state: ReturnType<typeof migrateCharacterPromptPersistedState>
    records: StableRecordResult
} {
    const state = unwrapPersistedState(source)
    const rawState = isRecord(state) ? state : {}
    const rawCharacters = Array.isArray(rawState.characters) ? rawState.characters : []
    const separatePositions = collectCharacterPositions(positionSource)
    const positionedCharacters = rawCharacters.map((value, index) => {
        const record = isRecord(value) ? value : {}
        const legacyId = nonEmptyString(record.id)
        const separate = separatePositions.positionsByIndex.get(index)
            ?? (legacyId === undefined ? undefined : separatePositions.positionsById.get(legacyId))
        return separate === undefined ? record : { ...record, position: separate }
    })
    const records = stableRecords(
        positionedCharacters,
        'character',
        ['characterPrompts', 'characters'],
        issues,
        reservedIds,
    )
    return {
        state: migrateCharacterPromptPersistedState({
            ...rawState,
            ...(typeof rawState.positionEnabled === 'boolean'
                ? {}
                : separatePositions.positionEnabled === undefined
                    ? {}
                    : { positionEnabled: separatePositions.positionEnabled }),
            characters: records.records,
        }),
        records,
    }
}

function collectCharacterPositions(value: unknown): {
    positionsById: Map<string, unknown>
    positionsByIndex: Map<number, unknown>
    positionEnabled?: boolean
} {
    const state = unwrapPersistedState(value)
    const record = isRecord(state) ? state : {}
    const source = record.positions ?? state
    const positionsById = new Map<string, unknown>()
    const positionsByIndex = new Map<number, unknown>()
    if (Array.isArray(source)) {
        source.forEach((position, index) => {
            if (isRecord(position)) {
                const id = nonEmptyString(position.characterId) ?? nonEmptyString(position.id)
                if (id !== undefined) positionsById.set(id, position.position ?? position)
            }
            positionsByIndex.set(index, isRecord(position) ? position.position ?? position : position)
        })
    } else if (isRecord(source)) {
        for (const [key, position] of Object.entries(source)) {
            if (/^\d+$/.test(key)) positionsByIndex.set(Number(key), position)
            else positionsById.set(key, position)
        }
    }
    return {
        positionsById,
        positionsByIndex,
        ...(typeof record.positionEnabled === 'boolean' ? { positionEnabled: record.positionEnabled } : {}),
    }
}

function repairCharacterDocumentCollisions(
    records: readonly UnknownRecord[],
    reservedIds: readonly string[],
    issues: MigrationIssue[],
): StableRecordResult {
    return stableRecords(
        records,
        'character',
        ['characterPrompts', 'characters'],
        issues,
        reservedIds,
    )
}

function projectCharacters(
    state: ReturnType<typeof migrateCharacterPromptPersistedState>,
    records: readonly UnknownRecord[],
    document: CompositionDocument,
    issues: MigrationIssue[],
): {
    characters: CharacterDefinition[]
    templateExtensions: JsonObject
} {
    const presets = templatePresets(state.presets, issues)
    const groups = templateGroups(state.groups, issues)
    const projection = projectCharacterPromptsToV2({
        characters: records,
        positionEnabled: state.positionEnabled,
        presets,
        groups,
        context: {
            revision: document.revision,
            timestamp: document.updatedAt,
            actor: document.updatedBy,
        },
    })
    for (const error of projection.errors) {
        issues.push({
            code: 'M_CHARACTER_POSITION_REPAIR_REQUIRED',
            severity: 'error',
            path: [...error.fieldPath],
            message: error.messageKey,
            repairable: true,
            details: { source: error.sourceRef.kind },
        })
    }
    return {
        characters: projection.characters,
        templateExtensions: projection.templateExtensions,
    }
}

function projectParamsPresets(
    source: unknown,
    document: CompositionDocument,
    allocator: DeterministicMigrationIdAllocator,
    issues: MigrationIssue[],
): {
    presets: ParamsPreset[]
    activePresetId?: string
    counts: MigrationEntityCounts
} {
    const state = unwrapPersistedState(source)
    const rawState = isRecord(state) ? state : {}
    const rawPresets = Array.isArray(rawState.presets) ? rawState.presets : []
    const prepared = stableRecords(
        rawPresets,
        'params-preset',
        ['generationPresets', 'presets'],
        issues,
    )
    const migrated = migrateGenerationPresetPersistedState({
        ...rawState,
        presets: prepared.records,
    })
    const rawActiveId = nonEmptyString(rawState.activePresetId)
    const activePreparedId = rawActiveId === undefined
        ? migrated.activePresetId
        : prepared.records.find((_, index) => prepared.originalIds[index] === rawActiveId)?.id
            ?? migrated.activePresetId
    const projected = projectLegacyParamsPresets(migrated.presets, {
        revision: document.revision,
        timestamp: document.updatedAt,
        actor: document.updatedBy,
    })
    let generatedIds = prepared.generatedIds
    let repairedIds = prepared.repairedIds
    let activePresetId: string | undefined
    const presets = projected.map((preset, index) => {
        const migratedPresetValue: unknown = migrated.presets[index]
        const migratedPreset = isRecord(migratedPresetValue) ? migratedPresetValue : {}
        const claim = allocator.claim(preset.id, {
            namespace: 'params-preset',
            locator: ['generationPresets', 'presets', index],
            identity: identityWithoutDisplay(migratedPreset),
        })
        if (claim.generated) {
            generatedIds += 1
            if (claim.duplicate) repairedIds += 1
            issues.push({
                code: claim.duplicate ? 'M_DUPLICATE_ID_REPAIRED' : 'M_ID_GENERATED',
                severity: 'warning',
                path: ['generationPresets', 'presets', index, 'id'],
                message: 'Generation preset ID conflicted with the document entity namespace and was repaired.',
                repairable: true,
                details: { generatedId: claim.id, legacyId: preset.id },
            })
        }
        if (preset.id === activePreparedId) activePresetId = claim.id
        return {
            ...preset,
            id: claim.id,
            extensions: {
                ...(preset.extensions ?? {}),
                legacyPromptTemplate: {
                    base: stringValue(migratedPreset.basePrompt),
                    additional: stringValue(migratedPreset.additionalPrompt),
                    detail: stringValue(migratedPreset.detailPrompt),
                    negative: stringValue(migratedPreset.negativePrompt),
                },
            },
        }
    })
    if (activePresetId === undefined && presets.length > 0) activePresetId = presets[0].id
    return {
        presets,
        ...(activePresetId === undefined ? {} : { activePresetId }),
        counts: {
            source: rawPresets.length,
            migrated: presets.length,
            generatedIds,
            repairedIds,
            orphaned: 0,
        },
    }
}

function normalizeContentLines(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null
    return value.filter((line): line is string => typeof line === 'string')
}

function strictContentLines(value: unknown): string[] | null {
    return Array.isArray(value) && value.every(line => typeof line === 'string')
        ? [...value]
        : null
}

function collectFragmentContent(
    value: unknown,
    result: Map<string, string[]>,
    seen: WeakSet<object> = new WeakSet(),
): void {
    if (value !== null && typeof value === 'object') {
        if (seen.has(value)) return
        seen.add(value)
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === 'string') {
                const lines = strictContentLines(entry[1])
                if (lines !== null) result.set(entry[0], lines)
                continue
            }
            if (isRecord(entry)) {
                const key = nonEmptyString(entry.key) ?? nonEmptyString(entry.id) ?? nonEmptyString(entry.contentKey)
                const lines = strictContentLines(entry.value ?? entry.lines ?? entry.content)
                if (key !== undefined && lines !== null) result.set(key, lines)
            }
        }
        return
    }
    if (!isRecord(value)) return

    for (const key of ['contents', 'records', 'entries', 'values']) {
        if (value[key] !== undefined) collectFragmentContent(value[key], result, seen)
    }
    if (isRecord(value.stores)) {
        collectFragmentContent(value.stores.contents ?? value.stores["nais2-wildcard-content"], result, seen)
    }
    if (isRecord(value.objectStores)) {
        collectFragmentContent(value.objectStores.contents, result, seen)
    }

    for (const [key, rawLines] of Object.entries(value)) {
        if (['contents', 'records', 'entries', 'values', 'stores', 'objectStores'].includes(key)) continue
        const lines = strictContentLines(rawLines)
        if (lines !== null) result.set(key, lines)
    }
}

interface InternalMigratedFragmentFile extends MigratedFragmentFileMeta {
    content?: string[]
}

function normalizeFragmentFolder(value: unknown): string {
    return stringValue(value)
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .replace(/\s*\/\s*/g, '/')
}

function normalizedCounters(value: unknown): Record<string, number> {
    if (!isRecord(value)) return {}
    const result: Record<string, number> = {}
    for (const [key, candidate] of Object.entries(value)) {
        if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) {
            result[key] = candidate
        }
    }
    return result
}

function migratePreparedFragmentMetadata(
    preparedFiles: readonly UnknownRecord[],
    rawState: UnknownRecord,
): {
    files: InternalMigratedFragmentFile[]
    sequenceState: MigratedFragmentSequenceState
} {
    const files = preparedFiles.map((record): InternalMigratedFragmentFile => {
        const id = stringValue(record.id)
        const content = normalizeContentLines(record.content)
        return {
            schemaVersion: MIGRATED_FRAGMENT_FILE_SCHEMA_VERSION,
            id,
            contentKey: nonEmptyString(record.contentKey) ?? id,
            name: stringValue(record.name).trim(),
            folder: normalizeFragmentFolder(record.folder),
            lineCount: Math.max(0, safeInteger(record.lineCount, content?.length ?? 0)),
            createdAt: timestampNumber(record.createdAt),
            updatedAt: timestampNumber(record.updatedAt),
            ...(content === null ? {} : { content }),
        }
    })
    const rawSequence = isRecord(rawState.sequenceState) ? rawState.sequenceState : {}
    const canonicalCounters = normalizedCounters(rawSequence.counters)
    const legacyCounters = normalizedCounters(rawState.sequentialCounters)
    const normalizedLegacy = new Map(
        Object.entries(legacyCounters).map(([key, value]) => [normalizeFragmentFolder(key).toLowerCase(), value]),
    )
    const counters: Record<string, number> = {}
    for (const file of files) {
        const path = normalizeFragmentFolder(file.folder ? `${file.folder}/${file.name}` : file.name)
        const counter = canonicalCounters[file.id]
            ?? canonicalCounters[file.contentKey]
            ?? legacyCounters[file.id]
            ?? legacyCounters[file.contentKey]
            ?? legacyCounters[path]
            ?? normalizedLegacy.get(path.toLowerCase())
            ?? normalizedLegacy.get(file.name.toLowerCase())
        counters[file.id] = counter ?? 0
    }
    return {
        files,
        sequenceState: {
            schemaVersion: MIGRATED_FRAGMENT_SEQUENCE_SCHEMA_VERSION,
            revision: Math.max(0, safeInteger(rawSequence.revision, 0)),
            counters,
        },
    }
}

function projectFragments(
    metadataSource: unknown,
    contentSources: readonly unknown[],
    issues: MigrationIssue[],
): {
    sidecar: MigratedFragmentSidecar
    counts: MigrationEntityCounts
} {
    const fragmentIssueStart = issues.length
    const state = unwrapPersistedState(metadataSource)
    const rawState = isRecord(state) ? state : {}
    const rawFiles = Array.isArray(rawState.files)
        ? rawState.files
        : Array.isArray(rawState.meta)
            ? rawState.meta
            : []
    const prepared = stableRecords(
        rawFiles,
        'fragment',
        ['fragments', 'files'],
        issues,
    )
    const preparedFiles = prepared.records.map((record, index) => {
        const originalId = prepared.originalIds[index]
        const explicitContentKey = nonEmptyString(record.contentKey)
        return {
            ...record,
            contentKey: explicitContentKey ?? originalId ?? stringValue(record.id),
        }
    })
    const migrated = migratePreparedFragmentMetadata(preparedFiles, rawState)
    const separateContent = new Map<string, string[]>()
    if (rawState.contents !== undefined) collectFragmentContent(rawState.contents, separateContent)
    for (const source of contentSources) collectFragmentContent(source, separateContent)
    const contents: Record<string, string[]> = {}
    const consumedContentKeys = new Set<string>()
    const meta: MigratedFragmentFileMeta[] = migrated.files.map((file, index) => {
        const embedded = normalizeContentLines(file.content)
        const canonicalPath = file.folder ? `${file.folder}/${file.name}` : file.name
        const matchedKey = [file.contentKey, file.id, canonicalPath]
            .find(key => separateContent.has(key))
        const separate = matchedKey === undefined ? undefined : separateContent.get(matchedKey)
        if (matchedKey !== undefined) consumedContentKeys.add(matchedKey)
        const content = separate ?? embedded ?? []
        contents[file.id] = [...content]
        if (separate === undefined && embedded === null && file.lineCount > 0) {
            issues.push({
                code: 'M_FRAGMENT_CONTENT_MISSING',
                severity: 'error',
                path: ['fragments', 'files', index, 'contentKey'],
                message: 'Fragment metadata was retained, but its separate content record was not present.',
                repairable: true,
                details: {
                    fragmentId: file.id,
                    contentKey: file.contentKey,
                    expectedLineCount: file.lineCount,
                },
            })
        }
        if (separate !== undefined && embedded !== null && hashCanonicalValue(separate) !== hashCanonicalValue(embedded)) {
            issues.push({
                code: 'M_FRAGMENT_SEPARATE_CONTENT_PREFERRED',
                severity: 'info',
                path: ['fragments', 'files', index, 'content'],
                message: 'Separate IndexedDB fragment content was newer or different and remained authoritative.',
                repairable: true,
                details: { fragmentId: file.id, contentKey: file.contentKey },
            })
        }
        return {
            schemaVersion: file.schemaVersion,
            id: file.id,
            contentKey: file.contentKey,
            name: file.name,
            folder: file.folder,
            lineCount: content.length,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
        }
    })
    const contentOnlyEntries = [...separateContent.entries()]
        .filter(([contentKey]) => !consumedContentKeys.has(contentKey))
        .sort(([left], [right]) => left.localeCompare(right))
    const recoveredIdAllocator = new DeterministicMigrationIdAllocator(meta.map(file => file.id))
    contentOnlyEntries.forEach(([contentKey, lines], index) => {
        const claim = recoveredIdAllocator.claim(undefined, {
            namespace: 'fragment',
            locator: ['fragments', 'content-only', contentKey],
            identity: { contentKey },
        })
        meta.push({
            schemaVersion: MIGRATED_FRAGMENT_FILE_SCHEMA_VERSION,
            id: claim.id,
            contentKey,
            name: `recovered-${String(index + 1).padStart(4, '0')}.txt`,
            folder: '_recovered',
            lineCount: lines.length,
            createdAt: 0,
            updatedAt: 0,
        })
        contents[claim.id] = [...lines]
        migrated.sequenceState.counters[claim.id] = 0
        issues.push({
            code: 'M_FRAGMENT_METADATA_SYNTHESIZED',
            severity: 'warning',
            path: ['fragments', 'content-only', contentKey],
            message: 'Fragment content without metadata was retained with deterministic recovery metadata.',
            repairable: true,
            details: {
                contentKey,
                fragmentId: claim.id,
                lineCount: lines.length,
            },
        })
    })
    const fragmentIssues = issues.slice(fragmentIssueStart)
    return {
        sidecar: {
            schemaVersion: MIGRATED_FRAGMENT_STORE_SCHEMA_VERSION,
            meta,
            contents,
            sequenceState: {
                schemaVersion: MIGRATED_FRAGMENT_SEQUENCE_SCHEMA_VERSION,
                revision: migrated.sequenceState.revision,
                counters: { ...migrated.sequenceState.counters },
            },
        },
        counts: {
            source: rawFiles.length + contentOnlyEntries.length,
            migrated: meta.length,
            generatedIds: prepared.generatedIds + contentOnlyEntries.length,
            repairedIds: prepared.repairedIds,
            orphaned: fragmentIssues.filter(issue => (
                issue.code === 'M_FRAGMENT_CONTENT_MISSING'
                || issue.code === 'M_FRAGMENT_METADATA_SYNTHESIZED'
            )).length,
        },
    }
}

function promptWindowText(record: UnknownRecord): string {
    if (typeof record.text === 'string') return record.text
    if (Array.isArray(record.tags)) return record.tags.map(tag => String(tag)).join(', ')
    return stringValue(record.prompt)
}

function normalizePromptTabs(source: unknown, issues: MigrationIssue[]): MigratedPromptPresetSidecar {
    const state = unwrapPersistedState(source)
    const rawState = isRecord(state) ? state : {}
    let rawTabs: unknown[] = []
    let activeLeft = rawState.activeLeftId ?? rawState.activeLeftTabId
    let activeRight = rawState.activeRightId ?? rawState.activeRightTabId

    if (Array.isArray(rawState.tabs)) {
        rawTabs = rawState.tabs
    } else if (Array.isArray(rawState.globalTabs) && isRecord(rawState.tabPanes)) {
        const tabPanes = rawState.tabPanes
        rawTabs = rawState.globalTabs.map(rawTab => {
            const tab = isRecord(rawTab) ? rawTab : {}
            const tabId = nonEmptyString(tab.id)
            const pane = tabId === undefined ? undefined : tabPanes[tabId]
            const paneRecord = isRecord(pane) ? pane : {}
            return {
                ...tab,
                windows: Array.isArray(paneRecord.promptWindows) ? paneRecord.promptWindows : [],
            }
        })
    }

    const preparedTabs = stableRecords(rawTabs, 'prompt-tab', ['promptPresets', 'tabs'], issues)
    const tabs = preparedTabs.records.map((tab, tabIndex): MigratedPromptTabSidecar => {
        const rawWindows = Array.isArray(tab.windows)
            ? tab.windows
            : Array.isArray(tab.promptWindows)
                ? tab.promptWindows
                : []
        const preparedWindows = stableRecords(
            rawWindows,
            'prompt-window',
            ['promptPresets', 'tabs', tabIndex, 'windows'],
            issues,
        )
        return {
            id: stringValue(tab.id),
            name: stringValue(tab.name, stringValue(tab.id)),
            windows: preparedWindows.records.map(window => ({
                id: stringValue(window.id),
                title: stringValue(window.title, stringValue(window.id)),
                text: promptWindowText(window),
                excluded: window.excluded === true || window.isExcluded === true,
            })),
        }
    })
    const mapActive = (value: unknown): string | null => {
        const legacyId = nonEmptyString(value)
        if (legacyId === undefined) return tabs[0]?.id ?? null
        const index = preparedTabs.originalIds.findIndex(id => id === legacyId)
        return index < 0 ? tabs[0]?.id ?? null : tabs[index]?.id ?? null
    }
    activeLeft = mapActive(activeLeft)
    activeRight = mapActive(activeRight)
    return {
        tabs,
        activeLeftId: typeof activeLeft === 'string' ? activeLeft : null,
        activeRightId: typeof activeRight === 'string' ? activeRight : null,
    }
}

function promptContribution(
    fields: EntityFields,
    id: string,
    text: string,
    enabled: boolean,
): PromptContribution {
    return {
        ...fields,
        id,
        orderKey: 'prompt-preset:00',
        enabled,
        target: { kind: 'positive', slot: 'workflow' },
        text,
        merge: 'append',
        separator: 'comma-space',
        provenance: [{ kind: 'external', source: `legacy-prompt-preset:${id}` }],
    }
}

function projectPromptPresets(
    source: unknown,
    fields: EntityFields,
    allocator: DeterministicMigrationIdAllocator,
    issues: MigrationIssue[],
): {
    projection: PromptPresetProjectionResult
    counts: MigrationEntityCounts
} {
    const issueStart = issues.length
    const sidecar = normalizePromptTabs(source, issues)
    const modules: CompositionModule[] = []
    const idIssues = issues.slice(issueStart).filter(issue => (
        issue.path[0] === 'promptPresets'
        && (issue.code === 'M_ID_GENERATED' || issue.code === 'M_DUPLICATE_ID_REPAIRED')
    ))
    let generatedIds = idIssues.length
    sidecar.tabs.forEach((tab, tabIndex) => {
        tab.windows.forEach((window, windowIndex) => {
            const moduleClaim = allocator.claim(undefined, {
                namespace: 'prompt-preset-module',
                locator: ['promptPresets', 'tabs', tabIndex, 'windows', windowIndex, 'module'],
                identity: { tabId: tab.id, windowId: window.id },
            })
            const contributionClaim = allocator.claim(undefined, {
                namespace: 'prompt-preset-contribution',
                locator: ['promptPresets', 'tabs', tabIndex, 'windows', windowIndex, 'contribution'],
                identity: { tabId: tab.id, windowId: window.id },
            })
            generatedIds += 2
            modules.push({
                ...fields,
                id: moduleClaim.id,
                orderKey: orderKey('prompt-preset-module', modules.length),
                name: window.title,
                enabled: !window.excluded,
                kind: 'prompt',
                contributions: [promptContribution(
                    fields,
                    contributionClaim.id,
                    window.text,
                    !window.excluded,
                )],
                characterPatches: [],
                resourceBindings: [],
                randomRuleIds: [],
                extensions: {
                    legacyPromptPreset: {
                        tabId: tab.id,
                        windowId: window.id,
                        excluded: window.excluded,
                    },
                },
            })
        })
    })
    const sourceCount = sidecar.tabs.reduce((count, tab) => count + tab.windows.length, 0)
    return {
        projection: { sidecar, modules },
        counts: {
            source: sourceCount,
            migrated: modules.length,
            generatedIds,
            repairedIds: idIssues.filter(issue => issue.code === 'M_DUPLICATE_ID_REPAIRED').length,
            orphaned: 0,
        },
    }
}

function collectScenePrompts(value: unknown): Map<string, string> {
    const result = new Map<string, string>()
    const state = unwrapPersistedState(value)
    if (Array.isArray(state)) {
        for (const item of state) {
            if (!isRecord(item)) continue
            const id = nonEmptyString(item.sceneId) ?? nonEmptyString(item.id)
            const prompt = typeof item.scenePrompt === 'string'
                ? item.scenePrompt
                : typeof item.prompt === 'string'
                    ? item.prompt
                    : undefined
            if (id !== undefined && prompt !== undefined) result.set(id, prompt)
        }
        return result
    }
    if (!isRecord(state)) return result
    const promptRecord = isRecord(state.prompts) ? state.prompts : state
    for (const [key, value] of Object.entries(promptRecord)) {
        if (typeof value === 'string') result.set(key, value)
        if (isRecord(value)) {
            const prompt = typeof value.scenePrompt === 'string'
                ? value.scenePrompt
                : typeof value.prompt === 'string'
                    ? value.prompt
                    : undefined
            if (prompt !== undefined) result.set(key, prompt)
        }
    }
    return result
}

function optionalDimension(
    value: unknown,
    path: readonly (string | number)[],
    issues: MigrationIssue[],
): number | undefined {
    if (value === undefined || value === null) return undefined
    const number = finiteNumber(value)
    if (number !== undefined && Number.isSafeInteger(number) && number > 0) return number
    issues.push({
        code: 'M_INVALID_SOURCE_REPAIRED',
        severity: 'warning',
        path: [...path],
        message: 'Invalid scene dimension was preserved in raw authority and omitted from typed params.',
        repairable: true,
    })
    return undefined
}

function scenePromptContribution(
    fields: EntityFields,
    id: string,
    sceneId: string,
    text: string,
): PromptContribution {
    return {
        ...fields,
        id,
        orderKey: 'scene:00',
        enabled: true,
        target: { kind: 'positive', slot: 'scene' },
        text,
        merge: 'append',
        separator: 'comma-space',
        provenance: [{ kind: 'external', source: `legacy-scene:${sceneId}:scenePrompt` }],
    }
}

function projectScenes(
    source: unknown,
    scenePromptSource: unknown,
    document: CompositionDocument,
    allocator: DeterministicMigrationIdAllocator,
    issues: MigrationIssue[],
): {
    projection: SceneProjectionResult
    counts: MigrationEntityCounts
} {
    const state = unwrapPersistedState(source)
    const rawState = isRecord(state) ? state : {}
    const rawPresets = Array.isArray(rawState.presets)
        ? rawState.presets
        : Array.isArray(rawState.scenes)
            ? [{ id: 'scene-default', name: 'Default', scenes: rawState.scenes, createdAt: 0 }]
            : []
    const presetRecords = stableRecords(rawPresets, 'scene-preset', ['scenes', 'presets'], issues)
    const promptMap = collectScenePrompts(scenePromptSource)
    const sceneIdAllocator = new DeterministicMigrationIdAllocator()
    const modules: CompositionModule[] = []
    const recipes: CompositionRecipe[] = []
    let sourceCount = 0
    let generatedIds = presetRecords.generatedIds
    let repairedIds = presetRecords.repairedIds

    const presets = presetRecords.records.map((preset, presetIndex): MigratedScenePresetSidecar => {
        const rawScenes = Array.isArray(preset.scenes) ? preset.scenes : []
        const sceneRecords = rawScenes.map(value => isRecord(value) ? value : {})
        const preparedScenes: UnknownRecord[] = sceneRecords.map((scene, sceneIndex) => {
            const preferredId = nonEmptyString(scene.id)
            const claim = sceneIdAllocator.claim(preferredId, {
                namespace: 'scene',
                locator: ['scenes', 'presets', presetIndex, 'scenes', sceneIndex],
                identity: identityWithoutDisplay(scene),
            })
            if (claim.generated) {
                generatedIds += 1
                if (claim.duplicate) repairedIds += 1
                issues.push({
                    code: claim.duplicate ? 'M_DUPLICATE_ID_REPAIRED' : 'M_ID_GENERATED',
                    severity: 'warning',
                    path: ['scenes', 'presets', presetIndex, 'scenes', sceneIndex, 'id'],
                    message: claim.duplicate
                        ? 'Duplicate scene ID was repaired deterministically.'
                        : 'Missing scene ID was generated deterministically.',
                    repairable: true,
                    details: {
                        generatedId: claim.id,
                        ...(claim.legacyId === undefined ? {} : { legacyId: claim.legacyId }),
                    },
                })
            }
            return { ...scene, id: claim.id }
        })
        sourceCount += preparedScenes.length

        const scenes = preparedScenes.map((scene, sceneIndex): MigratedSceneCardSidecar => {
            const sceneId = stringValue(scene.id)
            const legacyId = nonEmptyString(sceneRecords[sceneIndex].id)
            const prompt = promptMap.get(sceneId)
                ?? (legacyId === undefined ? undefined : promptMap.get(legacyId))
                ?? stringValue(scene.scenePrompt, stringValue(scene.prompt))
            const width = optionalDimension(
                scene.width,
                ['scenes', 'presets', presetIndex, 'scenes', sceneIndex, 'width'],
                issues,
            )
            const height = optionalDimension(
                scene.height,
                ['scenes', 'presets', presetIndex, 'scenes', sceneIndex, 'height'],
                issues,
            )
            const moduleClaim = allocator.claim(undefined, {
                namespace: 'scene-module',
                locator: ['scenes', 'presets', presetIndex, 'scenes', sceneIndex, 'module'],
                identity: { presetId: preset.id, sceneId },
            })
            const recipeClaim = allocator.claim(undefined, {
                namespace: 'scene-recipe',
                locator: ['scenes', 'presets', presetIndex, 'scenes', sceneIndex, 'recipe'],
                identity: { presetId: preset.id, sceneId },
            })
            const stepClaim = allocator.claim(undefined, {
                namespace: 'scene-step',
                locator: ['scenes', 'presets', presetIndex, 'scenes', sceneIndex, 'step'],
                identity: { presetId: preset.id, sceneId },
            })
            const contributionClaim = prompt.trim().length === 0
                ? undefined
                : allocator.claim(undefined, {
                    namespace: 'scene-contribution',
                    locator: ['scenes', 'presets', presetIndex, 'scenes', sceneIndex, 'prompt'],
                    identity: { presetId: preset.id, sceneId },
                })
            generatedIds += contributionClaim === undefined ? 3 : 4
            const paramsOverride = {
                ...(width === undefined ? {} : { width }),
                ...(height === undefined ? {} : { height }),
            }
            const contributions = contributionClaim === undefined
                ? []
                : [scenePromptContribution(documentEntityFields(document), contributionClaim.id, sceneId, prompt)]
            modules.push({
                ...documentEntityFields(document),
                id: moduleClaim.id,
                orderKey: orderKey('scene-module', modules.length),
                name: stringValue(scene.name, sceneId),
                enabled: true,
                kind: 'composite',
                contributions,
                characterPatches: [],
                ...(Object.keys(paramsOverride).length === 0 ? {} : { paramsOverride }),
                resourceBindings: [],
                randomRuleIds: [],
                extensions: { legacyScene: { presetId: stringValue(preset.id), sceneId } },
            })
            const step: RecipeStep = {
                ...documentEntityFields(document),
                id: stepClaim.id,
                orderKey: 'scene-step:00',
                moduleId: moduleClaim.id,
                enabled: true,
                contributions: [],
                characterPatches: [],
                resourceBindings: [],
                randomRuleIds: [],
            }
            recipes.push({
                ...documentEntityFields(document),
                id: recipeClaim.id,
                orderKey: orderKey('scene-recipe', recipes.length),
                name: stringValue(scene.name, sceneId),
                enabled: true,
                steps: [step],
                extensions: { legacyScene: { presetId: stringValue(preset.id), sceneId } },
            })

            const existingRef = isRecord(scene.compositionRef) ? scene.compositionRef : undefined
            const existingMigrationMarker = existingRef !== undefined && isRecord(existingRef.migrationMarker)
                ? existingRef.migrationMarker
                : undefined
            const isOwnCompatibilityProjection = existingMigrationMarker?.kind === 'legacy-scene-prompt'
                && existingMigrationMarker.schemaVersion === 2
            return {
                id: sceneId,
                name: stringValue(scene.name, sceneId),
                scenePrompt: prompt,
                queueCount: Math.max(0, safeInteger(scene.queueCount, 0)),
                ...(width === undefined ? {} : { width }),
                ...(height === undefined ? {} : { height }),
                ...(typeof scene.excludePinned === 'boolean' ? { excludePinned: scene.excludePinned } : {}),
                createdAt: timestampNumber(scene.createdAt),
                compositionRef: {
                    recipeId: recipeClaim.id,
                    selectionKind: 'asset',
                    recipeRevision: document.revision,
                    migrationMarker: { kind: 'legacy-scene-prompt', schemaVersion: 2 },
                    ...(existingRef === undefined || isOwnCompatibilityProjection
                        ? {}
                        : { extensions: { previousCompositionRef: jsonRecord(existingRef) } }),
                },
                ...(Array.isArray(scene.images) && scene.images.length > 0
                    ? { extensions: { retainedImageCount: scene.images.length } }
                    : {}),
            }
        })
        return {
            id: stringValue(preset.id),
            name: stringValue(preset.name, stringValue(preset.id)),
            createdAt: timestampNumber(preset.createdAt),
            scenes,
        }
    })
    const rawActiveId = nonEmptyString(rawState.activePresetId)
    const activeIndex = rawActiveId === undefined
        ? -1
        : presetRecords.originalIds.findIndex(id => id === rawActiveId)
    return {
        projection: {
            sidecar: {
                presets,
                activePresetId: activeIndex >= 0
                    ? presets[activeIndex]?.id ?? null
                    : presets[0]?.id ?? null,
            },
            modules,
            recipes,
        },
        counts: {
            source: sourceCount,
            migrated: recipes.length,
            generatedIds,
            repairedIds,
            orphaned: 0,
        },
    }
}

function documentEntityFields(document: CompositionDocument): EntityFields {
    return entityFields(document)
}

function jsonRecord(value: UnknownRecord): JsonObject {
    try {
        return JSON.parse(JSON.stringify(value)) as JsonObject
    } catch {
        return {}
    }
}

function safeCanonicalHash(
    value: unknown,
    path: readonly (string | number)[],
    issues: MigrationIssue[],
): string {
    try {
        const json = JSON.parse(JSON.stringify(value)) as unknown
        return hashCanonicalValue(json)
    } catch (error) {
        issues.push({
            code: 'M_SOURCE_HASH_FAILED',
            severity: 'fatal',
            path: [...path],
            message: 'Migration source could not be represented as canonical JSON.',
            repairable: false,
            details: { error: error instanceof Error ? error.message : String(error) },
        })
        return hashCanonicalValue(null)
    }
}

function uniqueInOrder(values: readonly string[]): string[] {
    return [...new Set(values)]
}

function mergeProfile(
    profile: CompositionProfile,
    modules: readonly CompositionModule[],
    recipes: readonly CompositionRecipe[],
    characters: readonly CharacterDefinition[],
    paramsPresets: readonly ParamsPreset[],
    activeParamsPresetId: string | undefined,
    templateExtensions: JsonObject,
): CompositionProfile {
    return {
        ...profile,
        moduleIds: uniqueInOrder([...profile.moduleIds, ...modules.map(module => module.id)]),
        recipeIds: uniqueInOrder([...profile.recipeIds, ...recipes.map(recipe => recipe.id)]),
        characterIds: uniqueInOrder([...profile.characterIds, ...characters.map(character => character.id)]),
        paramsPresetIds: uniqueInOrder([
            ...profile.paramsPresetIds,
            ...paramsPresets.map(preset => preset.id),
        ]),
        ...(activeParamsPresetId === undefined ? {} : { defaultParamsPresetId: activeParamsPresetId }),
        extensions: {
            ...(profile.extensions ?? {}),
            ...templateExtensions,
        },
    }
}

function sourceCountsFor(
    stores: ReadonlyMap<string, unknown>,
    entityCounts: Readonly<Record<string, MigrationEntityCounts>>,
): Record<string, number> {
    return {
        stores: stores.size,
        scenes: entityCounts.scenes?.source ?? 0,
        fragments: entityCounts.fragments?.source ?? 0,
        characters: entityCounts.characters?.source ?? 0,
        generationPresets: entityCounts.generationPresets?.source ?? 0,
        promptPresets: entityCounts.promptPresets?.source ?? 0,
    }
}

function targetCountsFor(document: CompositionDocument, sidecars: LegacyStoresMigrationSidecars): Record<string, number> {
    return {
        profiles: document.profiles.length,
        modules: document.modules.length,
        recipes: document.recipes.length,
        characters: document.characters.length,
        generationPresets: document.paramsPresets.length,
        fragments: sidecars.fragments.meta.length,
        scenes: sidecars.scenes.presets.reduce((count, preset) => count + preset.scenes.length, 0),
        promptPresets: sidecars.promptPresets.tabs.reduce((count, tab) => count + tab.windows.length, 0),
    }
}

/**
 * Pure, repeatable migration of legacy persisted stores into a complete v2
 * CompositionDocument plus explicit sidecars for authorities that must remain
 * separate. It never mutates or deletes its input and never materializes image
 * bytes into the document.
 */
export function migrateLegacyStoresToV2(input: LegacyStoresMigrationInput): LegacyStoresMigrationResult {
    const issues: MigrationIssue[] = []
    const rawSources = detachedInput(input, issues)
    const stores = collectNamedStores(input)
    const sceneSource = readStore(input.scenes, STORE_ALIASES.scenes, stores)
    const scenePromptSource = readStore(input.scenePrompts, STORE_ALIASES.scenePrompts, stores)
    const fragmentSource = readStore(input.fragments, STORE_ALIASES.fragments, stores)
    const fragmentContentSource = readStore(input.fragmentContent, STORE_ALIASES.fragmentContent, stores)
    const characterSource = readStore(input.characterPrompts, STORE_ALIASES.characterPrompts, stores)
    const characterPositionSource = readStore(
        input.characterPositions,
        STORE_ALIASES.characterPositions,
        stores,
    )
    const generationPresetSource = readStore(input.generationPresets, STORE_ALIASES.generationPresets, stores)
    const promptPresetSource = readStore(input.promptPresets, STORE_ALIASES.promptPresets, stores)
    const assetProfileSource = extractAssetProfile(readStore(
        input.assetProfileJson,
        STORE_ALIASES.assetProfile,
        stores,
    ))
    ;[
        ['scenes', sceneSource],
        ['scenePrompts', scenePromptSource],
        ['fragments', fragmentSource],
        ['fragmentContent', fragmentContentSource],
        ['characterPrompts', characterSource],
        ['characterPositions', characterPositionSource],
        ['generationPresets', generationPresetSource],
        ['promptPresets', promptPresetSource],
        ['assetProfileJson', readStore(input.assetProfileJson, STORE_ALIASES.assetProfile, stores)],
    ].forEach(([name, value]) => reportMalformedJsonSource(String(name), value, issues))

    const initialCharacters = prepareCharacterRecords(
        characterSource,
        characterPositionSource,
        assetProfileReservedIds(assetProfileSource),
        issues,
    )
    let assetMigration = migrateV1AssetProfileToV2({
        profile: assetProfileSource,
        stableCharacterIds: initialCharacters.records.records.map(record => stringValue(record.id)),
    })
    const finalCharacters = repairCharacterDocumentCollisions(
        initialCharacters.records.records,
        documentEntityIds(assetMigration.document),
        issues,
    )
    const initialCharacterIds = initialCharacters.records.records.map(record => stringValue(record.id))
    const finalCharacterIds = finalCharacters.records.map(record => stringValue(record.id))
    if (initialCharacterIds.some((id, index) => id !== finalCharacterIds[index])) {
        assetMigration = migrateV1AssetProfileToV2({
            profile: assetProfileSource,
            stableCharacterIds: finalCharacterIds,
        })
    }
    issues.push(...assetMigration.report.issues)

    const baseDocument = assetMigration.document
    const characterProjection = projectCharacters(
        initialCharacters.state,
        finalCharacters.records,
        baseDocument,
        issues,
    )
    const allocator = new DeterministicMigrationIdAllocator([
        ...documentEntityIds(baseDocument),
        ...characterProjection.characters.map(character => character.id),
    ])
    const paramsProjection = projectParamsPresets(
        generationPresetSource,
        baseDocument,
        allocator,
        issues,
    )
    const promptProjection = projectPromptPresets(
        promptPresetSource,
        entityFields(baseDocument),
        allocator,
        issues,
    )
    const sceneProjection = projectScenes(
        sceneSource,
        scenePromptSource,
        baseDocument,
        allocator,
        issues,
    )
    const fragmentProjection = projectFragments(
        fragmentSource,
        [fragmentContentSource, input.indexedDbSnapshots],
        issues,
    )

    const ignoredKeys = [...stores.keys()]
        .filter(key => !KNOWN_STORE_KEYS.has(key) && !key.startsWith('_'))
        .sort((left, right) => left.localeCompare(right))
    for (const key of ignoredKeys) {
        const obsoleteRemoteKey = /marketplace|supabase/i.test(key)
        issues.push({
            code: obsoleteRemoteKey ? 'M_LEGACY_REMOTE_KEY_IGNORED' : 'M_UNKNOWN_STORE_RETAINED',
            severity: 'info',
            path: ['stores', key],
            message: obsoleteRemoteKey
                ? 'Obsolete Marketplace/Supabase state was retained only in raw rollback data.'
                : 'Unknown store was retained in raw rollback data and was not projected into v2 authority.',
            repairable: true,
            details: { key },
        })
    }

    const addedModules = [...promptProjection.projection.modules, ...sceneProjection.projection.modules]
    const addedRecipes = sceneProjection.projection.recipes
    const profile = baseDocument.profiles[0]
    let document: CompositionDocument = {
        ...baseDocument,
        schemaVersion: COMPOSITION_SCHEMA_VERSION,
        profiles: profile === undefined
            ? baseDocument.profiles
            : [
                mergeProfile(
                    profile,
                    addedModules,
                    addedRecipes,
                    characterProjection.characters,
                    paramsProjection.presets,
                    paramsProjection.activePresetId,
                    characterProjection.templateExtensions,
                ),
                ...baseDocument.profiles.slice(1),
            ],
        modules: [...baseDocument.modules, ...addedModules],
        recipes: [...baseDocument.recipes, ...addedRecipes],
        characters: [...baseDocument.characters, ...characterProjection.characters],
        paramsPresets: [...baseDocument.paramsPresets, ...paramsProjection.presets],
        extensions: {
            ...(baseDocument.extensions ?? {}),
            legacyStores: {
                migrationId: MIGRATION_ID,
                scenes: { count: sceneProjection.counts.migrated },
                fragments: {
                    schemaVersion: fragmentProjection.sidecar.schemaVersion,
                    count: fragmentProjection.sidecar.meta.length,
                    contentHash: hashCanonicalValue(fragmentProjection.sidecar.contents),
                },
                promptPresets: { count: promptProjection.counts.migrated },
                ignoredKeys,
            },
        },
    }

    const parsed = safeParseCompositionDocument(document)
    if (!parsed.success) {
        issues.push({
            code: 'M_V2_SCHEMA_VALIDATION_FAILED',
            severity: 'fatal',
            path: [],
            message: 'Projected legacy stores did not produce a schema-valid v2 document.',
            repairable: false,
            details: { issueCount: parsed.issues.length },
        })
        document = baseDocument
    } else {
        const semanticIssues = validateCompositionSemantics(parsed.data).filter(issue => issue.blocking)
        for (const issue of semanticIssues) {
            issues.push({
                code: 'M_V2_REFERENCE_VALIDATION_FAILED',
                severity: 'error',
                path: [...issue.fieldPath],
                message: issue.messageKey,
                repairable: true,
                details: { code: issue.code },
            })
        }
        document = parsed.data
    }

    const sidecars: LegacyStoresMigrationSidecars = {
        scenes: sceneProjection.projection.sidecar,
        fragments: fragmentProjection.sidecar,
        promptPresets: promptProjection.projection.sidecar,
        assetProfileOrphans: assetMigration.orphans.map(orphan => structuredClone(orphan)),
        ignoredLegacyKeys: [...ignoredKeys],
    }
    const entityCounts: Record<string, MigrationEntityCounts> = {}
    combineCounts(entityCounts, assetMigration.report.entityCounts)
    entityCounts.characters = {
        source: initialCharacters.records.records.length,
        migrated: characterProjection.characters.length,
        generatedIds: initialCharacters.records.generatedIds + finalCharacters.generatedIds,
        repairedIds: initialCharacters.records.repairedIds + finalCharacters.repairedIds,
        orphaned: 0,
    }
    entityCounts.generationPresets = paramsProjection.counts
    entityCounts.promptPresets = promptProjection.counts
    entityCounts.scenes = sceneProjection.counts
    entityCounts.fragments = fragmentProjection.counts
    const sourceCounts = sourceCountsFor(stores, entityCounts)
    const targetCounts = targetCountsFor(document, sidecars)
    const sourceHash = safeCanonicalHash(rawSources, [], issues)
    const targetHash = hashCanonicalValue(document)
    const report: MigrationReport = {
        migrationId: MIGRATION_ID,
        sourceSchemaVersion: 'legacy',
        targetSchemaVersion: COMPOSITION_SCHEMA_VERSION,
        changed: assetMigration.report.changed
            || Object.values(entityCounts).some(counts => counts.source > 0),
        fatal: migrationHasFatalIssues(issues),
        sourceCounts,
        targetCounts,
        sourceHash,
        targetHash,
        entityCounts,
        issues,
        ignoredKeys,
        extensions: {
            sourceHashes: {
                raw: sourceHash,
                assetProfile: assetMigration.report.sourceHash,
                fragments: hashCanonicalValue(fragmentProjection.sidecar),
            },
        },
    }
    return { document, report, rawSources, sidecars }
}
