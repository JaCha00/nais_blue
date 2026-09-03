import {
    generateImage,
    generateImageStream,
    type GenerateImageResult,
    type GenerationParams,
} from '@/services/novelai-api'
import type { NaiProviderFaultInjector } from '@/services/nai/transport'

export interface NovelAIImageTransportRequest {
    readonly token: string
    readonly params: GenerationParams
    readonly imageFormat: NonNullable<GenerationParams['imageFormat']>
    readonly streaming: boolean
    readonly signal: AbortSignal
    readonly onProgress?: (progress: number, previewImage?: string) => void
    readonly faultInjector?: NaiProviderFaultInjector
}

/**
 * Depends only on the NovelAI client and caller-owned cancellation/progress
 * callbacks. Main, Scene, and Style Lab use this boundary to select one provider
 * transport and normalize partial previews while retaining their own Queue,
 * timeout classification, output transaction, and UI projection policies.
 */
export async function executeNovelAIImageTransport(
    request: NovelAIImageTransportRequest,
): Promise<GenerateImageResult> {
    if (!request.streaming) {
        return request.faultInjector === undefined
            ? generateImage(request.token, request.params, request.signal)
            : generateImage(request.token, request.params, request.signal, request.faultInjector)
    }

    const mimeType = request.imageFormat === 'webp' ? 'image/webp' : 'image/png'
    const streamArguments = [
        request.token,
        request.params,
        (progress: number, partialImage?: string) => request.onProgress?.(
            progress,
            partialImage ? `data:${mimeType};base64,${partialImage}` : undefined,
        ),
        request.signal,
    ] as const
    return request.faultInjector === undefined
        ? generateImageStream(...streamArguments)
        : generateImageStream(...streamArguments, request.faultInjector)
}
