export interface CleanImageEnv {
    KV: KVNamespace
}

function spliceBytes(bytes: Uint8Array, keep: ReadonlyArray<readonly [number, number]>): Uint8Array {
    const total = keep.reduce((sum, range) => sum + range[1] - range[0], 0)
    if (total === bytes.length && keep.length === 1 && keep[0][0] === 0 && keep[0][1] === bytes.length) return bytes
    const output = new Uint8Array(total)
    let offset = 0
    for (const [start, end] of keep) {
        output.set(bytes.subarray(start, end), offset)
        offset += end - start
    }
    return output
}

export function stripJpegExif(bytes: Uint8Array): Uint8Array {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
    const keep: Array<readonly [number, number]> = [[0, 2]]
    let cursor = 2
    while (cursor < bytes.length) {
        if (bytes[cursor] !== 0xff) { keep.push([cursor, bytes.length]); break }
        const marker = bytes[cursor + 1]
        if (marker === 0xda) { keep.push([cursor, bytes.length]); break }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            keep.push([cursor, cursor + 2]); cursor += 2; continue
        }
        if (cursor + 4 > bytes.length) break
        const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3]
        const end = cursor + 2 + length
        if (end > bytes.length) break
        if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) keep.push([cursor, end])
        cursor = end
    }
    return spliceBytes(bytes, keep)
}

export function stripPngMeta(bytes: Uint8Array): Uint8Array {
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return bytes
    const keep: Array<readonly [number, number]> = [[0, 8]]
    let cursor = 8
    while (cursor + 12 <= bytes.length) {
        const length = ((bytes[cursor] << 24) | (bytes[cursor + 1] << 16) | (bytes[cursor + 2] << 8) | bytes[cursor + 3]) >>> 0
        const type = String.fromCharCode(bytes[cursor + 4], bytes[cursor + 5], bytes[cursor + 6], bytes[cursor + 7])
        const end = cursor + 12 + length
        if (end > bytes.length) break
        if (!['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(type)) keep.push([cursor, end])
        cursor = end
        if (type === 'IEND') break
    }
    return spliceBytes(bytes, keep)
}

export function stripWebpMeta(bytes: Uint8Array): Uint8Array {
    if (bytes.length < 12
        || bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46
        || bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50) return bytes
    const keep: Array<readonly [number, number]> = [[0, 12]]
    let vp8xSourceOffset = -1
    let cursor = 12
    while (cursor + 8 <= bytes.length) {
        const type = String.fromCharCode(bytes[cursor], bytes[cursor + 1], bytes[cursor + 2], bytes[cursor + 3])
        const length = (bytes[cursor + 4] | (bytes[cursor + 5] << 8) | (bytes[cursor + 6] << 16) | (bytes[cursor + 7] << 24)) >>> 0
        const end = cursor + 8 + length + (length & 1)
        if (end > bytes.length) break
        if (type !== 'EXIF' && type !== 'XMP ') {
            keep.push([cursor, end])
            if (type === 'VP8X' && length >= 1) vp8xSourceOffset = cursor + 8
        }
        cursor = end
    }
    const output = spliceBytes(bytes, keep)
    if (output === bytes) return bytes
    const riffSize = output.length - 8
    output[4] = riffSize & 0xff
    output[5] = (riffSize >>> 8) & 0xff
    output[6] = (riffSize >>> 16) & 0xff
    output[7] = (riffSize >>> 24) & 0xff
    if (vp8xSourceOffset >= 0) {
        let outputOffset = 0
        for (const [start, end] of keep) {
            if (start <= vp8xSourceOffset && vp8xSourceOffset < end) {
                output[outputOffset + vp8xSourceOffset - start] &= ~((1 << 3) | (1 << 2))
                break
            }
            outputOffset += end - start
        }
    }
    return output
}

export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
    try {
        if (mime === 'image/jpeg') return stripJpegExif(bytes)
        if (mime === 'image/png') return stripPngMeta(bytes)
        if (mime === 'image/webp') return stripWebpMeta(bytes)
    } catch {
        // Malformed assets fall back to their original bytes; the SVG pixel filter still protects copies.
    }
    return bytes
}

function readImageSize(bytes: Uint8Array, mime: string): readonly [number, number] | null {
    try {
        if (mime === 'image/png' && bytes.length >= 24) {
            const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0
            const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0
            if (width && height) return [width, height]
        }
        if (mime === 'image/jpeg') {
            let cursor = 2
            while (cursor + 9 < bytes.length) {
                if (bytes[cursor] !== 0xff) break
                const marker = bytes[cursor + 1]
                if (marker === 0xda) break
                if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { cursor += 2; continue }
                const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3]
                if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
                    || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
                    const height = (bytes[cursor + 5] << 8) | bytes[cursor + 6]
                    const width = (bytes[cursor + 7] << 8) | bytes[cursor + 8]
                    if (width && height) return [width, height]
                    break
                }
                cursor += 2 + length
            }
        }
        if (mime === 'image/webp' && bytes.length >= 30) {
            let cursor = 12
            while (cursor + 8 <= bytes.length) {
                const type = String.fromCharCode(bytes[cursor], bytes[cursor + 1], bytes[cursor + 2], bytes[cursor + 3])
                const length = (bytes[cursor + 4] | (bytes[cursor + 5] << 8) | (bytes[cursor + 6] << 16) | (bytes[cursor + 7] << 24)) >>> 0
                if (type === 'VP8X' && length >= 10) {
                    return [
                        (bytes[cursor + 12] | (bytes[cursor + 13] << 8) | (bytes[cursor + 14] << 16)) + 1,
                        (bytes[cursor + 15] | (bytes[cursor + 16] << 8) | (bytes[cursor + 17] << 16)) + 1,
                    ]
                }
                if (type === 'VP8 ' && length >= 10) {
                    const width = (bytes[cursor + 14] | (bytes[cursor + 15] << 8)) & 0x3fff
                    const height = (bytes[cursor + 16] | (bytes[cursor + 17] << 8)) & 0x3fff
                    if (width && height) return [width, height]
                }
                if (type === 'VP8L' && length >= 5) {
                    const c1 = bytes[cursor + 9], c2 = bytes[cursor + 10], c3 = bytes[cursor + 11], c4 = bytes[cursor + 12]
                    return [((c1 | (c2 << 8)) & 0x3fff) + 1, (((c2 >>> 6) | (c3 << 2) | (c4 << 10)) & 0x3fff) + 1]
                }
                cursor += 8 + length + (length & 1)
            }
        }
    } catch {
        // The wrapper uses a safe default viewport for damaged or unrecognized files.
    }
    return null
}

function bytesToBase64(bytes: Uint8Array): string {
    const chunks: string[] = []
    for (let index = 0; index < bytes.length; index += 8192) {
        chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)))
    }
    return btoa(chunks.join(''))
}

/** KV depends on R2's etag so replacing an object cannot reuse an older sanitized representation. */
async function getStrippedImageBytes(
    env: CleanImageEnv,
    imageKey: string,
    image: R2ObjectBody,
    mime: string,
    ctx: ExecutionContext,
): Promise<Uint8Array> {
    const cacheKey = `asset-clean:${imageKey}:${image.etag}`
    try {
        const cached = await env.KV.get(cacheKey, 'arrayBuffer')
        if (cached) return new Uint8Array(cached)
    } catch { /* R2 remains authoritative when KV is unavailable. */ }
    const raw = new Uint8Array(await image.arrayBuffer())
    const stripped = stripImageMetadata(raw, mime)
    const stableBuffer = new ArrayBuffer(stripped.byteLength)
    new Uint8Array(stableBuffer).set(stripped)
    ctx.waitUntil(env.KV.put(cacheKey, stableBuffer).catch(() => undefined))
    return stripped
}

export async function wrapImageWithCleanSvg(
    env: CleanImageEnv,
    imageKey: string,
    image: R2ObjectBody | null,
    mime: string,
    ctx: ExecutionContext,
): Promise<Response> {
    if (!image) return notFoundImage()
    const cleanBytes = await getStrippedImageBytes(env, imageKey, image, mime, ctx)
    const [width, height] = readImageSize(cleanBytes, mime) ?? [1024, 1024]
    const base64Key = `asset-b64-clean:${imageKey}:${image.etag}`
    let base64: string | null = null
    try { base64 = await env.KV.get(base64Key) } catch { /* Rebuild below. */ }
    if (!base64) {
        base64 = bytesToBase64(cleanBytes)
        ctx.waitUntil(env.KV.put(base64Key, base64).catch(() => undefined))
    }
    const svg = '<?xml version="1.0" encoding="UTF-8"?>'
        + `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + '<defs><filter id="lsb"><feGaussianBlur stdDeviation="0.5"/></filter></defs>'
        + `<rect x="0" y="0" width="${width}" height="${height}" fill="#000000"/>`
        + `<image href="data:${mime};base64,${base64}" x="0" y="0" width="${width}" height="${height}" filter="url(#lsb)" preserveAspectRatio="none"/>`
        + '</svg>'
    return new Response(svg, {
        headers: {
            'content-type': 'image/svg+xml; charset=utf-8',
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=3600',
            'x-content-type-options': 'nosniff',
        },
    })
}

const NOT_FOUND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 28" width="100%" height="28">
  <rect width="480" height="28" fill="#0f1419"/><line x1="1.5" y1="0" x2="1.5" y2="28" stroke="#a0c3e7" stroke-width="3"/>
  <text x="10" y="18" font-family="Consolas, monospace" font-size="11" fill="#a0c3e7">[!] NOT FOUND IMAGE | URL이 잘못되었거나 아직 추가되지 않은 이미지 입니다</text>
</svg>`

export function notFoundImage(): Response {
    return new Response(NOT_FOUND_SVG, {
        status: 404,
        headers: {
            'content-type': 'image/svg+xml; charset=utf-8',
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=300',
            'x-content-type-options': 'nosniff',
        },
    })
}
