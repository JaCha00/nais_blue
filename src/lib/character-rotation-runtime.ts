import type {
    CharacterSlotPatch,
    EntityId,
    RandomTraceEntry,
} from '@/domain/composition/types'

export const CHARACTER_ROTATION_TRACE_SOURCE = 'rotation-store-sequence' as const
export const CHARACTER_ROTATION_TRACE_RULE_ID = 'runtime:character-rotation:sequence' as const

/**
 * Structural view of the persisted rotation state. Keeping this interface free
 * of Zustand actions lets adapters capture a deterministic selection without
 * mutating the legacy rotation state machine.
 */
export interface CharacterRotationRuntimeState {
    active: boolean
    characterIds: readonly EntityId[]
    pinnedCharacterIds: readonly EntityId[]
    currentIndex: number
    currentRepeat: number
    snapshot: {
        presetId: EntityId
    } | null
}

export interface CharacterRotationSelectionMetadata {
    source: typeof CHARACTER_ROTATION_TRACE_SOURCE
    result: EntityId
    presetId: EntityId | null
    currentIndex: number
    currentRepeat: number
    sequenceOrdinal: number
    pinnedCharacterIds: EntityId[]
}

export interface CharacterRotationRuntimeSelection {
    source: typeof CHARACTER_ROTATION_TRACE_SOURCE
    selectedCharacterId: EntityId
    pinnedCharacterIds: EntityId[]
    currentIndex: number
    currentRepeat: number
    sequenceOrdinal: number
    presetId: EntityId | null
    trace: RandomTraceEntry
    metadata: CharacterRotationSelectionMetadata
}

export interface CharacterRotationOverrideOptions {
    /** Scene-level compatibility switch used by the existing excludePinned flag. */
    excludePinned?: boolean
}

function normalizeSequenceIndex(value: number): number | null {
    if (!Number.isFinite(value)) return null
    const normalized = Math.floor(value)
    return normalized >= 0 ? normalized : null
}

function uniqueEntityIds(ids: readonly EntityId[]): EntityId[] {
    const seen = new Set<EntityId>()
    const result: EntityId[] = []
    for (const id of ids) {
        if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
        seen.add(id)
        result.push(id)
    }
    return result
}

/**
 * Reads the current fixed-order selection. The generation seed is recorded for
 * replay/provenance but intentionally does not alter the legacy sequence.
 */
export function getRuntimeSelection(
    state: CharacterRotationRuntimeState,
    generationSeed: number,
): CharacterRotationRuntimeSelection | null {
    if (!state.active) return null

    const currentIndex = normalizeSequenceIndex(state.currentIndex)
    const currentRepeat = normalizeSequenceIndex(state.currentRepeat)
    if (currentIndex === null || currentRepeat === null || currentIndex >= state.characterIds.length) {
        return null
    }

    const selectedCharacterId = state.characterIds[currentIndex]
    if (typeof selectedCharacterId !== 'string' || selectedCharacterId.length === 0) return null

    const presetId = state.snapshot?.presetId ?? null
    const pinnedCharacterIds = uniqueEntityIds(state.pinnedCharacterIds)
    const sequenceOrdinal = currentRepeat * state.characterIds.length + currentIndex
    const seed = Number.isFinite(generationSeed) ? Math.trunc(generationSeed) : 0
    const metadata: CharacterRotationSelectionMetadata = {
        source: CHARACTER_ROTATION_TRACE_SOURCE,
        result: selectedCharacterId,
        presetId,
        currentIndex,
        currentRepeat,
        sequenceOrdinal,
        pinnedCharacterIds,
    }
    const trace: RandomTraceEntry = {
        ruleId: CHARACTER_ROTATION_TRACE_RULE_ID,
        streamKey: CHARACTER_ROTATION_TRACE_SOURCE,
        drawIndex: sequenceOrdinal,
        seed,
        result: selectedCharacterId,
        selectedOptionIds: [selectedCharacterId],
        provenance: {
            kind: 'external',
            source: CHARACTER_ROTATION_TRACE_SOURCE,
        },
        extensions: {
            source: CHARACTER_ROTATION_TRACE_SOURCE,
            presetId,
            currentIndex,
            currentRepeat,
            sequenceOrdinal,
            pinnedCharacterIds,
            seedAffectsSelection: false,
        },
    }

    return {
        source: CHARACTER_ROTATION_TRACE_SOURCE,
        selectedCharacterId,
        pinnedCharacterIds,
        currentIndex,
        currentRepeat,
        sequenceOrdinal,
        presetId,
        trace,
        metadata,
    }
}

/**
 * Projects the selection into request-scoped character patches. It performs no
 * store writes; the existing enable-state mutation remains a legacy UI/runtime
 * compatibility concern owned by the rotation store.
 */
export function createRuntimeCharacterOverrides(
    selection: CharacterRotationRuntimeSelection | null,
    availableCharacterIds: readonly EntityId[],
    options: CharacterRotationOverrideOptions = {},
): CharacterSlotPatch[] {
    if (selection === null) return []

    const characterIds = uniqueEntityIds(availableCharacterIds)
    // Preserve the selected stable ID in the request even if the live character
    // list changed. Composition validation can then surface the stale target.
    if (!characterIds.includes(selection.selectedCharacterId)) {
        characterIds.push(selection.selectedCharacterId)
    }

    const enabledIds = new Set<EntityId>([selection.selectedCharacterId])
    if (!options.excludePinned) {
        for (const id of selection.pinnedCharacterIds) enabledIds.add(id)
    }

    return characterIds.map(characterId => ({
        characterId,
        enabled: enabledIds.has(characterId),
        extensions: {
            source: CHARACTER_ROTATION_TRACE_SOURCE,
            selectedCharacterId: selection.selectedCharacterId,
            sequenceOrdinal: selection.sequenceOrdinal,
        },
    }))
}
