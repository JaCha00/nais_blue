import { describe, expect, it } from 'vitest'

import type { SyncEntityRecord } from '@/domain/sync'
import { createDefaultPreset, type Preset } from '@/stores/preset-store'
import {
    presetFromLanSyncEntity,
    projectPresetForLanSync,
} from '@/services/sync/lan-session-runtime'

function entity(payload: ReturnType<typeof projectPresetForLanSync>): SyncEntityRecord {
    return {
        entityType: 'prompt.preset',
        entityId: String(payload.id),
        op: 'upsert',
        payload,
        conflictOfEntityId: null,
    } as SyncEntityRecord
}

describe('LAN session preset projection', () => {
    it('keeps portable prompt parameters while excluding unknown credentials and paths', () => {
        const candidate = {
            ...createDefaultPreset(),
            id: 'preset:mobile',
            name: 'Mobile portrait',
            basePrompt: 'blue hour portrait',
            steps: 32,
            token: 'CANARY-TOKEN',
            savePath: 'C:\\Users\\Canary\\output',
            imageBase64: 'CANARY-IMAGE',
        } as Preset & Record<string, unknown>

        const projected = projectPresetForLanSync(candidate, 7)

        expect(projected).toMatchObject({
            id: 'preset:mobile',
            basePrompt: 'blue hour portrait',
            steps: 32,
            orderKey: '00000007',
        })
        expect(projected).not.toHaveProperty('token')
        expect(projected).not.toHaveProperty('savePath')
        expect(projected).not.toHaveProperty('imageBase64')
    })

    it('reconstructs the local schema and rejects entity identity substitution', () => {
        const projected = projectPresetForLanSync({
            ...createDefaultPreset(),
            id: 'preset:desktop',
            name: 'Desktop preset',
            cfgScale: 6,
        }, 0)

        expect(presetFromLanSyncEntity(entity(projected))).toMatchObject({
            id: 'preset:desktop',
            name: 'Desktop preset',
            cfgScale: 6,
        })
        expect(() => presetFromLanSyncEntity({
            ...entity(projected),
            entityId: 'preset:substituted',
        })).toThrow(/identity/i)
    })
})
