import { describe, expect, it } from 'vitest'

import {
    alphaLsbSignature,
    assertMetadataStripped,
    scanImageMetadata,
    stripImageMetadata,
    verifyDecodedDistribution,
    type DecodedOrganizerImage,
} from '@/domain/organizer/metadata-sanitizer'

function ascii(value: string): number[] {
    return [...value].map(character => character.charCodeAt(0))
}

function u32be(value: number): number[] {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function u32le(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

function pngChunk(type: string, data: readonly number[]): number[] {
    return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0]
}

function pngFixture(): Uint8Array {
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
        ...pngChunk('tRNS', [0, 0, 0, 0, 0, 0]),
        ...pngChunk('tEXt', [...ascii('Comment\0metadata')]),
        ...pngChunk('zTXt', [...ascii('Comment\0\0compressed')]),
        ...pngChunk('iTXt', [...ascii('XML:com.adobe.xmp\0\0\0\0\0xmp')]),
        ...pngChunk('eXIf', [0x49, 0x49, 0x2a, 0]),
        ...pngChunk('iCCP', [...ascii('icc\0\0profile')]),
        ...pngChunk('naIs', [...ascii('app-specific')]),
        ...pngChunk('IDAT', [0]),
        ...pngChunk('IEND', []),
    ])
}

function webpChunk(type: string, data: readonly number[]): number[] {
    return [...ascii(type), ...u32le(data.length), ...data, ...(data.length % 2 === 0 ? [] : [0])]
}

function webpFixture(): Uint8Array {
    const body = [
        // ICCP/EXIF/XMP and alpha feature flags are all set. Alpha must stay.
        ...webpChunk('VP8X', [0x3c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        ...webpChunk('ICCP', [...ascii('icc')]),
        ...webpChunk('EXIF', [...ascii('exif')]),
        ...webpChunk('XMP ', [...ascii('xmp')]),
        ...webpChunk('NAIS', [...ascii('app')]),
        ...webpChunk('VP8 ', [0, 0, 0, 0]),
    ]
    return new Uint8Array([0x52, 0x49, 0x46, 0x46, ...u32le(body.length + 4), 0x57, 0x45, 0x42, 0x50, ...body])
}

function jpegSegment(marker: number, payload: readonly number[]): number[] {
    const length = payload.length + 2
    return [0xff, marker, (length >>> 8) & 0xff, length & 0xff, ...payload]
}

function jpegFixture(): Uint8Array {
    return new Uint8Array([
        0xff, 0xd8,
        ...jpegSegment(0xe0, [...ascii('JFIF\0')]),
        ...jpegSegment(0xe1, [...ascii('Exif\0\0tiff')]),
        ...jpegSegment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/\0xmp')]),
        ...jpegSegment(0xe2, [...ascii('ICC_PROFILE\0profile')]),
        ...jpegSegment(0xe3, [...ascii('NAIS app metadata')]),
        ...jpegSegment(0xfe, [...ascii('comment')]),
        ...jpegSegment(0xdb, [0]),
        0xff, 0xda, 0, 2, 0, 0, 0xff, 0xd9,
    ])
}

function decoded(rgba: number[]): DecodedOrganizerImage {
    return { width: rgba.length / 4, height: 1, rgba: new Uint8ClampedArray(rgba), colorSpace: 'srgb' }
}

describe('Organizer strict metadata sanitization fixtures', () => {
    it('strips PNG EXIF/XMP/ICC/text/app chunks while retaining alpha-relevant critical data', () => {
        const source = pngFixture()
        expect(scanImageMetadata(source)).toMatchObject({ format: 'png', exif: true, xmp: true, icc: true, pngText: true, appSpecific: true })

        const stripped = stripImageMetadata(source)
        const scan = assertMetadataStripped(stripped)
        expect(scan.chunks).toEqual(expect.arrayContaining(['IHDR', 'tRNS', 'IDAT', 'IEND']))
        expect(scan.chunks).not.toEqual(expect.arrayContaining(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'iCCP', 'naIs']))
    })

    it('strips WebP EXIF/XMP/ICC/app chunks and clears metadata flags without clearing alpha', () => {
        const source = webpFixture()
        expect(scanImageMetadata(source)).toMatchObject({ format: 'webp', exif: true, xmp: true, icc: true, appSpecific: true })

        const stripped = stripImageMetadata(source)
        const scan = assertMetadataStripped(stripped)
        expect(scan.chunks).toEqual(expect.arrayContaining(['VP8X', 'VP8 ']))
        // RIFF(12) + VP8X chunk header(8): alpha (0x10) stays; metadata bits are gone.
        expect(stripped[20] & 0x3c).toBe(0x10)
    })

    it('strips JPEG EXIF/XMP/ICC/app/comment segments but preserves image coding segments', () => {
        const source = jpegFixture()
        expect(scanImageMetadata(source)).toMatchObject({ format: 'jpeg', exif: true, xmp: true, icc: true, appSpecific: true })

        const scan = assertMetadataStripped(stripImageMetadata(source))
        expect(scan.chunks).toEqual(expect.arrayContaining(['APP0', 'APP-5']))
        expect(scan.exif || scan.xmp || scan.icc || scan.appSpecific).toBe(false)
    })
})

describe('Organizer decode-level alpha and color verification', () => {
    it('preserves every alpha LSB under the preserve policy and rejects an alpha change', () => {
        const before = decoded([10, 20, 30, 0, 40, 50, 60, 1, 70, 80, 90, 254, 100, 110, 120, 255])
        const after = decoded([...before.rgba])
        expect(alphaLsbSignature(after)).toBe(alphaLsbSignature(before))
        expect(() => verifyDecodedDistribution({ before, after, alphaPolicy: 'preserve', requireExactColor: true })).not.toThrow()

        after.rgba[7] = 2
        expect(() => verifyDecodedDistribution({ before, after, alphaPolicy: 'preserve', requireExactColor: true })).toThrow(/alpha/i)
    })

    it('enforces exact PNG color, bounded lossy WebP color, and opaque flattened alpha', () => {
        const before = decoded([100, 120, 140, 42])
        const exact = decoded([100, 120, 140, 42])
        expect(() => verifyDecodedDistribution({ before, after: exact, alphaPolicy: 'preserve', requireExactColor: true })).not.toThrow()

        const lossy = decoded([111, 120, 140, 42])
        expect(() => verifyDecodedDistribution({ before, after: lossy, alphaPolicy: 'preserve', requireExactColor: false, maxLossyColorDelta: 12 })).not.toThrow()
        expect(() => verifyDecodedDistribution({ before, after: lossy, alphaPolicy: 'preserve', requireExactColor: true })).toThrow(/color/i)

        const flattened = decoded([100, 120, 140, 255])
        expect(() => verifyDecodedDistribution({ before, after: flattened, alphaPolicy: 'flatten', requireExactColor: true })).not.toThrow()
    })
})
