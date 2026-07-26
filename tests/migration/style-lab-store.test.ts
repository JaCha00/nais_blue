import { describe, expect, it } from 'vitest'
import { STYLE_LAB_RANDOM_ALGORITHM } from '@/domain/style-lab'
import { styleCombinationIdentity } from '@/domain/style-lab'
import {
    STYLE_LAB_STORE_SCHEMA_VERSION,
    migrateStyleLabPersistedState,
} from '@/stores/style-lab-store-migration'

describe('Style-Lab persisted store migration', () => {
    it('preserves legacy candidates while clearing an unverifiable Arena round', () => {
        const legacy = {
            combinations: [{ id: 'legacy-a', elo: 1240 }, { id: 'legacy-b', elo: 1160 }],
            activeBattlePair: ['legacy-a', 'legacy-b'],
            settings: { minTags: 3 },
        }
        const first = migrateStyleLabPersistedState(legacy, 0)
        const replay = migrateStyleLabPersistedState(legacy, 0)
        const identity = styleCombinationIdentity([])

        expect(first.combinations).toMatchObject([
            {
                id: 'legacy-a',
                elo: 1240,
                ...identity,
                lifecycle: 'draft',
                lineage: { childId: 'legacy-a', operator: 'legacy-import' },
                legacyElo: 1240,
                legacyBattles: 0,
                legacyFavorite: false,
                ties: 0,
            },
            {
                id: 'legacy-b',
                elo: 1160,
                ...identity,
                lifecycle: 'draft',
                lineage: { childId: 'legacy-b', operator: 'legacy-import' },
                legacyElo: 1160,
                legacyBattles: 0,
                legacyFavorite: false,
                ties: 0,
            },
        ])
        expect(first.settings).toEqual(legacy.settings)
        expect(first.schemaVersion).toBe(STYLE_LAB_STORE_SCHEMA_VERSION)
        expect(first.activeBattlePair).toBeNull()
        expect(first.activeEvaluationContext).toBeNull()
        expect(first.randomState).toEqual(replay.randomState)
        expect(first.randomState).toMatchObject({
            algorithm: STYLE_LAB_RANDOM_ALGORITHM,
            sequence: 0,
        })
    })

    it('keeps a valid current RNG cursor', () => {
        const randomState = {
            algorithm: STYLE_LAB_RANDOM_ALGORITHM,
            seed: 123,
            sequence: 9,
        }
        expect(migrateStyleLabPersistedState({ randomState }, 3).randomState).toEqual(randomState)
    })
})
