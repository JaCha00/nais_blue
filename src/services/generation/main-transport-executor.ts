import type { GenerateImageResult, GenerationParams } from '@/services/novelai-types'
import { executeNovelAIImageTransport } from './novelai-image-transport'

export interface MainGenerationTransportRequest {
    token: string
    params: GenerationParams
    imageFormat: NonNullable<GenerationParams['imageFormat']>
    streaming: boolean
    signal: AbortSignal
    shouldPublishProgress: () => boolean
    onProgress: (progress: number, previewImage?: string) => void
}

/**
 * Depends only on the NovelAI client and is called by the Main store.
 * The store retains session, output, History, and CAS ownership; this boundary
 * invokes its caller-supplied gate before forwarding format-normalized previews.
 */
export async function executeMainGenerationTransport(
    request: MainGenerationTransportRequest,
): Promise<GenerateImageResult> {
    return executeNovelAIImageTransport({
        token: request.token,
        params: request.params,
        imageFormat: request.imageFormat,
        streaming: request.streaming,
        signal: request.signal,
        onProgress: (progress, previewImage) => {
            if (!request.shouldPublishProgress()) return
            request.onProgress(progress, previewImage)
        },
    })
}
