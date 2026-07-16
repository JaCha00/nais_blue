import {
    type DecodedOrganizerImage,
    OrganizerMetadataError,
} from '@/domain/organizer/metadata-sanitizer'
import type { OrganizerAlphaPolicy, OrganizerDistributionFormat, OrganizerSourceImageFormat } from '@/domain/organizer/types'

export interface OrganizerTranscodeRequest {
    readonly sourceBytes: Uint8Array
    readonly sourceFormat: OrganizerSourceImageFormat
    readonly targetFormat: OrganizerDistributionFormat
    readonly webpLossless: boolean
    readonly quality: number
    readonly alphaPolicy: OrganizerAlphaPolicy
    readonly matteColor: string
}

export interface OrganizerImageTranscoder {
    readonly supportsLosslessWebp: boolean
    decode(bytes: Uint8Array, format: OrganizerSourceImageFormat | OrganizerDistributionFormat): Promise<DecodedOrganizerImage>
    transcode(request: OrganizerTranscodeRequest): Promise<Uint8Array>
}

export class OrganizerImageTranscoderError extends Error {
    constructor(
        readonly code: 'E_ORGANIZER_TRANSCODER_UNAVAILABLE' | 'E_ORGANIZER_LOSSLESS_WEBP_UNSUPPORTED' | 'E_ORGANIZER_DECODE_FAILED',
        message: string,
    ) {
        super(message)
        this.name = 'OrganizerImageTranscoderError'
    }
}

function mimeType(format: OrganizerSourceImageFormat | OrganizerDistributionFormat): string {
    switch (format) {
        case 'jpeg': return 'image/jpeg'
        case 'webp': return 'image/webp'
        default: return 'image/png'
    }
}

function dataUrl(bytes: Uint8Array, format: OrganizerSourceImageFormat | OrganizerDistributionFormat): string {
    let binary = ''
    const chunkSize = 32_768
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    return `data:${mimeType(format)};base64,${btoa(binary)}`
}

function normalizeQuality(quality: number): number {
    if (!Number.isFinite(quality)) return 0.92
    return Math.min(1, Math.max(0, quality))
}

function parseMatteColor(value: string): [number, number, number] {
    const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value.trim())
    if (!match) return [255, 255, 255]
    return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)]
}

function flattenedPixels(source: Uint8ClampedArray, matteColor: string): Uint8ClampedArray {
    const [matteRed, matteGreen, matteBlue] = parseMatteColor(matteColor)
    const result = new Uint8ClampedArray(source.length)
    for (let offset = 0; offset < source.length; offset += 4) {
        const alpha = source[offset + 3] / 255
        result[offset] = Math.round(source[offset] * alpha + matteRed * (1 - alpha))
        result[offset + 1] = Math.round(source[offset + 1] * alpha + matteGreen * (1 - alpha))
        result[offset + 2] = Math.round(source[offset + 2] * alpha + matteBlue * (1 - alpha))
        result[offset + 3] = 255
    }
    return result
}

function ensureCanvasRuntime(): void {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
        throw new OrganizerImageTranscoderError(
            'E_ORGANIZER_TRANSCODER_UNAVAILABLE',
            'Image conversion requires the desktop WebView canvas runtime.',
        )
    }
}

async function loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new OrganizerImageTranscoderError('E_ORGANIZER_DECODE_FAILED', 'Image decode failed.'))
        image.src = source
    })
}

async function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob === null) {
                reject(new OrganizerImageTranscoderError('E_ORGANIZER_DECODE_FAILED', 'Canvas encoder did not produce an image.'))
                return
            }
            resolve(blob)
        }, type, quality)
    })
}

export class CanvasOrganizerImageTranscoder implements OrganizerImageTranscoder {
    /** Browser canvas exposes quality but does not guarantee lossless WebP. */
    readonly supportsLosslessWebp = false

    async decode(
        bytes: Uint8Array,
        format: OrganizerSourceImageFormat | OrganizerDistributionFormat,
    ): Promise<DecodedOrganizerImage> {
        ensureCanvasRuntime()
        const image = await loadImage(dataUrl(bytes, format))
        let canvas: HTMLCanvasElement | null = null
        try {
            canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth || image.width
            canvas.height = image.naturalHeight || image.height
            const context = canvas.getContext('2d', { willReadFrequently: true })
            if (context === null || canvas.width <= 0 || canvas.height <= 0) {
                throw new OrganizerImageTranscoderError('E_ORGANIZER_DECODE_FAILED', 'Image dimensions are unavailable.')
            }
            context.drawImage(image, 0, 0)
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
            return {
                width: canvas.width,
                height: canvas.height,
                rgba: new Uint8ClampedArray(pixels),
                colorSpace: 'srgb',
            }
        } finally {
            image.src = ''
            if (canvas !== null) {
                canvas.width = 0
                canvas.height = 0
            }
        }
    }

    async transcode(request: OrganizerTranscodeRequest): Promise<Uint8Array> {
        if (request.targetFormat === 'webp' && request.webpLossless) {
            throw new OrganizerImageTranscoderError(
                'E_ORGANIZER_LOSSLESS_WEBP_UNSUPPORTED',
                'This runtime cannot prove a lossless WebP conversion. Keep the original WebP or choose PNG.',
            )
        }
        const decoded = await this.decode(request.sourceBytes, request.sourceFormat)
        ensureCanvasRuntime()
        let canvas: HTMLCanvasElement | null = null
        try {
            canvas = document.createElement('canvas')
            canvas.width = decoded.width
            canvas.height = decoded.height
            const context = canvas.getContext('2d')
            if (context === null) {
                throw new OrganizerImageTranscoderError('E_ORGANIZER_DECODE_FAILED', 'Canvas context is unavailable.')
            }
            const pixels = request.alphaPolicy === 'flatten'
                ? flattenedPixels(decoded.rgba, request.matteColor)
                : decoded.rgba
            const imageData = context.createImageData(decoded.width, decoded.height)
            imageData.data.set(pixels)
            context.putImageData(imageData, 0, 0)
            const blob = await canvasBlob(canvas, mimeType(request.targetFormat), normalizeQuality(request.quality))
            return new Uint8Array(await blob.arrayBuffer())
        } finally {
            if (canvas !== null) {
                canvas.width = 0
                canvas.height = 0
            }
        }
    }
}

export function dataUrlForOrganizerImage(
    bytes: Uint8Array,
    format: OrganizerSourceImageFormat | OrganizerDistributionFormat,
): string {
    return dataUrl(bytes, format)
}

/** Re-export the metadata error for consumers that report a unified diagnostic. */
export { OrganizerMetadataError }
