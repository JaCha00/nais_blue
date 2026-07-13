import { describe, expect, it } from 'vitest'

import {
    CHARACTER_ROTATION_TRACE_SOURCE,
    createRuntimeCharacterOverrides,
    getRuntimeSelection,
} from '@/lib/character-rotation-runtime'
import { loadFixtureJson } from '../helpers'

interface RotationSequenceFixture {
    case: string
    description: string
    seed: number
    presetId: string
    characterIds: string[]
    pinnedCharacterIds: string[]
    availableCharacterIds: string[]
    sequence: Array<{
        currentIndex: number
        currentRepeat: number
        selectedCharacterId: string
        sequenceOrdinal: number
    }>
    invariants: {
        source: string
        seedAffectsSelection: boolean
        pinnedEnabledByDefault: boolean
        excludePinnedDisablesPinned: boolean
    }
}

describe('character rotation runtime characterization', () => {
    it('keeps the persisted fixed-order sequence and records source/result trace metadata', async () => {
        const fixture = await loadFixtureJson<RotationSequenceFixture>(
            'workflows/scene/character-rotation-sequence.json',
        )

        const selections = fixture.sequence.map(entry => getRuntimeSelection({
            active: true,
            characterIds: fixture.characterIds,
            pinnedCharacterIds: fixture.pinnedCharacterIds,
            currentIndex: entry.currentIndex,
            currentRepeat: entry.currentRepeat,
            snapshot: { presetId: fixture.presetId },
        }, fixture.seed))

        expect(selections.map(selection => selection?.selectedCharacterId)).toEqual(
            fixture.sequence.map(entry => entry.selectedCharacterId),
        )
        expect(selections.map(selection => selection?.sequenceOrdinal)).toEqual(
            fixture.sequence.map(entry => entry.sequenceOrdinal),
        )
        for (const selection of selections) {
            expect(selection).not.toBeNull()
            expect(selection?.source).toBe(CHARACTER_ROTATION_TRACE_SOURCE)
            expect(selection?.trace).toMatchObject({
                streamKey: fixture.invariants.source,
                seed: fixture.seed,
                result: selection?.selectedCharacterId,
                selectedOptionIds: [selection?.selectedCharacterId],
                extensions: {
                    source: fixture.invariants.source,
                    presetId: fixture.presetId,
                    currentIndex: selection?.currentIndex,
                    currentRepeat: selection?.currentRepeat,
                    sequenceOrdinal: selection?.sequenceOrdinal,
                    seedAffectsSelection: fixture.invariants.seedAffectsSelection,
                },
            })
            expect(selection?.metadata.result).toBe(selection?.selectedCharacterId)
        }

        const firstState = {
            active: true,
            characterIds: fixture.characterIds,
            pinnedCharacterIds: fixture.pinnedCharacterIds,
            currentIndex: fixture.sequence[0].currentIndex,
            currentRepeat: fixture.sequence[0].currentRepeat,
            snapshot: { presetId: fixture.presetId },
        }
        expect(getRuntimeSelection(firstState, fixture.seed)).toEqual(selections[0])
        const differentSeed = getRuntimeSelection(firstState, fixture.seed + 1)
        expect(differentSeed?.selectedCharacterId).toBe(selections[0]?.selectedCharacterId)
        expect(differentSeed?.trace.seed).toBe(fixture.seed + 1)
    })

    it('projects only the selected and optional pinned IDs into runtime character overrides', async () => {
        const fixture = await loadFixtureJson<RotationSequenceFixture>(
            'workflows/scene/character-rotation-sequence.json',
        )
        const first = fixture.sequence[0]
        const selection = getRuntimeSelection({
            active: true,
            characterIds: fixture.characterIds,
            pinnedCharacterIds: fixture.pinnedCharacterIds,
            currentIndex: first.currentIndex,
            currentRepeat: first.currentRepeat,
            snapshot: { presetId: fixture.presetId },
        }, fixture.seed)

        const defaults = createRuntimeCharacterOverrides(selection, fixture.availableCharacterIds)
        expect(defaults.filter(patch => patch.enabled).map(patch => patch.characterId)).toEqual([
            first.selectedCharacterId,
            ...fixture.pinnedCharacterIds,
        ])

        const excludingPinned = createRuntimeCharacterOverrides(
            selection,
            fixture.availableCharacterIds,
            { excludePinned: true },
        )
        expect(excludingPinned.filter(patch => patch.enabled).map(patch => patch.characterId)).toEqual([
            first.selectedCharacterId,
        ])
    })

    it('does not produce an override while rotation is inactive or the sequence cursor is invalid', () => {
        const base = {
            active: false,
            characterIds: ['character:hero'],
            pinnedCharacterIds: [],
            currentIndex: 0,
            currentRepeat: 0,
            snapshot: { presetId: 'preset:rotation' },
        }
        expect(getRuntimeSelection(base, 123)).toBeNull()
        expect(getRuntimeSelection({ ...base, active: true, currentIndex: 1 }, 123)).toBeNull()
        expect(createRuntimeCharacterOverrides(null, base.characterIds)).toEqual([])
    })
})
