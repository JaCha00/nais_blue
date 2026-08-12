import {
    isRightsXmpRequest,
    type RightsXmpRequest,
} from '@/domain/workflow/bluehair-rights-policy'

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const XMP_PNG_KEYWORD = 'XML:com.adobe.xmp'
const SOURCE_WEBP_METADATA = new Set(['EXIF', 'XMP ', 'ICCP'])

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < table.length; index += 1) {
        let value = index
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
        }
        table[index] = value >>> 0
    }
    return table
})()

interface PngChunk {
    readonly type: string
    readonly data: Uint8Array
}

interface WebPChunk {
    readonly fourcc: string
    readonly payload: Uint8Array
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        output.set(part, offset)
        offset += part.length
    }
    return output
}

function ascii(value: string): Uint8Array {
    return Uint8Array.from(value, character => character.charCodeAt(0))
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

export function buildRightsXmp(request: RightsXmpRequest): Uint8Array {
    if (!isRightsXmpRequest(request)) throw new TypeError('Rights XMP request is invalid')
    const year = request.effectiveDate.slice(0, 4)
    const copyright = `Copyright © ${year} ${request.owner}. All rights reserved.`
    const usageTermsEn = `No part of this image may be reproduced, redistributed, copied, modified, published, transmitted, or otherwise used, in whole or in part, in any form or by any means, without prior written permission from ${request.owner}.`
    const usageTermsKo = `이 이미지는 ${request.owner}의 사전 서면 허가 없이 어떠한 경우에도 전부 또는 일부를 무단 전재, 복제, 배포, 수정, 게시, 전송하거나 기타 방식으로 사용할 수 없습니다.`
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/"
 xmp:MetadataDate="${xmlEscape(request.metadataDate)}"
 xmpRights:Marked="True"
 plus:LicenseStartDate="${xmlEscape(request.effectiveDate)}">
<xmpRights:Owner><rdf:Bag><rdf:li>${xmlEscape(request.owner)}</rdf:li></rdf:Bag></xmpRights:Owner>
<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(copyright)}</rdf:li><rdf:li xml:lang="en-US">${xmlEscape(copyright)}</rdf:li></rdf:Alt></dc:rights>
<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(usageTermsEn)}</rdf:li><rdf:li xml:lang="en-US">${xmlEscape(usageTermsEn)}</rdf:li><rdf:li xml:lang="ko-KR">${xmlEscape(usageTermsKo)}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>`
    return new TextEncoder().encode(xml)
}

function crc32(bytes: Uint8Array): number {
    let value = 0xffff_ffff
    for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
    return (value ^ 0xffff_ffff) >>> 0
}

function readU32Big(bytes: Uint8Array, offset: number): number {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function u32Big(value: number): Uint8Array {
    return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value)
}

function readU32Little(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function u32Little(value: number): Uint8Array {
    return Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24)
}

function decodeAscii(bytes: Uint8Array): string {
    return String.fromCharCode(...bytes)
}

function parsePng(bytes: Uint8Array): PngChunk[] {
    if (bytes.length < PNG_SIGNATURE.length
        || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw new TypeError('Invalid PNG signature')
    const chunks: PngChunk[] = []
    let offset = PNG_SIGNATURE.length
    let ended = false
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) throw new TypeError('Truncated PNG chunk')
        const size = readU32Big(bytes, offset)
        const end = offset + 12 + size
        if (end > bytes.length) throw new TypeError('Truncated PNG payload')
        const typeBytes = bytes.slice(offset + 4, offset + 8)
        const data = bytes.slice(offset + 8, offset + 8 + size)
        const expectedCrc = readU32Big(bytes, offset + 8 + size)
        if (crc32(concatBytes([typeBytes, data])) !== expectedCrc) throw new TypeError('Invalid PNG CRC')
        const type = decodeAscii(typeBytes)
        chunks.push({ type, data })
        offset = end
        if (type === 'IEND') {
            ended = true
            break
        }
    }
    if (!ended || offset !== bytes.length) throw new TypeError('Invalid PNG ending')
    return chunks
}

function packPngChunk(chunk: PngChunk): Uint8Array {
    const type = ascii(chunk.type)
    const checksum = crc32(concatBytes([type, chunk.data]))
    return concatBytes([u32Big(chunk.data.length), type, chunk.data, u32Big(checksum)])
}

function pngTextKeyword(data: Uint8Array): string | null {
    const end = data.indexOf(0)
    return end < 1 ? null : new TextDecoder('latin1').decode(data.slice(0, end))
}

function packPngWithRights(bytes: Uint8Array, xmp: Uint8Array): Uint8Array {
    const kept = parsePng(bytes).filter(chunk => (
        chunk.type !== 'eXIf'
        && chunk.type !== 'iCCP'
        && (!['iTXt', 'tEXt', 'zTXt'].includes(chunk.type) || pngTextKeyword(chunk.data) !== XMP_PNG_KEYWORD)
    ))
    const iend = kept.findIndex(chunk => chunk.type === 'IEND')
    if (iend < 0) throw new TypeError('PNG has no IEND chunk')
    kept.splice(iend, 0, {
        type: 'iTXt',
        data: concatBytes([ascii(XMP_PNG_KEYWORD), Uint8Array.of(0, 0, 0, 0, 0), xmp]),
    })
    return concatBytes([PNG_SIGNATURE, ...kept.map(packPngChunk)])
}

function parseWebP(bytes: Uint8Array): WebPChunk[] {
    if (bytes.length < 12
        || decodeAscii(bytes.slice(0, 4)) !== 'RIFF'
        || decodeAscii(bytes.slice(8, 12)) !== 'WEBP'
        || readU32Little(bytes, 4) + 8 !== bytes.length) throw new TypeError('Invalid WebP RIFF container')
    const chunks: WebPChunk[] = []
    let offset = 12
    while (offset < bytes.length) {
        if (offset + 8 > bytes.length) throw new TypeError('Truncated WebP chunk')
        const size = readU32Little(bytes, offset + 4)
        const payloadEnd = offset + 8 + size
        const paddedEnd = payloadEnd + (size & 1)
        if (paddedEnd > bytes.length) throw new TypeError('Truncated WebP payload')
        chunks.push({ fourcc: decodeAscii(bytes.slice(offset, offset + 4)), payload: bytes.slice(offset + 8, payloadEnd) })
        offset = paddedEnd
    }
    if (offset !== bytes.length) throw new TypeError('Invalid WebP chunk alignment')
    return chunks
}

function webpCanvas(chunks: readonly WebPChunk[]): { width: number; height: number } {
    const vp8x = chunks.find(chunk => chunk.fourcc === 'VP8X')
    if (vp8x !== undefined) {
        if (vp8x.payload.length !== 10) throw new TypeError('Invalid VP8X payload')
        return {
            width: 1 + vp8x.payload[4] + (vp8x.payload[5] << 8) + (vp8x.payload[6] << 16),
            height: 1 + vp8x.payload[7] + (vp8x.payload[8] << 8) + (vp8x.payload[9] << 16),
        }
    }
    const lossy = chunks.find(chunk => chunk.fourcc === 'VP8 ')
    if (lossy !== undefined) {
        const data = lossy.payload
        if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
            throw new TypeError('Invalid VP8 frame header')
        }
        return {
            width: (data[6] | (data[7] << 8)) & 0x3fff,
            height: (data[8] | (data[9] << 8)) & 0x3fff,
        }
    }
    const lossless = chunks.find(chunk => chunk.fourcc === 'VP8L')
    if (lossless !== undefined) {
        const data = lossless.payload
        if (data.length < 5 || data[0] !== 0x2f) throw new TypeError('Invalid VP8L frame header')
        return {
            width: 1 + data[1] + ((data[2] & 0x3f) << 8),
            height: 1 + (data[2] >>> 6) + (data[3] << 2) + ((data[4] & 0x0f) << 10),
        }
    }
    throw new TypeError('WebP has no decodable canvas')
}

function packWebP(chunks: readonly WebPChunk[]): Uint8Array {
    const packed = chunks.map(chunk => concatBytes([
        ascii(chunk.fourcc),
        u32Little(chunk.payload.length),
        chunk.payload,
        ...(chunk.payload.length % 2 === 0 ? [] : [Uint8Array.of(0)]),
    ]))
    const body = concatBytes([ascii('WEBP'), ...packed])
    return concatBytes([ascii('RIFF'), u32Little(body.length), body])
}

function packWebPWithRights(bytes: Uint8Array, xmp: Uint8Array): Uint8Array {
    const parsed = parseWebP(bytes)
    const canvas = webpCanvas(parsed)
    let vp8xSeen = false
    const kept = parsed.flatMap(chunk => {
        if (SOURCE_WEBP_METADATA.has(chunk.fourcc)) return []
        if (chunk.fourcc !== 'VP8X') return [chunk]
        if (chunk.payload.length !== 10) throw new TypeError('Invalid VP8X payload')
        const payload = chunk.payload.slice()
        payload[0] = (payload[0] & ~(0x20 | 0x08 | 0x04)) | 0x04
        vp8xSeen = true
        return [{ fourcc: chunk.fourcc, payload }]
    })
    if (!vp8xSeen) {
        if (canvas.width < 1 || canvas.height < 1 || canvas.width > 0x1000000 || canvas.height > 0x1000000) {
            throw new TypeError('Invalid WebP canvas dimensions')
        }
        const payload = concatBytes([
            Uint8Array.of(0x04, 0, 0, 0),
            Uint8Array.of(canvas.width - 1, (canvas.width - 1) >>> 8, (canvas.width - 1) >>> 16),
            Uint8Array.of(canvas.height - 1, (canvas.height - 1) >>> 8, (canvas.height - 1) >>> 16),
        ])
        kept.unshift({ fourcc: 'VP8X', payload })
    }
    kept.push({ fourcc: 'XMP ', payload: xmp })
    return packWebP(kept)
}

export function readRightsXmp(bytes: Uint8Array, imageFormat: 'png' | 'webp'): string | null {
    if (imageFormat === 'webp') {
        const matches = parseWebP(bytes).filter(chunk => chunk.fourcc === 'XMP ')
        return matches.length === 1 ? new TextDecoder().decode(matches[0].payload) : null
    }
    const matches = parsePng(bytes).filter(chunk => (
        chunk.type === 'iTXt' && pngTextKeyword(chunk.data) === XMP_PNG_KEYWORD
    ))
    if (matches.length !== 1) return null
    const prefixLength = XMP_PNG_KEYWORD.length + 5
    return new TextDecoder().decode(matches[0].data.slice(prefixLength))
}

export function embedRightsXmp(
    bytes: Uint8Array,
    imageFormat: 'png' | 'webp',
    request: RightsXmpRequest,
): Uint8Array {
    const xmp = buildRightsXmp(request)
    const output = imageFormat === 'png' ? packPngWithRights(bytes, xmp) : packWebPWithRights(bytes, xmp)
    if (readRightsXmp(output, imageFormat) !== new TextDecoder().decode(xmp)) {
        throw new TypeError('Canonical rights XMP verification failed')
    }
    return output
}
