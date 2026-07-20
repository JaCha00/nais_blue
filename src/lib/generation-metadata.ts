import type { AssetModulePlan } from '@/lib/asset-modules/resolver'
import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type { RandomTraceEntry } from '@/domain/composition/types'
import type {
    Nais2CharacterMetadata,
    Nais2OutputPolicySummary,
    Nais2Params,
    Nais2PromptParts,
    Nais2ResolvedParams,
} from '@/lib/nais2-png-meta'
import { NAIS_BLUE_METADATA_NAME } from '@/lib/nais2-png-meta'
import type { GenerationParams } from '@/services/novelai-types'

export {
    ensureImageFileExtension,
    toSidecarFileName,
    toSidecarPath,
} from '@/services/output/filename-policy'

export type MetadataMode = 'embedded' | 'sidecar-only' | 'strip-and-sidecar' | 'strip-only'

export const DEFAULT_METADATA_MODE: MetadataMode = 'embedded'

export function cloneCompositionRandomTrace(
    entries: readonly DeepReadonly<RandomTraceEntry>[],
): RandomTraceEntry[] {
    // RandomTraceEntry is a JSON contract; cloning keeps immutable plans from
    // leaking mutable metadata objects into workflow and transport layers.
    return JSON.parse(JSON.stringify(entries)) as RandomTraceEntry[]
}

export function shouldEmbedNais2Params(metadataMode: MetadataMode | undefined): boolean {
    return metadataMode !== 'sidecar-only'
        && metadataMode !== 'strip-and-sidecar'
        && metadataMode !== 'strip-only'
}

export function shouldWriteNais2Sidecar(
    metadataMode: MetadataMode | undefined,
    imageFormat: 'png' | 'webp' | undefined,
    includeWebpCompatibility = false,
): boolean {
    if (metadataMode === 'strip-only') return false
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

function buildPromptParts(
    params: GenerationParams,
    fallbackPromptParts?: Nais2PromptParts,
): Nais2PromptParts {
    const promptParts = params.promptParts ?? fallbackPromptParts
    return {
        base: promptParts?.base ?? params.prompt ?? '',
        additional: promptParts?.additional ?? '',
        detail: promptParts?.detail ?? '',
        negative: promptParts?.negative ?? params.negative_prompt ?? '',
        inpainting: promptParts?.inpainting ?? '',
        workflow: promptParts?.workflow ?? '',
    }
}

function buildCharacterMetadata(params: GenerationParams): Nais2CharacterMetadata[] {
    return (params.characterPrompts ?? []).map((character, index) => {
        const deterministicId = sha256Utf8(JSON.stringify({
            index,
            prompt: character.prompt,
            negative: character.negative,
            position: character.position,
        }))
        return {
            stableId: character.stableId?.trim() || `generated:${deterministicId}`,
            prompt: character.prompt,
            negative: character.negative,
            enabled: character.enabled,
            positions: [{ x: character.position.x, y: character.position.y }],
        }
    })
}

function buildResolvedParams(params: GenerationParams): Nais2ResolvedParams {
    return {
        model: params.model,
        width: params.width,
        height: params.height,
        steps: params.steps,
        cfgScale: params.cfg_scale,
        cfgRescale: params.cfg_rescale,
        sampler: params.sampler,
        scheduler: params.scheduler,
        smea: params.smea,
        smeaDyn: params.smea_dyn,
        variety: params.variety,
        seed: params.seed,
        ...(params.qualityToggle === undefined ? {} : { qualityToggle: params.qualityToggle }),
        ...(params.ucPreset === undefined ? {} : { ucPreset: params.ucPreset }),
        sourceMode: params.mask
            ? 'inpaint'
            : params.sourceImage
                ? 'image-to-image'
                : 'text-to-image',
        ...(params.strength === undefined ? {} : { strength: params.strength }),
        ...(params.noise === undefined ? {} : { noise: params.noise }),
        ...(params.characterPositionEnabled === undefined
            ? {}
            : { characterPositionEnabled: params.characterPositionEnabled }),
    }
}

function summarizeOutputPolicy(params: GenerationParams): Nais2OutputPolicySummary {
    const requested = params.outputPolicySummary
    return {
        imageFormat: requested?.imageFormat ?? params.imageFormat ?? 'png',
        metadataMode: requested?.metadataMode ?? params.metadataMode ?? DEFAULT_METADATA_MODE,
        ...(requested?.destinationKind === undefined ? {} : { destinationKind: requested.destinationKind }),
        ...(requested?.writesSidecar === undefined ? {} : { writesSidecar: requested.writesSidecar }),
        ...(requested?.writesThumbnail === undefined ? {} : { writesThumbnail: requested.writesThumbnail }),
        ...(requested?.filenameTemplateId === undefined
            ? {}
            : { filenameTemplateId: requested.filenameTemplateId }),
        ...(requested?.collisionPolicy === undefined
            ? {}
            : { collisionPolicy: requested.collisionPolicy }),
    }
}

export function buildNais2Params(
    params: GenerationParams,
    fallbackPromptParts?: Nais2PromptParts,
): Nais2Params {
    const promptParts = buildPromptParts(params, fallbackPromptParts)
    const compactProvenance = params.compositionProvenanceSummary ?? {
        sourceCount: 0,
        promptContributionCount: 0,
        randomSelectionCount: params.compositionRandomTrace?.length ?? 0,
    }
    const redactedPayloadHash = params.sentPayloadSummary
        ? /^sha256:[0-9a-f]{64}$/i.test(params.sentPayloadSummary)
            ? params.sentPayloadSummary.toLowerCase()
            : `sha256:${sha256Utf8(params.sentPayloadSummary)}`
        : null

    return {
        version: 2,
        metadataName: NAIS_BLUE_METADATA_NAME,
        engineVersion: params.engineVersion
            ?? (params.compositionMode === 'v2' ? 'composition-engine-v1' : 'legacy-compatible'),
        sourceRevision: params.sourceRevision ?? null,
        ...(params.sourceJobId === undefined ? {} : { sourceJobId: params.sourceJobId }),
        recipeId: params.compositionRecipeId ?? params.assetModulePlan?.recipeId ?? null,
        planHash: params.compositionPlanHash ?? null,
        qualityToggle: params.qualityToggle,
        ucPreset: params.ucPreset,
        promptParts,
        characters: buildCharacterMetadata(params),
        resolvedParams: buildResolvedParams(params),
        randomTrace: cloneCompositionRandomTrace(params.compositionRandomTrace ?? []),
        compactProvenance,
        redactedPayloadHash,
        outputPolicySummary: summarizeOutputPolicy(params),
        assetModulePlan: summarizeAssetModulePlan(params.assetModulePlan),
        ...(params.compositionMode === undefined ? {} : { compositionMode: params.compositionMode }),
        ...(params.compositionPlanHash === undefined
            ? {}
            : { compositionPlanHash: params.compositionPlanHash }),
        ...(params.compositionPlanId === undefined ? {} : { compositionPlanId: params.compositionPlanId }),
        ...(params.compositionRecipeId === undefined
            ? {}
            : { compositionRecipeId: params.compositionRecipeId }),
        ...(params.compositionProvenanceSummary === undefined
            ? {}
            : { compositionProvenanceSummary: params.compositionProvenanceSummary }),
        ...(params.compositionRandomTrace === undefined
            ? {}
            : { compositionRandomTrace: cloneCompositionRandomTrace(params.compositionRandomTrace) }),
    }
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

        const cachedReferences = params.director_reference_images_cached
        if (Array.isArray(cachedReferences)) {
            params.director_reference_images_cached = cachedReferences.map(value => (
                value !== null && typeof value === 'object' && !Array.isArray(value)
                    ? { ...value, cache_secret_key: '[redacted-cache-key]' }
                    : '[redacted-cache-key]'
            ))
        }
        if ('image_cache_secret_key' in params) {
            params.image_cache_secret_key = '[redacted-cache-key]'
        }

        return JSON.stringify(payload)
    } catch {
        return sentPayload
    }
}
