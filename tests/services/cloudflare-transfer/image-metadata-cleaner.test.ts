import { describe, expect, it } from 'vitest'
import { stripPngMeta } from '../../../cloudflare/nais-transfer-worker/src/image-metadata-cleaner'

function chunk(type: string, payload: readonly number[]): number[] {
    const length = payload.length
    return [
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
        ...[...type].map(character => character.charCodeAt(0)),
        ...payload,
        0, 0, 0, 0,
    ]
}

describe('Cloudflare image metadata cleaner', () => {
    it('removes PNG text metadata while retaining pixel and terminal chunks', () => {
        const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        const source = new Uint8Array([
            ...signature,
            ...chunk('IHDR', new Array(13).fill(0)),
            ...chunk('tEXt', [...'prompt=secret'].map(character => character.charCodeAt(0))),
            ...chunk('IDAT', [1, 2, 3]),
            ...chunk('IEND', []),
        ])
        const cleaned = stripPngMeta(source)
        const text = new TextDecoder('latin1').decode(cleaned)

        expect(text).toContain('IHDR')
        expect(text).toContain('IDAT')
        expect(text).toContain('IEND')
        expect(text).not.toContain('tEXt')
        expect(text).not.toContain('prompt=secret')
    })
})
