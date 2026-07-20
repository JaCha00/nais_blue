export type AssetProfilePrimitive = string | number | boolean | null
export type AssetProfileJsonValue =
    | AssetProfilePrimitive
    | AssetProfileJsonValue[]
    | { [key: string]: AssetProfileJsonValue }

export type AssetProfileJsonRecord = { [key: string]: AssetProfileJsonValue }
export type AssetProfileUpdatedBy = 'agent' | 'gui' | 'system' | (string & {})

export interface AssetProfileSettings extends AssetProfileJsonRecord {}

export interface AssetProfileOutput {
    directory?: string
    fileName?: string
    filenameTemplate?: string
    format?: string
    metadataMode?: 'embedded' | 'sidecar-only' | 'strip-and-sidecar' | 'strip-only'
    metadataSidecar?: boolean
    settings?: AssetProfileJsonRecord
}

export interface AssetProfileR2 {
    enabled: boolean
    bucket?: string
    keyPrefix?: string
    publicBaseUrl?: string
    accountId?: string
    metadata?: AssetProfileJsonRecord
}

export type AssetPromptTargetMap = Record<string, string | string[]>
export type AssetPromptSpec = string | string[] | AssetPromptTargetMap

export interface AssetModuleProfile {
    id: string
    enabled: boolean
    kind?: string
    label?: string
    target?: string
    order?: number
    prompt?: string
    prompts?: AssetPromptSpec
    negative?: string
    negativePrompt?: string
    settings: AssetProfileJsonRecord
    output?: AssetProfileOutput
    r2?: AssetProfileR2
}

export type AssetProfileModules = Record<string, AssetModuleProfile>

export interface AssetRecipeStep {
    moduleId: string
    enabled?: boolean
    target?: string
    order?: number
    prompt?: string
    prompts?: AssetPromptSpec
    negative?: string
    negativePrompt?: string
    settings?: AssetProfileJsonRecord
}

export interface AssetRecipe {
    id: string
    enabled: boolean
    label?: string
    steps: AssetRecipeStep[]
    settings?: AssetProfileJsonRecord
    output?: AssetProfileOutput
    r2?: AssetProfileR2
}

// Consumed by src/services/asset-profile-file.ts and mirrored by
// src/stores/asset-module-store.ts. Keep these top-level fields stable so both
// external agents and the GUI can edit the same JSON file without adapters.
export interface AssetProfile {
    revision: number
    updatedBy: AssetProfileUpdatedBy
    updatedAt: string
    settings: AssetProfileSettings
    output: AssetProfileOutput
    r2: AssetProfileR2
    modules: AssetProfileModules
    recipes: AssetRecipe[]
}

export function createDefaultAssetProfile(updatedAt = new Date().toISOString()): AssetProfile {
    return {
        revision: 0,
        updatedBy: 'system',
        updatedAt,
        settings: {},
        output: {},
        r2: {
            enabled: false,
        },
        modules: {},
        recipes: [],
    }
}
