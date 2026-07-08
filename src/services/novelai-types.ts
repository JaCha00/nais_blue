import type { AssetModulePlan } from '@/lib/asset-modules/resolver'
import type { MetadataMode } from '@/lib/generation-metadata'

export class NovelAIHttpError extends Error {
    readonly status: number
    readonly responseBody: string
    readonly retryable: boolean

    constructor(status: number, responseBody: string) {
        super(`API Error: ${status} ${responseBody}`)
        this.name = 'NovelAIHttpError'
        this.status = status
        this.responseBody = responseBody
        this.retryable = status === 429 || (status >= 500 && status < 600)
    }
}

export interface AnlasInfo {
    fixed: number
    purchased: number
    total: number
}

export interface GenerationParams {
    prompt: string
    negative_prompt: string
    model: string
    width: number
    height: number
    steps: number
    cfg_scale: number
    cfg_rescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smea_dyn: boolean
    variety: boolean
    seed: number
    charImages?: string[]
    charStrength?: number[]
    charFidelity?: number[]
    charReferenceType?: ('character' | 'style' | 'character&style' | 'costume' | 'delta')[]
    charCacheKeys?: (string | null)[]
    charInfo?: number[]
    vibeImages?: string[]
    vibeInfo?: number[]
    vibeStrength?: number[]
    preEncodedVibes?: (string | null)[]
    characterPrompts?: {
        prompt: string
        negative: string
        enabled: boolean
        position: { x: number, y: number }
    }[]
    characterPositionEnabled?: boolean
    sourceImage?: string
    strength?: number
    noise?: number
    mask?: string
    imageFormat?: 'png' | 'webp'
    metadataMode?: MetadataMode
    assetModulePlan?: AssetModulePlan
    qualityToggle?: boolean
    ucPreset?: number
    sentPayloadSummary?: string
    promptParts?: {
        base?: string
        additional?: string
        detail?: string
        negative?: string
        inpainting?: string
    }
}

export interface GenerateImageResult {
    success: boolean
    imageData?: string
    error?: string
    encodedVibes?: string[]
    sentPayloadSummary?: string
}
