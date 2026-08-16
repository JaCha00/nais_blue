import { stripImageMetadata } from '@/domain/organizer/metadata-sanitizer'
import { imageDataUrlFromBytes } from '@/lib/image-data-url'

function dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(base64)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function finalizePurgedImage(
    bytes: Uint8Array,
    imageFormat: 'png' | 'webp',
): { dataUrl: string; bytes: Uint8Array } {
    const stripped = stripImageMetadata(bytes)
    return {
        dataUrl: imageDataUrlFromBytes(stripped, `image.${imageFormat}`),
        bytes: stripped,
    }
}

/**
 * Browser re-encoding is the local counterpart to the Worker SVG wrapper: canvas requires decoded
 * pixels, the output writer consumes its byte result, and the black fill plus tiny blur destroys
 * alpha/RGB LSB payloads. Some WebView encoders add their own color profile, so the encoded
 * container is stripped once more before it can be written or validated.
 */
export async function eradicateImageMetadata(
    imageDataUrl: string,
    imageFormat: 'png' | 'webp',
): Promise<{ dataUrl: string; bytes: Uint8Array }> {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
        return finalizePurgedImage(dataUrlToBytes(imageDataUrl), imageFormat)
    }

    const source = new Image()
    source.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
        source.onload = () => resolve()
        source.onerror = () => reject(new Error('E_IMAGE_METADATA_PURGE_DECODE'))
        source.src = imageDataUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, source.naturalWidth)
    canvas.height = Math.max(1, source.naturalHeight)
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('E_IMAGE_METADATA_PURGE_CONTEXT')
    context.fillStyle = '#000000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.filter = 'blur(0.5px)'
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    context.filter = 'none'
    source.src = ''

    const mime = imageFormat === 'webp' ? 'image/webp' : 'image/png'
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error('E_IMAGE_METADATA_PURGE_ENCODE')), mime, 0.99)
    })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    canvas.width = 1
    canvas.height = 1
    return finalizePurgedImage(bytes, imageFormat)
}
