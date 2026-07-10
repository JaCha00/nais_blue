import { BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import {
    getMediaStorageRoot,
    MEDIA_STORAGE_BASE_DIRECTORY,
    shouldUseAbsoluteMediaPath,
} from '@/platform/storage'

export interface SceneOutputPathRequest {
    sceneSavePath: string
    useAbsoluteScenePath: boolean
    presetName: string
    sceneName: string
    fileName: string
    rotationCharacterId?: string
    rotationCharacterFolderName?: string
}

export interface SceneOutputPath {
    fullPath: string
    writePath: string
    baseDir?: BaseDirectory
    safePresetName: string
    safeSceneName: string
    safeCharacterName: string | null
}

export const sanitizePathComponent = (value: string, fallback: string): string =>
    value.replace(/[<>:"/\\|?*]/g, '_').trim() || fallback

export function getRotationCharacterFolderName(characterId?: string, fallbackIndex = 0): string | null {
    if (!characterId) return null

    const character = useCharacterPromptStore.getState().characters.find(c => c.id === characterId)
    const promptLabel = character?.prompt?.split(',')[0]?.trim()
    const rawName = character?.name?.trim() || promptLabel || `Character_${fallbackIndex + 1}`
    return sanitizePathComponent(rawName, `Character_${fallbackIndex + 1}`)
}

// save-scene-result.ts writes the bytes; this helper owns only the directory
// contract shared by normal scenes and rotation scenes.
export async function resolveSceneOutputPath(request: SceneOutputPathRequest): Promise<SceneOutputPath> {
    const safePresetName = sanitizePathComponent(request.presetName || 'Default', 'Default')
    const safeSceneName = sanitizePathComponent(request.sceneName || 'Untitled_Scene', 'Untitled_Scene')
    const safeCharacterName = request.rotationCharacterFolderName
        ? sanitizePathComponent(request.rotationCharacterFolderName, 'Character')
        : getRotationCharacterFolderName(request.rotationCharacterId)
    const sceneRoot = sanitizePathComponent(request.sceneSavePath || 'NAIS_Scene', 'NAIS_Scene')
    const pathSegments = [sceneRoot, safePresetName, ...(safeCharacterName ? [safeCharacterName] : []), safeSceneName]

    if (shouldUseAbsoluteMediaPath(request.useAbsoluteScenePath) && request.sceneSavePath) {
        const directoryPath = await join(request.sceneSavePath, safePresetName, ...(safeCharacterName ? [safeCharacterName] : []), safeSceneName)
        if (!(await exists(directoryPath))) {
            await mkdir(directoryPath, { recursive: true })
        }
        return {
            fullPath: await join(directoryPath, request.fileName),
            writePath: await join(directoryPath, request.fileName),
            safePresetName,
            safeSceneName,
            safeCharacterName,
        }
    }

    const relativeDirectory = pathSegments.join('/')
    if (!(await exists(relativeDirectory, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY }))) {
        await mkdir(relativeDirectory, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY, recursive: true })
    }

    return {
        fullPath: await join(await getMediaStorageRoot(), relativeDirectory, request.fileName),
        writePath: `${relativeDirectory}/${request.fileName}`,
        baseDir: MEDIA_STORAGE_BASE_DIRECTORY,
        safePresetName,
        safeSceneName,
        safeCharacterName,
    }
}
