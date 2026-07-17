import {
    buildNais2Params,
    shouldWriteNais2Sidecar,
} from '@/lib/generation-metadata'
import {
    embedNaisBlueParams,
    encodeNaisBlueSidecar,
    type Nais2PromptParts,
} from '@/lib/nais2-png-meta'
import type { GenerationParams } from '@/services/novelai-types'
import { requireRuntimeCapability } from '@/platform/capabilities'

export type DiagnosticSidecarPolicy =
    | { enabled?: false }
    | {
        enabled: true
        acknowledgedSensitive: true
        redactedPayload: unknown
    }

export interface MetadataWriteRequest {
    params: GenerationParams
    imageFormat: 'png' | 'webp'
    metadataMode?: GenerationParams['metadataMode']
    fallbackPromptParts?: Nais2PromptParts
    includeWebpCompatibilitySidecar?: boolean
    diagnostic?: DiagnosticSidecarPolicy
}

export interface PreparedMetadataArtifacts {
    imageBytes: Uint8Array
    sidecarBytes?: Uint8Array
    diagnosticSidecarBytes?: Uint8Array
}

export interface OutputMetadataWriter {
    prepare(imageBytes: Uint8Array, request?: MetadataWriteRequest): PreparedMetadataArtifacts
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    const chunkSize = 32_768
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export class MetadataWriter implements OutputMetadataWriter {
    prepare(imageBytes: Uint8Array, request?: MetadataWriteRequest): PreparedMetadataArtifacts {
        if (request === undefined) return { imageBytes }

        const metadataMode = request.metadataMode ?? request.params.metadataMode
        const effectiveParams: GenerationParams = {
            ...request.params,
            imageFormat: request.imageFormat,
            metadataMode,
            ...(request.params.outputPolicySummary === undefined
                ? {}
                : {
                    outputPolicySummary: {
                        ...request.params.outputPolicySummary,
                        imageFormat: request.imageFormat,
                        metadataMode: metadataMode ?? 'embedded',
                    },
                }),
        }
        const params = buildNais2Params(effectiveParams, request.fallbackPromptParts)
        const shouldEmbed = request.imageFormat === 'png'
            && metadataMode !== 'sidecar-only'
            && metadataMode !== 'strip-and-sidecar'
        if (shouldEmbed) requireRuntimeCapability('embeddedPngMetadataWrite')
        const preparedImage = shouldEmbed
            ? base64ToBytes(embedNaisBlueParams(bytesToBase64(imageBytes), params))
            : imageBytes
        const writeSidecar = shouldWriteNais2Sidecar(
            metadataMode,
            request.imageFormat,
            request.includeWebpCompatibilitySidecar ?? true,
        )

        return {
            imageBytes: preparedImage,
            ...(writeSidecar ? { sidecarBytes: encodeNaisBlueSidecar(params) } : {}),
            ...(request.diagnostic?.enabled === true
                ? {
                    diagnosticSidecarBytes: new TextEncoder().encode(JSON.stringify({
                        format: 'nais-blue-diagnostic-sidecar',
                        version: 1,
                        warning: 'Opt-in diagnostic data; do not redistribute without review.',
                        redactedPayload: request.diagnostic.redactedPayload,
                    }, null, 2)),
                }
                : {}),
        }
    }
}
