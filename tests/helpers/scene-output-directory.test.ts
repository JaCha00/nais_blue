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
    it('groups rotation characters under one parent and removes only the Scene leaf when disabled', () => {
        expect(resolveSceneOutputDirectory(base)).toMatchObject({
            directory: 'E:\\NAI\\Scenes/Story_Arc/Character_Scenes/Hero_01/Opening_Shot',
            nestedSegments: ['Story_Arc', 'Character_Scenes', 'Hero_01', 'Opening_Shot'],
        })
        expect(resolveSceneOutputDirectory({ ...base, sceneSubfoldersEnabled: false })).toMatchObject({
            directory: 'E:\\NAI\\Scenes/Story_Arc/Character_Scenes/Hero_01',
            nestedSegments: ['Story_Arc', 'Character_Scenes', 'Hero_01'],
        })
    })

    it('does not add the character parent to an ordinary Scene output', () => {
        expect(resolveSceneOutputDirectory({
            ...base,
            rotationCharacterFolderName: undefined,
        })).toMatchObject({
            directory: 'E:\\NAI\\Scenes/Story_Arc/Opening_Shot',
            nestedSegments: ['Story_Arc', 'Opening_Shot'],
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
