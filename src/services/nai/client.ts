import JSZip from 'jszip'
import { invoke } from '@tauri-apps/api/core'
import { embedNais2Params } from '@/lib/nais2-png-meta'
import {
    buildNais2Params,
    redactSentPayloadForMetadata,
    shouldEmbedNais2Params,
} from '@/lib/generation-metadata'
import { adaptGenerationParams } from '@/services/nai/adapter'
import { NAI_ENDPOINTS } from '@/services/nai/endpoints'
import { buildGenerateImagePayload } from '@/services/nai/payload'
import { stripBase64Header } from '@/services/nai/refs'
import { readNaiImageStream } from '@/services/nai/stream'
import {
    NovelAIHttpError,
    type AnlasInfo,
    type GenerateImageResult,
    type GenerationParams,
} from '@/services/novelai-types'

const CLIENT_FETCH = window.fetch.bind(window)

const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'NAIS2_Client/1.0',
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
}

function errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function taggedImage(base64: string, params: GenerationParams): string {
    return shouldEmbedNais2Params(params.metadataMode)
        ? embedNais2Params(base64, buildNais2Params(params))
        : base64
}

async function firstZipEntryBase64(data: ArrayBuffer, emptyMessage: string): Promise<string> {
    const zip = await JSZip.loadAsync(data)
    const filename = Object.keys(zip.files)[0]
    if (!filename) throw new Error(emptyMessage)
    const file = zip.file(filename)
    if (!file) throw new Error('ZIP 파일에서 이미지를 읽을 수 없습니다.')
    return file.async('base64')
}

function makeSentPayloadSummary(sentPayload: string): string {
    return redactSentPayloadForMetadata(sentPayload)
}

export async function getUserInfo(token: string): Promise<{ anlas: AnlasInfo } | null> {
    try {
        const result = await invoke<{ success: boolean; fixed?: number; purchased?: number; error?: string }>(
            'get_anlas_balance',
            { token: token.trim() },
        )
        if (!result.success) return null
        const fixed = result.fixed ?? 0
        const purchased = result.purchased ?? 0
        return { anlas: { fixed, purchased, total: fixed + purchased } }
    } catch (error) {
        console.error('getUserInfo error:', error)
        return null
    }
}

export async function verifyToken(token: string): Promise<{
    valid: boolean
    tier?: 'paper' | 'tablet' | 'scroll' | 'opus'
    error?: string
}> {
    try {
        const result = await invoke<{ valid: boolean; tier?: string; error?: string }>(
            'verify_token',
            { token: token.trim() },
        )
        if (result.valid && result.tier) {
            return { valid: true, tier: result.tier as 'paper' | 'tablet' | 'scroll' | 'opus' }
        }
        return { valid: false, error: result.error || '인증 실패' }
    } catch (error) {
        return { valid: false, error: `Rust 통신 오류: ${error}` }
    }
}

export async function getAnlasBalance(token: string): Promise<{
    success: boolean
    fixedTrainingStepsLeft?: number
    purchasedTrainingSteps?: number
    error?: string
}> {
    try {
        const result = await invoke<{ success: boolean; fixed?: number; purchased?: number; error?: string }>(
            'get_anlas_balance',
            { token: token.trim() },
        )
        return {
            success: result.success,
            fixedTrainingStepsLeft: result.fixed,
            purchasedTrainingSteps: result.purchased,
            error: result.error,
        }
    } catch (error) {
        return { success: false, error: `Rust invoke failed: ${error}` }
    }
}

export async function generateImage(
    token: string,
    params: GenerationParams,
    signal?: AbortSignal,
): Promise<GenerateImageResult> {
    if (!token) return { success: false, error: 'API 토큰이 필요합니다' }

    try {
        const adapted = await adaptGenerationParams(token, params)
        const payload = buildGenerateImagePayload(adapted.request, adapted.buildOptions)
        const sentPayload = JSON.stringify(payload)
        const response = await CLIENT_FETCH(NAI_ENDPOINTS.generateImage, {
            method: 'POST',
            headers: {
                ...DEFAULT_HEADERS,
                Authorization: `Bearer ${token.trim()}`,
            },
            body: sentPayload,
            signal,
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new NovelAIHttpError(response.status, errorText)
        }

        const sentPayloadSummary = makeSentPayloadSummary(sentPayload)
        const imageData = await firstZipEntryBase64(await response.arrayBuffer(), 'ZIP 파일이 비어있습니다.')
        return {
            success: true,
            imageData: taggedImage(imageData, { ...params, sentPayloadSummary }),
            encodedVibes: adapted.encodedVibes,
            sentPayloadSummary,
        }
    } catch (error) {
        if (error instanceof NovelAIHttpError) throw error
        if (isAbortError(error)) return { success: false, error: '요청이 취소되었습니다.' }
        console.error('Generation error:', error)
        return { success: false, error: `생성 오류: ${errorToMessage(error)}` }
    }
}

export async function generateImageStream(
    token: string,
    params: GenerationParams,
    onProgress?: (progress: number, partialImage?: string) => void,
    signal?: AbortSignal,
): Promise<GenerateImageResult> {
    if (!token) return { success: false, error: 'API 토큰이 필요합니다' }

    try {
        const adapted = await adaptGenerationParams(token, params, 'msgpack')
        const payload = buildGenerateImagePayload(adapted.request, adapted.buildOptions)
        const sentPayload = JSON.stringify(payload)
        const response = await CLIENT_FETCH(NAI_ENDPOINTS.generateImageStream, {
            method: 'POST',
            headers: {
                ...DEFAULT_HEADERS,
                Authorization: `Bearer ${token.trim()}`,
                Accept: 'application/x-msgpack',
            },
            body: sentPayload,
            signal,
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new NovelAIHttpError(response.status, errorText)
        }
        if (!response.body) return { success: false, error: '스트리밍 응답 없음' }

        let lastStepShown = -1
        const totalSteps = params.steps || 28
        const sentPayloadSummary = makeSentPayloadSummary(sentPayload)
        const imageData = await readNaiImageStream(response.body, {
            onEvent: event => {
                if (typeof event.stepIx === 'number') {
                    const progress = Math.round((event.stepIx / totalSteps) * 100)
                    if (event.eventType === 'intermediate' && event.imageBase64 && event.stepIx > lastStepShown + 1) {
                        lastStepShown = event.stepIx
                        onProgress?.(progress, event.imageBase64)
                    } else if (event.eventType === 'intermediate') {
                        onProgress?.(progress)
                    }
                }
                if (event.eventType === 'final') onProgress?.(100, event.imageBase64)
            },
        }, signal)

        return {
            success: true,
            imageData: taggedImage(imageData, { ...params, sentPayloadSummary }),
            encodedVibes: adapted.encodedVibes,
            sentPayloadSummary,
        }
    } catch (error) {
        if (error instanceof NovelAIHttpError) throw error
        if (isAbortError(error)) return { success: false, error: '요청이 취소되었습니다.' }
        console.error('[Stream] Error:', error)
        return { success: false, error: `스트리밍 오류: ${errorToMessage(error)}` }
    }
}

async function augmentViaFormData(
    token: string,
    imageBase64: string,
    width: number,
    height: number,
    reqType: string,
    defry?: number,
    prompt?: string,
): Promise<string> {
    const rawBase64 = stripBase64Header(imageBase64)
    const payload: Record<string, unknown> = {
        image: 'image',
        width,
        height,
        req_type: reqType,
    }
    if (reqType === 'colorize' || reqType === 'emotion') {
        payload.defry = defry ?? 0
        payload.prompt = prompt || ''
    }

    const imageBytes = Uint8Array.from(atob(rawBase64), char => char.charCodeAt(0))
    const formData = new FormData()
    formData.append('image', new Blob([imageBytes], { type: 'image/png' }), 'image.png')
    formData.append('request', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'blob')

    const response = await CLIENT_FETCH(NAI_ENDPOINTS.augmentImage, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.trim()}` },
        body: formData,
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new NovelAIHttpError(response.status, errorText)
    }
    return firstZipEntryBase64(await response.arrayBuffer(), 'ZIP 파일이 비어있습니다')
}

export async function augmentImage(
    token: string,
    imageBase64: string,
    width: number,
    height: number,
    reqType: string,
    defry?: number,
    prompt?: string,
): Promise<{ success: boolean; imageData?: string; error?: string }> {
    try {
        return {
            success: true,
            imageData: await augmentViaFormData(token, imageBase64, width, height, reqType, defry, prompt),
        }
    } catch (error) {
        if (error instanceof NovelAIHttpError) {
            return { success: false, error: `API 오류 ${error.status}: ${error.responseBody}` }
        }
        return { success: false, error: `Augment error: ${errorToMessage(error)}` }
    }
}

export async function upscaleImage(
    token: string,
    imageBase64: string,
    width: number,
    height: number,
    scale: number = 4,
): Promise<{ success: boolean; imageData?: string; error?: string }> {
    try {
        const result = await invoke<{ success: boolean; image_data?: string; error?: string }>('upscale_image', {
            token: token.trim(),
            image: stripBase64Header(imageBase64),
            width,
            height,
            scale,
        })
        return {
            success: result.success,
            imageData: result.image_data,
            error: result.error,
        }
    } catch (error) {
        return { success: false, error: `Rust invoke failed: ${error}` }
    }
}
