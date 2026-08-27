import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/indexed-db', () => ({
    indexedDBStorage: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
    },
}))

import { useGenerationStore } from '@/stores/generation-store'
import { createDefaultPreset, usePresetStore } from '@/stores/preset-store'

describe('preset store snapshots', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    beforeEach(() => {
        const defaultPreset = createDefaultPreset()
        const workingCopy = {
            ...usePresetStore.getState().workingCopy!,
            basePrompt: 'current draft',
            selectedResolution: { ...defaultPreset.selectedResolution },
        }
        usePresetStore.setState({
            presets: [defaultPreset],
            activePresetId: defaultPreset.id,
            workingCopy,
            savedSnapshot: workingCopy,
            dirty: true,
        })
    })

    it('appends a detached snapshot without changing active or generation state', () => {
        const before = usePresetStore.getState()
        const beforeGeneration = useGenerationStore.getState()
        const workingCopy = {
            ...before.workingCopy!,
            basePrompt: 'guided snapshot',
            selectedResolution: { label: 'Square', width: 1024, height: 1024 },
        }

        const id = before.saveSnapshot('Guided snapshot', workingCopy)
        const after = usePresetStore.getState()
        const saved = after.presets.find(preset => preset.id === id)

        expect(id).not.toBe(before.activePresetId)
        expect(saved).toMatchObject({
            id,
            name: 'Guided snapshot',
            ...workingCopy,
            isDefault: undefined,
        })
        expect(saved?.createdAt).toEqual(expect.any(Number))
        expect(saved?.selectedResolution).not.toBe(workingCopy.selectedResolution)
        expect(after.presets).toHaveLength(2)
        expect(after.activePresetId).toBe(before.activePresetId)
        expect(after.workingCopy).toBe(before.workingCopy)
        expect(after.savedSnapshot).toBe(before.savedSnapshot)
        expect(after.dirty).toBe(before.dirty)
        expect(useGenerationStore.getState()).toMatchObject({
            basePrompt: beforeGeneration.basePrompt,
            selectedResolution: beforeGeneration.selectedResolution,
        })
    })

    it('keeps ids unique when snapshots share a timestamp', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-08-27T00:00:00.000Z'))
        const saveSnapshot = usePresetStore.getState().saveSnapshot
        const workingCopy = usePresetStore.getState().workingCopy!

        const firstId = saveSnapshot('First', workingCopy)
        const secondId = saveSnapshot('Second', workingCopy)

        expect(secondId).not.toBe(firstId)
        expect(usePresetStore.getState().presets.map(preset => preset.id)).toEqual([
            'default',
            firstId,
            secondId,
        ])
    })
})
