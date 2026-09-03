/** Persisted Scene prompt fields retained by the V1 compatibility reader. */
export interface SceneV1PromptConfig {
    readonly base?: string
    readonly additional?: string
    readonly character?: string
    readonly negative?: string
    readonly characterNegative?: string
}

export interface SceneV1CharacterCaption {
    readonly id: string
    readonly name?: string
    readonly prompt: string
    readonly negative: string
    readonly enabled: boolean
    readonly position: { readonly x: number; readonly y: number }
}

export interface SceneV1GenerationConfig {
    readonly model?: string
    readonly steps?: number
    readonly cfgScale?: number
    readonly cfgRescale?: number
    readonly sampler?: string
    readonly scheduler?: string
    readonly smea?: boolean
    readonly smeaDyn?: boolean
    readonly variety?: boolean
    readonly qualityToggle?: boolean
    readonly ucPreset?: number
    readonly seed?: number
    readonly seedLocked?: boolean
}

export interface SceneV1LegacyImage {
    readonly id: string
    readonly url: string
    readonly timestamp: number
    readonly isFavorite: boolean
}

export interface SceneV1FolderTemplate {
    readonly sourceSceneId: string
    readonly sourceSceneName: string
    readonly scenePrompt: string
    readonly prompts: SceneV1PromptConfig
    readonly characterCaptions?: readonly SceneV1CharacterCaption[]
    readonly characterPositionEnabled?: boolean
    readonly generation: SceneV1GenerationConfig
    readonly width?: number
    readonly height?: number
    readonly excludePinned?: boolean
    readonly metadataMode?: 'embedded' | 'sidecar-only' | 'strip-and-sidecar' | 'strip-only'
    readonly filenameTemplate?: string
    readonly compositionRef?: unknown
}

/** Authoring-only projection; queue and presentation/session fields intentionally have no slot. */
export interface SceneV1AuthoringRecord {
    readonly id: string
    readonly name: string
    readonly scenePrompt: string
    readonly prompts?: SceneV1PromptConfig
    readonly characterCaptions?: readonly SceneV1CharacterCaption[]
    readonly characterPositionEnabled?: boolean
    readonly generation?: SceneV1GenerationConfig
    readonly images: readonly SceneV1LegacyImage[]
    readonly width?: number
    readonly height?: number
    readonly metadataMode?: 'embedded' | 'sidecar-only' | 'strip-and-sidecar' | 'strip-only'
    readonly generationFolderId?: string
    readonly filenameTemplate?: string
    readonly excludePinned?: boolean
    readonly compositionRef?: unknown
    readonly createdAt: number
}

export interface SceneV1PresetProjection {
    readonly id: string
    readonly name: string
    readonly scenes: readonly SceneV1AuthoringRecord[]
    readonly parentId?: string | null
    readonly defaultTemplate?: SceneV1FolderTemplate
    readonly createdAt: number
}

export interface SceneV1CompatibilityProjection {
    readonly presets: readonly SceneV1PresetProjection[]
}

/** Read-only seam over the current Zustand Scene V1 authority. */
export interface SceneRepositoryPort {
    readLegacyProjection(): Promise<SceneV1CompatibilityProjection | null>
}
