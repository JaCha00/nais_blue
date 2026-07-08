import type { AssetModulePlan } from '@/lib/asset-modules/resolver'
import type { Nais2Params, Nais2PromptParts } from '@/lib/nais2-png-meta'
import type { GenerationParams } from '@/services/novelai-types'

export type MetadataMode = 'embedded' | 'sidecar-only' | 'strip-and-sidecar'

export const DEFAULT_METADATA_MODE: MetadataMode = 'embedded'

export function shouldEmbedNais2Params(metadataMode: MetadataMode | undefined): boolean {
    return metadataMode !== 'sidecar-only' && metadataMode !== 'strip-and-sidecar'
}

export function shouldWriteNais2Sidecar(
    metadataMode: MetadataMode | undefined,
    imageFormat: 'png' | 'webp' | undefined,
    includeWebpCompatibility = false,
): boolean {
    return metadataMode === 'sidecar-only'
        || metadataMode === 'strip-and-sidecar'
        || (includeWebpCompatibility && imageFormat === 'webp')
}

function summarizeAssetModulePlan(plan: AssetModulePlan | undefined): Record<string, unknown> | undefined {
    if (!plan) return undefined

    return {
        recipeId: plan.recipeId,
        fileName: plan.output.fileName,
        outputPath: plan.outputPath,
        promptGroups: plan.promptGroups,
        warnings: plan.warnings,
        modules: plan.modules.map(({ module, step }) => ({
            id: module.id,
            kind: module.kind,
            label: module.label,
            stepEnabled: step.enabled !== false,
        })),
    }
}

export function buildNais2Params(
    params: GenerationParams,
    fallbackPromptParts?: Nais2PromptParts,
): Nais2Params {
    const promptParts = params.promptParts ?? fallbackPromptParts

    return {
        qualityToggle: params.qualityToggle,
        ucPreset: params.ucPreset,
        promptParts: promptParts && {
            base: promptParts.base ?? '',
            additional: promptParts.additional ?? '',
            detail: promptParts.detail ?? '',
            negative: promptParts.negative ?? '',
            inpainting: promptParts.inpainting ?? '',
        },
        assetModulePlan: summarizeAssetModulePlan(params.assetModulePlan),
    }
}

export function toSidecarPath(imagePath: string): string {
    return imagePath.replace(/\.[^./\\]+$/, '.nais2.json')
}

export function toSidecarFileName(fileName: string): string {
    return fileName.replace(/\.[^./\\]+$/, '.nais2.json')
}

export function ensureImageFileExtension(fileName: string | null | undefined, fileExt: string): string | null {
    const trimmed = fileName?.trim()
    if (!trimmed) return null
    if (new RegExp(`\\.${fileExt}$`, 'i').test(trimmed)) return trimmed
    return `${trimmed.replace(/\.[A-Za-z0-9]{2,5}$/, '')}.${fileExt}`
}

export function redactSentPayloadForMetadata(sentPayload: string): string {
    try {
        const payload = JSON.parse(sentPayload) as { parameters?: Record<string, unknown> }
        const params = payload.parameters
        if (!params) return JSON.stringify(payload)

        for (const key of [
            'image',
            'mask',
            'director_reference_images',
            'reference_image_multiple',
        ]) {
            if (key in params) params[key] = '[redacted-base64]'
        }

        return JSON.stringify(payload)
    } catch {
        return sentPayload
    }
}
