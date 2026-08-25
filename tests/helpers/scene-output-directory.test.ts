import { describe, expect, it } from 'vitest'

import { resolveSceneOutputDirectory } from '@/lib/scene-generation/save-scene-result'

const base = {
    sceneSavePath: 'E:\\NAI\\Scenes',
    useAbsoluteScenePath: true,
    presetName: 'Story:Arc',
    presetPathSegments: ['Story:Arc'],
    sceneName: 'Opening/Shot',
    rotationCharacterFolderName: 'Hero*01',
}

describe('Scene output directory policy', () => {
    it('keeps the legacy Scene folder by default and removes only that last segment when disabled', () => {
        expect(resolveSceneOutputDirectory(base)).toMatchObject({
            directory: 'E:\\NAI\\Scenes/Story_Arc/Hero_01/Opening_Shot',
            nestedSegments: ['Story_Arc', 'Hero_01', 'Opening_Shot'],
        })
        expect(resolveSceneOutputDirectory({ ...base, sceneSubfoldersEnabled: false })).toMatchObject({
            directory: 'E:\\NAI\\Scenes/Story_Arc/Hero_01',
            nestedSegments: ['Story_Arc', 'Hero_01'],
        })
    })

    it('does not add hierarchy to an explicitly selected generation folder', () => {
        expect(resolveSceneOutputDirectory({
            ...base,
            exactDirectory: 'E:\\NAI\\R2-Staging',
            sceneSubfoldersEnabled: false,
        })).toMatchObject({
            directory: 'E:\\NAI\\R2-Staging',
            nestedSegments: [],
        })
    })
})
