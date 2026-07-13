import type { GenerationParams } from '@/services/novelai-types'
import { sha256Utf8 } from '@/domain/composition/canonical-serialize'
import { buildNais2Params, redactSentPayloadForMetadata } from '@/lib/generation-metadata'
import type { Nais2Params } from '@/lib/nais2-png-meta'
import { REDACTION_MARKERS, redactSnapshot } from '../helpers'

interface CapturedRequest {
    mode: 'streaming' | 'non-streaming'
    endpoint: string
    payload: Record<string, unknown>
}

interface PayloadParameters extends Record<string, unknown> {
    characterPrompts?: Array<Record<string, unknown>>
    director_reference_images?: unknown[]
    director_reference_images_cached?: unknown[]
    image?: unknown
    mask?: unknown
    reference_image_multiple?: unknown[]
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}

function summarizePayloadObject(payload: Record<string, unknown>): Record<string, unknown> {
    const parameters = asRecord(payload.parameters) as PayloadParameters

    return {
        action: payload.action,
        input: payload.input,
        model: payload.model,
        parameters: {
            width: parameters.width,
            height: parameters.height,
            seed: parameters.seed,
            sampler: parameters.sampler,
            steps: parameters.steps,
            scale: parameters.scale,
            cfgRescale: parameters.cfg_rescale,
            noiseSchedule: parameters.noise_schedule,
            negativePrompt: parameters.negative_prompt,
            qualityToggle: parameters.qualityToggle,
            ucPreset: parameters.ucPreset,
            useCoords: parameters.use_coords,
            imageFormat: parameters.image_format,
            stream: parameters.stream ?? null,
            characterPrompts: parameters.characterPrompts ?? [],
            sourceEdit: {
                imagePresent: Object.hasOwn(parameters, 'image'),
                maskPresent: Object.hasOwn(parameters, 'mask'),
                imageValue: Object.hasOwn(parameters, 'image') ? REDACTION_MARKERS.base64 : null,
                maskValue: Object.hasOwn(parameters, 'mask') ? REDACTION_MARKERS.base64 : null,
                strength: parameters.strength ?? parameters.inpaintImg2ImgStrength ?? null,
                noise: parameters.noise ?? null,
            },
            references: {
                characterInlineCount: parameters.director_reference_images?.length ?? 0,
                characterCachedCount: parameters.director_reference_images_cached?.length ?? 0,
                vibeCount: parameters.reference_image_multiple?.length ?? 0,
            },
        },
    }
}

export function summarizeCapturedRequest(request: CapturedRequest): Record<string, unknown> {
    return {
        mode: request.mode,
        endpoint: request.endpoint,
        payload: summarizePayloadObject(request.payload),
    }
}

export function summarizeSentPayload(sentPayloadSummary: string | undefined): string | null {
    if (!sentPayloadSummary) return null
    return /^sha256:[0-9a-f]{64}$/i.test(sentPayloadSummary)
        ? sentPayloadSummary.toLowerCase()
        : `sha256:${sha256Utf8(sentPayloadSummary)}`
}

export function hashCapturedPayload(request: CapturedRequest): string {
    const redacted = redactSentPayloadForMetadata(JSON.stringify(request.payload))
    return `sha256:${sha256Utf8(redacted)}`
}

export function summarizeGenerationParams(params: GenerationParams): Record<string, unknown> {
    const characters = params.characterPrompts ?? []

    return {
        promptParts: params.promptParts,
        finalPositive: params.prompt,
        finalNegative: params.negative_prompt,
        characterPrompts: characters.map(character => ({
            name: 'name' in character ? character.name ?? null : null,
            positive: character.prompt,
            negative: character.negative,
            enabled: character.enabled,
        })),
        positions: characters.map(character => character.position),
        parameters: {
            model: params.model,
            width: params.width,
            height: params.height,
            steps: params.steps,
            cfg: params.cfg_scale,
            cfgRescale: params.cfg_rescale,
            sampler: params.sampler,
            scheduler: params.scheduler,
            smea: params.smea,
            smeaDyn: params.smea_dyn,
            variety: params.variety,
            seed: params.seed,
            qualityToggle: params.qualityToggle,
            ucPreset: params.ucPreset,
            imageFormat: params.imageFormat,
            metadataMode: params.metadataMode ?? null,
            characterPositionEnabled: params.characterPositionEnabled,
        },
        sourceEdit: {
            imagePresent: Boolean(params.sourceImage),
            maskPresent: Boolean(params.mask),
            strength: params.strength,
            noise: params.noise,
            characterReferenceCount: params.charImages?.length ?? 0,
            vibeReferenceCount: params.vibeImages?.length ?? 0,
        },
        assetModule: params.assetModulePlan
            ? {
                recipeId: params.assetModulePlan.recipeId,
                promptGroups: params.assetModulePlan.promptGroups,
                fileName: params.assetModulePlan.output.fileName,
                outputTargetPolicy: params.assetModulePlan.output.directory ?? null,
                warnings: params.assetModulePlan.warnings,
            }
            : null,
    }
}

export function summarizeMetadata(
    params: GenerationParams,
    sentPayloadSummary: string | undefined,
): Record<string, unknown> {
    const metadata = buildNais2Params({ ...params, sentPayloadSummary })

    return summarizeNais2Metadata(metadata)!
}

export function summarizeNais2Metadata(metadata: Nais2Params | null): Record<string, unknown> | null {
    if (!metadata) return null

    return {
        qualityToggle: metadata.qualityToggle,
        ucPreset: metadata.ucPreset,
        promptParts: metadata.promptParts,
        assetModulePlan: metadata.assetModulePlan ?? null,
        sentPayloadHash: metadata.version === 2
            ? metadata.redactedPayloadHash
            : summarizeSentPayload(metadata.sentPayloadSummary),
    }
}

export function redactedGolden<T>(value: T): T {
    return redactSnapshot(value, { rawBase64MinimumLength: 64 }) as T
}

export type { CapturedRequest }
