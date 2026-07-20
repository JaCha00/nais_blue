/**
 * Depends only on browser base64 support and is shared by the trash metadata
 * viewer. It preserves JPEG/WebP declarations for library/history files so
 * MetadataDialog receives the same image type that was originally archived.
 */
export function detectImageMimeType(bytes: Uint8Array, sourcePath = ''): string {
    if (bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47) return 'image/png'
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (bytes.length >= 12
        && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
    if (bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a')) return 'image/gif'

    const extension = sourcePath.split(/[?#]/)[0].split('.').pop()?.toLowerCase()
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
    if (extension === 'webp') return 'image/webp'
    if (extension === 'gif') return 'image/gif'
    if (extension === 'bmp') return 'image/bmp'
    return 'image/png'
}

export function imageDataUrlFromBytes(bytes: Uint8Array, sourcePath = ''): string {
    let binary = ''
    for (let index = 0; index < bytes.byteLength; index += 1) binary += String.fromCharCode(bytes[index])
    return `data:${detectImageMimeType(bytes, sourcePath)};base64,${btoa(binary)}`
}
