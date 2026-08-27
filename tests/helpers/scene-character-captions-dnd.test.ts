import { describe, expect, it } from 'vitest'

import {
    addMainCharacterToScene,
    placeSceneCharacterCaption,
} from '@/components/scene/SceneCharacterCaptionsEditor'
import type { SceneCharacterCaption } from '@/stores/scene-store'

const caption = (id: string, enabled = true): SceneCharacterCaption => ({
    id,
    name: id.toUpperCase(),
    prompt: `${id} prompt`,
    negative: `${id} negative`,
    enabled,
    position: { x: 0.25, y: 0.75 },
})

describe('Scene character caption drag placement', () => {
    it('moves a caption to Excluded without losing its local prompt fields', () => {
        const next = placeSceneCharacterCaption([caption('a'), caption('b')], 'a', false)

        expect(next.map(item => [item.id, item.enabled])).toEqual([
            ['b', true],
            ['a', false],
        ])
        expect(next[1]).toMatchObject({
            prompt: 'a prompt',
            negative: 'a negative',
            position: { x: 0.25, y: 0.75 },
        })
    })

    it('uses the hovered caption index when reordering the Included list', () => {
        const next = placeSceneCharacterCaption(
            [caption('a'), caption('b'), caption('c'), caption('x', false)],
            'a',
            true,
            'c',
        )

        expect(next.map(item => item.id)).toEqual(['b', 'c', 'a', 'x'])
    })

    it('copies a Main character once and preserves later Scene-local edits', () => {
        const first = addMainCharacterToScene([], {
            id: 'hero',
            name: 'Hero',
            prompt: 'main prompt',
            negative: 'main negative',
            position: { x: 0.4, y: 0.6 },
        })
        const edited = [{ ...first[0], prompt: 'scene-local prompt', enabled: false }]
        const restored = addMainCharacterToScene(edited, {
            id: 'hero',
            name: 'Renamed Main Hero',
            prompt: 'changed main prompt',
            negative: 'changed main negative',
            position: { x: 0.1, y: 0.2 },
        })

        expect(restored).toHaveLength(1)
        expect(restored[0]).toMatchObject({
            id: 'hero',
            name: 'Hero',
            prompt: 'scene-local prompt',
            enabled: true,
        })
    })
})
