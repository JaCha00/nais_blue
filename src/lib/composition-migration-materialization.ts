import type { CompositionDocument } from '@/domain/composition/types'
import type { LegacyStoresMigrationResult } from '@/domain/composition/migrations/legacy-stores-to-v2'
import {
    compareAndReplaceWildcardContentSnapshot,
    compareAndSetIndexedDBItem,
    exportWildcardContentSnapshot,
    getIndexedDBItemStrict,
} from '@/lib/indexed-db'
import type { CompositionMigrationSourceSnapshot } from '@/lib/composition-migration-runtime'
import {
    loadRawAssetProfileFile,
    restoreRawAssetProfileFilePreimageIfUnchanged,
    seedRawAssetProfileFileIfMissing,
    type RawAssetProfileFileSnapshot,
} from '@/services/asset-profile-file'

type JsonRecord = Record<string, unknown>

export interface CompositionMigrationMaterializationDependencies {
    getItem: (key: string) => Promise<string | null>
    compareAndSetItem: (
        key: string,
        expected: string | null,
        replacement: string | null,
    ) => Promise<boolean>
    getWildcardContent: () => Promise<Record<string, string[]>>
    replaceWildcardContent: (
        expected: Record<string, string[]>,
        content: Record<string, string[]>,
    ) => Promise<boolean>
    readAssetProfile: () => Promise<RawAssetProfileFileSnapshot>
    seedAssetProfileIfMissing: (rawJson: string) => Promise<boolean>
    restoreAssetProfilePreimage: (
        snapshot: RawAssetProfileFileSnapshot,
        expectedPostimage: RawAssetProfileFileSnapshot,
    ) => Promise<boolean | void>
}

const productionDependencies: CompositionMigrationMaterializationDependencies = {
    getItem: getIndexedDBItemStrict,
    compareAndSetItem: compareAndSetIndexedDBItem,
    getWildcardContent: () => exportWildcardContentSnapshot({ strict: true }),
    replaceWildcardContent: compareAndReplaceWildcardContentSnapshot,
    readAssetProfile: loadRawAssetProfileFile,
    seedAssetProfileIfMissing: seedRawAssetProfileFileIfMissing,
    restoreAssetProfilePreimage: restoreRawAssetProfileFilePreimageIfUnchanged,
}

interface MaterializationRollbackEntry {
    label: string
    rollback: () => Promise<void>
}

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseRaw(raw: string | undefined | null): unknown {
    if (raw === undefined || raw === null) return undefined
    return JSON.parse(raw) as unknown
}

function unwrapPersisted(value: unknown): JsonRecord {
    if (!isRecord(value)) return {}
    return isRecord(value.state) ? value.state : value
}

function wrapPersisted(current: unknown, state: JsonRecord, defaultVersion: number): JsonRecord {
    if (isRecord(current) && 'state' in current) return { ...current, state }
    return { state, version: defaultVersion }
}

async function writePersistedState(
    dependencies: CompositionMigrationMaterializationDependencies,
    journal: MaterializationRollbackEntry[],
    key: string,
    expectedRaw: string | null,
    defaultVersion: number,
    update: (state: JsonRecord) => JsonRecord,
): Promise<void> {
    const currentRaw = await dependencies.getItem(key)
    if (currentRaw !== expectedRaw) {
        throw new Error(`Migration materialization source changed for ${key}`)
    }
    // Build and compare from the startup snapshot. The fresh read above is only
    // a drift check; it must never silently become the CAS expectation.
    const current = parseRaw(expectedRaw)
    const next = wrapPersisted(current, update(unwrapPersisted(current)), defaultVersion)
    const serialized = JSON.stringify(next)
    if (serialized === expectedRaw) return

    journal.push({
        label: key,
        rollback: async () => {
            const rollbackCurrent = await dependencies.getItem(key)
            if (rollbackCurrent === expectedRaw) return
            if (rollbackCurrent !== serialized) {
                throw new Error(`Migration materialization rollback conflict for ${key}`)
            }
            if (!await dependencies.compareAndSetItem(key, serialized, expectedRaw)) {
                if (await dependencies.getItem(key) === expectedRaw) return
                throw new Error(`Migration materialization rollback CAS failed for ${key}`)
            }
            if (await dependencies.getItem(key) !== expectedRaw) {
                throw new Error(`Migration materialization rollback readback mismatch for ${key}`)
            }
        },
    })

    if (!await dependencies.compareAndSetItem(key, expectedRaw, serialized)) {
        throw new Error(`Migration materialization conflict for ${key}`)
    }
    if (await dependencies.getItem(key) !== serialized) {
        throw new Error(`Migration materialization readback mismatch for ${key}`)
    }
}

function canonicalWildcardContent(value: Record<string, string[]>): string {
    return JSON.stringify(Object.fromEntries(
        Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, lines]) => [key, [...lines]]),
    ))
}

function wildcardContentMatches(
    left: Record<string, string[]>,
    right: Record<string, string[]>,
): boolean {
    return canonicalWildcardContent(left) === canonicalWildcardContent(right)
}

function assetProfileMatches(
    snapshot: RawAssetProfileFileSnapshot,
    expectedRaw: string | null,
): boolean {
    return expectedRaw === null
        ? !snapshot.exists && snapshot.rawJson === null
        : snapshot.exists && snapshot.rawJson === expectedRaw
}

function capturedAssetProfileRaw(source: CompositionMigrationSourceSnapshot): string | null {
    if (source.assetProfileJson === undefined) return null
    return typeof source.assetProfileJson === 'string'
        ? source.assetProfileJson
        : JSON.stringify(source.assetProfileJson)
}

async function rollbackMaterialization(
    journal: MaterializationRollbackEntry[],
): Promise<Error[]> {
    const failures: Error[] = []
    for (const entry of [...journal].reverse()) {
        try {
            await entry.rollback()
        } catch (error) {
            failures.push(new Error(
                `Failed to restore ${entry.label}: ${error instanceof Error ? error.message : String(error)}`,
            ))
        }
    }
    return failures
}

function sceneState(
    current: JsonRecord,
    sidecar: LegacyStoresMigrationResult['sidecars']['scenes'],
): JsonRecord {
    const currentPresets = Array.isArray(current.presets) ? current.presets : []
    const presets = sidecar.presets.map((migratedPreset, presetIndex) => {
        const existing = currentPresets.find(value => (
            isRecord(value) && value.id === migratedPreset.id
        )) ?? currentPresets[presetIndex]
        const existingPreset = isRecord(existing) ? existing : {}
        const existingScenes = Array.isArray(existingPreset.scenes) ? existingPreset.scenes : []
        const scenes = migratedPreset.scenes.map((migratedScene, sceneIndex) => {
            const currentSceneValue = existingScenes.find(value => (
                isRecord(value) && value.id === migratedScene.id
            )) ?? existingScenes[sceneIndex]
            const currentScene = isRecord(currentSceneValue) ? currentSceneValue : {}
            return {
                ...currentScene,
                id: migratedScene.id,
                name: typeof currentScene.name === 'string' ? currentScene.name : migratedScene.name,
                scenePrompt: migratedScene.scenePrompt,
                queueCount: typeof currentScene.queueCount === 'number' ? currentScene.queueCount : migratedScene.queueCount,
                images: Array.isArray(currentScene.images) ? currentScene.images : [],
                ...(migratedScene.width === undefined ? {} : { width: migratedScene.width }),
                ...(migratedScene.height === undefined ? {} : { height: migratedScene.height }),
                ...(migratedScene.excludePinned === undefined ? {} : { excludePinned: migratedScene.excludePinned }),
                createdAt: typeof currentScene.createdAt === 'number' ? currentScene.createdAt : migratedScene.createdAt,
                compositionRef: migratedScene.compositionRef,
            }
        })
        return {
            ...existingPreset,
            id: migratedPreset.id,
            name: typeof existingPreset.name === 'string' ? existingPreset.name : migratedPreset.name,
            createdAt: typeof existingPreset.createdAt === 'number'
                ? existingPreset.createdAt
                : migratedPreset.createdAt,
            scenes,
        }
    })
    return {
        ...current,
        presets,
        activePresetId: sidecar.activePresetId,
    }
}

function characterState(current: JsonRecord, document: CompositionDocument): JsonRecord {
    const existingCharacters = Array.isArray(current.characters) ? current.characters : []
    const characters = document.characters.map((migrated, index) => {
        const existingValue = existingCharacters.find(value => (
            isRecord(value) && value.id === migrated.id
        )) ?? existingCharacters[index]
        const existing = isRecord(existingValue) ? existingValue : {}
        const position = migrated.position.mode === 'manual'
            ? { x: migrated.position.x, y: migrated.position.y }
            : isRecord(existing.position)
                ? existing.position
                : { x: 0.5, y: 0.5 }
        return {
            ...existing,
            id: migrated.id,
            name: typeof existing.name === 'string' ? existing.name : migrated.name,
            prompt: migrated.positivePrompt,
            negative: migrated.negativePrompt,
            enabled: migrated.enabled,
            position,
        }
    })
    return {
        ...current,
        characters,
        presets: Array.isArray(current.presets) ? current.presets : [],
        groups: Array.isArray(current.groups) ? current.groups : [],
        positionEnabled: document.characters.some(character => character.position.mode === 'manual'),
    }
}

function fragmentState(
    current: JsonRecord,
    sidecar: LegacyStoresMigrationResult['sidecars']['fragments'],
): JsonRecord {
    return {
        ...current,
        schemaVersion: sidecar.schemaVersion,
        files: sidecar.meta,
        sequenceState: sidecar.sequenceState,
        _migrated: true,
    }
}

function promptPresetState(
    current: JsonRecord,
    sidecar: LegacyStoresMigrationResult['sidecars']['promptPresets'],
): JsonRecord {
    return {
        ...current,
        tabs: sidecar.tabs,
        activeLeftId: sidecar.activeLeftId,
        activeRightId: sidecar.activeRightId,
    }
}

function fragmentContentForRepository(
    sidecar: LegacyStoresMigrationResult['sidecars']['fragments'],
): Record<string, string[]> {
    return Object.fromEntries(sidecar.meta.map(meta => [
        meta.contentKey,
        [...(sidecar.contents[meta.id] ?? sidecar.contents[meta.contentKey] ?? [])],
    ]))
}

function assetProfileJsonFromSource(source: CompositionMigrationSourceSnapshot): string | undefined {
    if (typeof source.assetProfileJson === 'string') return source.assetProfileJson
    if (source.assetProfileJson !== undefined) return JSON.stringify(source.assetProfileJson)
    for (const key of ['asset-profile', 'assetProfile', 'nais2-asset-modules']) {
        const value = parseRaw(source.serializedStores[key])
        const state = unwrapPersisted(value)
        const profile = key === 'nais2-asset-modules' ? state.profile : state
        if (isRecord(profile) && Object.keys(profile).length > 0) return JSON.stringify(profile, null, 2)
    }
    return undefined
}

/**
 * Writes only normalized compatibility projections. Raw aliases remain
 * untouched, Scene image references are preserved, and no image/cache bytes
 * enter the Composition document or move between repositories.
 */
export async function materializeCompositionMigrationSidecars(input: {
    source: CompositionMigrationSourceSnapshot
    document: CompositionDocument
    sidecars: LegacyStoresMigrationResult['sidecars']
}, dependencies: CompositionMigrationMaterializationDependencies = productionDependencies): Promise<void> {
    const journal: MaterializationRollbackEntry[] = []
    try {
        if (input.sidecars.scenes.presets.length > 0) {
            await writePersistedState(
                dependencies,
                journal,
                'nais2-scenes',
                input.source.serializedStores['nais2-scenes'] ?? null,
                1,
                state => sceneState(state, input.sidecars.scenes),
            )
        }
        if (input.document.characters.length > 0) {
            await writePersistedState(
                dependencies,
                journal,
                'nais2-character-prompts',
                input.source.serializedStores['nais2-character-prompts'] ?? null,
                2,
                state => characterState(state, input.document),
            )
        }
        if (input.sidecars.fragments.meta.length > 0) {
            await writePersistedState(
                dependencies,
                journal,
                'nais2-wildcards',
                input.source.serializedStores['nais2-wildcards'] ?? null,
                2,
                state => fragmentState(state, input.sidecars.fragments),
            )
            const expectedWildcardContent = input.source.wildcardContent
            const replacementWildcardContent = {
                ...expectedWildcardContent,
                ...fragmentContentForRepository(input.sidecars.fragments),
            }
            const currentWildcardContent = await dependencies.getWildcardContent()
            if (!wildcardContentMatches(currentWildcardContent, expectedWildcardContent)) {
                throw new Error('Migration materialization source changed for wildcard content')
            }
            if (!wildcardContentMatches(replacementWildcardContent, expectedWildcardContent)) {
                journal.push({
                    label: 'wildcard content',
                    rollback: async () => {
                        const rollbackCurrent = await dependencies.getWildcardContent()
                        if (wildcardContentMatches(rollbackCurrent, expectedWildcardContent)) return
                        if (!wildcardContentMatches(rollbackCurrent, replacementWildcardContent)) {
                            throw new Error('Migration materialization rollback conflict for wildcard content')
                        }
                        if (!await dependencies.replaceWildcardContent(
                            replacementWildcardContent,
                            expectedWildcardContent,
                        )) {
                            if (wildcardContentMatches(
                                await dependencies.getWildcardContent(),
                                expectedWildcardContent,
                            )) return
                            throw new Error('Migration materialization rollback CAS failed for wildcard content')
                        }
                        if (!wildcardContentMatches(
                            await dependencies.getWildcardContent(),
                            expectedWildcardContent,
                        )) {
                            throw new Error('Migration materialization rollback readback mismatch for wildcard content')
                        }
                    },
                })
                if (!await dependencies.replaceWildcardContent(
                    expectedWildcardContent,
                    replacementWildcardContent,
                )) {
                    throw new Error('Migration materialization conflict for wildcard content')
                }
                if (!wildcardContentMatches(
                    await dependencies.getWildcardContent(),
                    replacementWildcardContent,
                )) {
                    throw new Error('Migration materialization readback mismatch for wildcard content')
                }
            }
        }
        if (input.sidecars.promptPresets.tabs.length > 0) {
            await writePersistedState(
                dependencies,
                journal,
                'nais2-prompt-library',
                input.source.serializedStores['nais2-prompt-library'] ?? null,
                0,
                state => promptPresetState(state, input.sidecars.promptPresets),
            )
        }

        const rawAssetProfile = assetProfileJsonFromSource(input.source)
        if (rawAssetProfile !== undefined) {
            const expectedAssetProfileRaw = capturedAssetProfileRaw(input.source)
            const assetProfilePreimage = await dependencies.readAssetProfile()
            if (!assetProfileMatches(assetProfilePreimage, expectedAssetProfileRaw)) {
                throw new Error('Migration materialization source changed for Asset Profile file')
            }
            if (expectedAssetProfileRaw === null) {
                // Register before attempting the seed: an injected/OS failure
                // can occur after the atomic rename has already made the file visible.
                let rollbackArmed = true
                let expectedPostimage: RawAssetProfileFileSnapshot = {
                    exists: true,
                    path: assetProfilePreimage.path,
                    rawJson: rawAssetProfile,
                }
                journal.push({
                    label: 'Asset Profile file',
                    rollback: async () => {
                        if (!rollbackArmed) return
                        const restored = await dependencies.restoreAssetProfilePreimage(
                            assetProfilePreimage,
                            expectedPostimage,
                        )
                        if (restored === false) {
                            throw new Error(
                                'Migration materialization rollback conflict for Asset Profile file',
                            )
                        }
                    },
                })
                if (!await dependencies.seedAssetProfileIfMissing(rawAssetProfile)) {
                    // `false` means this process did not write. In particular,
                    // another process may have created the formerly missing file.
                    rollbackArmed = false
                    throw new Error('Migration materialization conflict for Asset Profile file')
                }
                const materializedPostimage = await dependencies.readAssetProfile()
                if (!assetProfileMatches(materializedPostimage, rawAssetProfile)) {
                    throw new Error('Migration materialization readback mismatch for Asset Profile file')
                }
                expectedPostimage = materializedPostimage
            }
        }
    } catch (error) {
        const rollbackFailures = await rollbackMaterialization(journal)
        if (rollbackFailures.length > 0) {
            const original = error instanceof Error ? error : new Error(String(error))
            throw new Error([
                `Migration materialization failed and rollback was incomplete: ${original.message}`,
                ...rollbackFailures.map(failure => failure.message),
            ].join('; '))
        }
        throw error
    }
}
