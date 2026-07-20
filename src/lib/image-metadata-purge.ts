function dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, '')
    const binary = atob(base64)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/**
 * Browser re-encoding is the local counterpart to the Worker SVG wrapper: canvas requires decoded
 * pixels, the output writer consumes its byte result, and the black fill plus tiny blur destroys
 * alpha/RGB LSB payloads while the new encoder omits source PNG/WebP metadata chunks.
 */
export async function eradicateImageMetadata(
    imageDataUrl: string,
    imageFormat: 'png' | 'webp',
): Promise<{ dataUrl: string; bytes: Uint8Array }> {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
        return { dataUrl: imageDataUrl, bytes: dataUrlToBytes(imageDataUrl) }
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
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('E_IMAGE_METADATA_PURGE_DATA_URL'))
        reader.readAsDataURL(blob)
    })
    canvas.width = 1
    canvas.height = 1
    return { dataUrl, bytes }
}
