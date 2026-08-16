import { describe, expect, it } from 'vitest'

import { scanImageMetadata } from '@/domain/organizer/metadata-sanitizer'
import { eradicateImageMetadata } from '@/lib/image-metadata-purge'

function ascii(value: string): number[] {
    return [...value].map(character => character.charCodeAt(0))
}

function u32le(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

function webpChunk(type: string, data: readonly number[]): number[] {
    return [...ascii(type), ...u32le(data.length), ...data, ...(data.length % 2 === 0 ? [] : [0])]
}

function encoderWebpFixture(): Uint8Array {
    const body = [
        ...webpChunk('VP8X', [0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        ...webpChunk('ICCP', ascii('webview-added-color-profile')),
        ...webpChunk('VP8 ', [0, 0, 0, 0]),
    ]
    return new Uint8Array([0x52, 0x49, 0x46, 0x46, ...u32le(body.length + 4), 0x57, 0x45, 0x42, 0x50, ...body])
}

function dataUrl(bytes: Uint8Array, mime = 'image/webp'): string {
    return `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('image metadata purge finalization', () => {
    it('keeps a metadata-free PNG valid in a headless output path', async () => {
        const source = Uint8Array.from(
            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
            character => character.charCodeAt(0),
        )

        const result = await eradicateImageMetadata(dataUrl(source, 'image/png'), 'png')

        expect(scanImageMetadata(result.bytes)).toMatchObject({
            format: 'png',
            exif: false,
            xmp: false,
            icc: false,
            pngText: false,
            appSpecific: false,
        })
        expect(result.dataUrl).toBe(dataUrl(result.bytes, 'image/png'))
    })

    it('removes a WebView-added WebP color profile after re-encoding', async () => {
        const source = encoderWebpFixture()
        expect(scanImageMetadata(source)).toMatchObject({ format: 'webp', icc: true })

        const result = await eradicateImageMetadata(dataUrl(source), 'webp')

        expect(scanImageMetadata(result.bytes)).toMatchObject({
            format: 'webp',
            chunks: ['VP8X', 'VP8 '],
            exif: false,
            xmp: false,
            icc: false,
            pngText: false,
            appSpecific: false,
        })
        expect(result.dataUrl).toBe(dataUrl(result.bytes))
    })
})
