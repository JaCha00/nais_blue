import type { OrganizerSourceImageFormat } from './types'

export type OrganizerImageFormat = OrganizerSourceImageFormat | 'unknown'

export interface ImageMetadataScan {
    readonly format: OrganizerImageFormat
    readonly chunks: readonly string[]
    readonly exif: boolean
    readonly xmp: boolean
    readonly icc: boolean
    readonly pngText: boolean
    readonly appSpecific: boolean
}

export interface DecodedOrganizerImage {
    readonly width: number
    readonly height: number
    readonly rgba: Uint8ClampedArray
    readonly colorSpace: 'srgb'
}

export class OrganizerMetadataError extends Error {
    constructor(
        readonly code:
            | 'E_ORGANIZER_IMAGE_FORMAT'
            | 'E_ORGANIZER_IMAGE_INVALID'
            | 'E_ORGANIZER_METADATA_REMAINING'
            | 'E_ORGANIZER_ALPHA_CHANGED'
            | 'E_ORGANIZER_COLOR_CHANGED',
        message: string,
    ) {
        super(message)
        this.name = 'OrganizerMetadataError'
    }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46]
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50]

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
    return signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function readU32Be(bytes: Uint8Array, offset: number): number {
    return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function readU32Le(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function writeU32Le(target: number[], value: number): void {
    target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

function imageFormat(bytes: Uint8Array): OrganizerImageFormat {
    if (matches(bytes, 0, PNG_SIGNATURE)) return 'png'
    if (matches(bytes, 0, WEBP_SIGNATURE) && matches(bytes, 8, WEBP_TAG)) return 'webp'
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
    return 'unknown'
}

interface PngChunk {
    readonly type: string
    readonly start: number
    readonly end: number
    readonly dataStart: number
    readonly dataLength: number
}

function pngChunks(bytes: Uint8Array): PngChunk[] {
    if (imageFormat(bytes) !== 'png') throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_FORMAT', 'Expected a PNG image.')
    const chunks: PngChunk[] = []
    let offset = PNG_SIGNATURE.length
    let sawEnd = false
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'PNG chunk header is truncated.')
        const dataLength = readU32Be(bytes, offset)
        const dataStart = offset + 8
        const end = dataStart + dataLength + 4
        if (end > bytes.length || end < dataStart) {
            throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'PNG chunk length is invalid.')
        }
        const type = ascii(bytes, offset + 4, 4)
        chunks.push({ type, start: offset, end, dataStart, dataLength })
        offset = end
        if (type === 'IEND') {
            sawEnd = true
            if (offset !== bytes.length) {
                throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'PNG contains bytes after IEND.')
            }
            break
        }
    }
    if (!sawEnd) throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'PNG is missing IEND.')
    return chunks
}

interface WebpChunk {
    readonly type: string
    readonly start: number
    readonly dataStart: number
    readonly dataLength: number
    readonly end: number
}

function webpChunks(bytes: Uint8Array): WebpChunk[] {
    if (imageFormat(bytes) !== 'webp') throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_FORMAT', 'Expected a WebP image.')
    if (bytes.length < 12) throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'WebP header is truncated.')
    const declaredSize = readU32Le(bytes, 4)
    if (declaredSize + 8 !== bytes.length) {
        throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'WebP RIFF size is invalid.')
    }
    const chunks: WebpChunk[] = []
    let offset = 12
    while (offset < bytes.length) {
        if (offset + 8 > bytes.length) throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'WebP chunk header is truncated.')
        const type = ascii(bytes, offset, 4)
        const dataLength = readU32Le(bytes, offset + 4)
        const dataStart = offset + 8
        const end = dataStart + dataLength + (dataLength % 2)
        if (end > bytes.length || end < dataStart) {
            throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'WebP chunk length is invalid.')
        }
        chunks.push({ type, start: offset, dataStart, dataLength, end })
        offset = end
    }
    return chunks
}

interface JpegSegment {
    readonly marker: number
    readonly start: number
    readonly end: number
    readonly payloadStart: number
    readonly payloadLength: number
}

function jpegSegments(bytes: Uint8Array): JpegSegment[] {
    if (imageFormat(bytes) !== 'jpeg') throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_FORMAT', 'Expected a JPEG image.')
    const segments: JpegSegment[] = []
    let offset = 2
    while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) break
        const start = offset
        while (bytes[offset] === 0xff) offset += 1
        const marker = bytes[offset]
        offset += 1
        if (marker === 0xd9 || marker === 0xda) break
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
        if (offset + 2 > bytes.length) throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'JPEG segment length is truncated.')
        const length = (bytes[offset] << 8) | bytes[offset + 1]
        if (length < 2 || offset + length > bytes.length) {
            throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_INVALID', 'JPEG segment length is invalid.')
        }
        const payloadStart = offset + 2
        const end = offset + length
        segments.push({ marker, start, end, payloadStart, payloadLength: length - 2 })
        offset = end
    }
    return segments
}

function startsWithAscii(bytes: Uint8Array, offset: number, value: string): boolean {
    return ascii(bytes, offset, Math.min(value.length, Math.max(0, bytes.length - offset))) === value
}

const PNG_SAFE_ANCILLARY = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB', 'pHYs'])
const WEBP_SAFE_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF'])

export function scanImageMetadata(bytes: Uint8Array): ImageMetadataScan {
    const format = imageFormat(bytes)
    if (format === 'png') {
        const chunks = pngChunks(bytes)
        return {
            format,
            chunks: chunks.map(chunk => chunk.type),
            exif: chunks.some(chunk => chunk.type === 'eXIf'),
            xmp: chunks.some(chunk => chunk.type === 'iTXt'
                && startsWithAscii(bytes, chunk.dataStart, 'XML:com.adobe.xmp')),
            icc: chunks.some(chunk => chunk.type === 'iCCP'),
            pngText: chunks.some(chunk => chunk.type === 'tEXt' || chunk.type === 'zTXt' || chunk.type === 'iTXt'),
            appSpecific: chunks.some(chunk => {
                const ancillary = chunk.type.charCodeAt(0) >= 0x61 && chunk.type.charCodeAt(0) <= 0x7a
                return ancillary
                    && !PNG_SAFE_ANCILLARY.has(chunk.type)
                    && !['eXIf', 'iCCP', 'tEXt', 'zTXt', 'iTXt'].includes(chunk.type)
            }),
        }
    }
    if (format === 'webp') {
        const chunks = webpChunks(bytes)
        return {
            format,
            chunks: chunks.map(chunk => chunk.type),
            exif: chunks.some(chunk => chunk.type === 'EXIF'),
            xmp: chunks.some(chunk => chunk.type === 'XMP '),
            icc: chunks.some(chunk => chunk.type === 'ICCP'),
            pngText: false,
            appSpecific: chunks.some(chunk => !WEBP_SAFE_CHUNKS.has(chunk.type)
                && !['EXIF', 'XMP ', 'ICCP'].includes(chunk.type)),
        }
    }
    if (format === 'jpeg') {
        const segments = jpegSegments(bytes)
        return {
            format,
            chunks: segments.map(segment => `APP${segment.marker - 0xe0}`),
            exif: segments.some(segment => segment.marker === 0xe1 && startsWithAscii(bytes, segment.payloadStart, 'Exif\0\0')),
            xmp: segments.some(segment => segment.marker === 0xe1 && startsWithAscii(bytes, segment.payloadStart, 'http://ns.adobe.com/xap/1.0/\0')),
            icc: segments.some(segment => segment.marker === 0xe2 && startsWithAscii(bytes, segment.payloadStart, 'ICC_PROFILE\0')),
            pngText: false,
            appSpecific: segments.some(segment => segment.marker >= 0xe1 && segment.marker <= 0xef
                && !(segment.marker === 0xe1 && (startsWithAscii(bytes, segment.payloadStart, 'Exif\0\0')
                    || startsWithAscii(bytes, segment.payloadStart, 'http://ns.adobe.com/xap/1.0/\0')))
                && !(segment.marker === 0xe2 && startsWithAscii(bytes, segment.payloadStart, 'ICC_PROFILE\0'))),
        }
    }
    return { format, chunks: [], exif: false, xmp: false, icc: false, pngText: false, appSpecific: false }
}

function shouldKeepPngChunk(type: string): boolean {
    const ancillary = type.charCodeAt(0) >= 0x61 && type.charCodeAt(0) <= 0x7a
    return !ancillary || PNG_SAFE_ANCILLARY.has(type)
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
    const parts: number[] = [...PNG_SIGNATURE]
    for (const chunk of pngChunks(bytes)) {
        if (shouldKeepPngChunk(chunk.type)) parts.push(...bytes.subarray(chunk.start, chunk.end))
    }
    return new Uint8Array(parts)
}

function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
    const body: number[] = []
    for (const chunk of webpChunks(bytes)) {
        if (!WEBP_SAFE_CHUNKS.has(chunk.type)) continue
        const raw = new Uint8Array(bytes.subarray(chunk.start, chunk.end))
        if (chunk.type === 'VP8X' && raw.length >= 9) {
            // ICCP, EXIF and XMP feature bits. Alpha and animation bits remain intact.
            raw[8] &= ~(0x20 | 0x08 | 0x04)
        }
        body.push(...raw)
    }
    const result: number[] = [...WEBP_SIGNATURE]
    writeU32Le(result, body.length + 4)
    result.push(...WEBP_TAG, ...body)
    return new Uint8Array(result)
}

function shouldKeepJpegSegment(segment: JpegSegment): boolean {
    if (segment.marker === 0xe0 || segment.marker === 0xee) return true
    if (segment.marker === 0xfe) return false
    if (segment.marker >= 0xe1 && segment.marker <= 0xef) return false
    return true
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
    const result: number[] = [0xff, 0xd8]
    let copiedTo = 2
    for (const segment of jpegSegments(bytes)) {
        if (segment.start > copiedTo) {
            // This is scan data or an unexpected boundary. The decoded image is
            // safer to preserve than to heuristically rewrite.
            break
        }
        if (shouldKeepJpegSegment(segment)) result.push(...bytes.subarray(segment.start, segment.end))
        copiedTo = segment.end
    }
    result.push(...bytes.subarray(copiedTo))
    return new Uint8Array(result)
}

/** Raw container sanitizer: no decode/re-encode, preserving pixel and alpha bits. */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array {
    switch (imageFormat(bytes)) {
        case 'png': return stripPngMetadata(bytes)
        case 'webp': return stripWebpMetadata(bytes)
        case 'jpeg': return stripJpegMetadata(bytes)
        default: throw new OrganizerMetadataError('E_ORGANIZER_IMAGE_FORMAT', 'Only PNG, WebP, and JPEG artifacts can be sanitized.')
    }
}

export function assertMetadataStripped(bytes: Uint8Array): ImageMetadataScan {
    const scan = scanImageMetadata(bytes)
    if (scan.exif || scan.xmp || scan.icc || scan.pngText || scan.appSpecific) {
        throw new OrganizerMetadataError('E_ORGANIZER_METADATA_REMAINING', 'The distribution artifact still contains removable metadata.')
    }
    return scan
}

export function alphaLsbSignature(image: DecodedOrganizerImage): string {
    let bits = ''
    for (let offset = 3; offset < image.rgba.length; offset += 4) bits += String(image.rgba[offset] & 1)
    return bits
}

/**
 * Decode-level verification complements raw chunk scanning.  PNG/lossless
 * conversions require exact RGB; lossy WebP permits a bounded RGB delta but
 * must still preserve alpha exactly when that policy is selected.
 */
export function verifyDecodedDistribution(input: {
    readonly before: DecodedOrganizerImage
    readonly after: DecodedOrganizerImage
    readonly alphaPolicy: 'preserve' | 'flatten'
    readonly requireExactColor: boolean
    readonly maxLossyColorDelta?: number
}): void {
    const { before, after } = input
    if (before.width !== after.width || before.height !== after.height || before.rgba.length !== after.rgba.length) {
        throw new OrganizerMetadataError('E_ORGANIZER_COLOR_CHANGED', 'Distribution conversion changed image dimensions.')
    }
    let maximumColorDelta = 0
    for (let offset = 0; offset < before.rgba.length; offset += 4) {
        if (input.alphaPolicy === 'preserve' && before.rgba[offset + 3] !== after.rgba[offset + 3]) {
            throw new OrganizerMetadataError('E_ORGANIZER_ALPHA_CHANGED', 'Distribution conversion changed alpha values.')
        }
        if (input.alphaPolicy === 'flatten' && after.rgba[offset + 3] !== 255) {
            throw new OrganizerMetadataError('E_ORGANIZER_ALPHA_CHANGED', 'Flattened distribution output must be opaque.')
        }
        for (let channel = 0; channel < 3; channel += 1) {
            maximumColorDelta = Math.max(maximumColorDelta, Math.abs(before.rgba[offset + channel] - after.rgba[offset + channel]))
        }
    }
    const allowed = input.requireExactColor ? 0 : input.maxLossyColorDelta ?? 12
    if (maximumColorDelta > allowed) {
        throw new OrganizerMetadataError('E_ORGANIZER_COLOR_CHANGED', 'Distribution conversion exceeded the allowed color difference.')
    }
}
