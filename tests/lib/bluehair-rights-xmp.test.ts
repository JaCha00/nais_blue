import { describe, expect, it } from 'vitest'

import {
    DEFAULT_RIGHTS_OWNER,
    isRightsEffectiveDate,
    isRightsOwner,
    type RightsXmpRequest,
} from '@/domain/workflow/bluehair-rights-policy'
import {
    embedRightsXmp,
    readRightsXmp,
} from '@/lib/bluehair-rights-xmp'
import { readNaiBlueSidecar } from '@/lib/nai-blue-metadata'
import { MetadataWriter } from '@/services/output/metadata-writer'
import type { GenerationParams } from '@/services/novelai-types'

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const RIGHTS: RightsXmpRequest = {
    owner: DEFAULT_RIGHTS_OWNER,
    effectiveDate: '2026-08-12',
    metadataDate: '2026-08-12T12:34:56+09:00',
}

function bytesFromBase64(value: string): Uint8Array {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

function littleU32(value: number): Uint8Array {
    return Uint8Array.of(value, value >>> 8, value >>> 16, value >>> 24)
}

function tinyLosslessWebP(): Uint8Array {
    const payload = Uint8Array.of(0x2f, 0, 0, 0, 0)
    const body = Uint8Array.from([
        ...new TextEncoder().encode('WEBPVP8L'),
        ...littleU32(payload.length),
        ...payload,
        0,
    ])
    return Uint8Array.from([
        ...new TextEncoder().encode('RIFF'),
        ...littleU32(body.length),
        ...body,
    ])
}

function baseParams(): GenerationParams {
    return {
        prompt: 'portrait',
        negative_prompt: 'lowres',
        model: 'nai-diffusion-4-5-full',
        width: 832,
        height: 1216,
        steps: 28,
        cfg_scale: 5,
        cfg_rescale: 0,
        sampler: 'k_euler_ancestral',
        scheduler: 'karras',
        smea: true,
        smea_dyn: false,
        variety: false,
        seed: 77,
        imageFormat: 'png',
        metadataMode: 'strip-and-sidecar',
    }
}

describe('rights XMP', () => {
    it('accepts only bounded one-line owners and real explicit calendar dates', () => {
        expect(isRightsOwner('Artist & Studio')).toBe(true)
        expect(isRightsOwner(' Artist')).toBe(false)
        expect(isRightsOwner('Artist\nStudio')).toBe(false)
        expect(isRightsOwner('x'.repeat(129))).toBe(false)
        expect(isRightsEffectiveDate('2026-08-12')).toBe(true)
        expect(isRightsEffectiveDate('2024-02-29')).toBe(true)
        expect(isRightsEffectiveDate('2026-02-29')).toBe(false)
        expect(isRightsEffectiveDate('2026-08-12T00:00:00Z')).toBe(false)
    })

    it('adds one canonical PNG XMP packet after purification', () => {
        const source = bytesFromBase64(TINY_PNG_BASE64)
        const first = embedRightsXmp(source, 'png', RIGHTS)
        const second = embedRightsXmp(first, 'png', RIGHTS)
        const xmp = readRightsXmp(second, 'png')

        expect(xmp).toContain('xmpRights:Marked="True"')
        expect(xmp).toContain('plus:LicenseStartDate="2026-08-12"')
        expect(xmp).toContain('Copyright © 2026 bluehair.blue. All rights reserved.')
        expect(xmp).toContain('사전 서면 허가 없이')
        expect(source).toEqual(bytesFromBase64(TINY_PNG_BASE64))
    })

    it('adds VP8X and exactly one rights chunk to a still WebP container', () => {
        const customRights = { ...RIGHTS, owner: 'Artist & Studio' }
        const first = embedRightsXmp(tinyLosslessWebP(), 'webp', customRights)
        const second = embedRightsXmp(first, 'webp', customRights)
        const xmp = readRightsXmp(second, 'webp')

        expect(new TextDecoder('latin1').decode(second.slice(12, 16))).toBe('VP8X')
        expect(xmp).toContain('<rdf:li>Artist &amp; Studio</rdf:li>')
        expect(xmp).toContain('Copyright © 2026 Artist &amp; Studio. All rights reserved.')
        expect(xmp).toContain('without prior written permission from Artist &amp; Studio')
        expect(xmp).toContain('Artist &amp; Studio의 사전 서면 허가 없이')
    })

    it('records the user date in the private sidecar and rejects non-clean modes', () => {
        const writer = new MetadataWriter()
        const prepared = writer.prepare(bytesFromBase64(TINY_PNG_BASE64), {
            params: baseParams(),
            imageFormat: 'png',
            metadataMode: 'strip-and-sidecar',
            rightsXmp: RIGHTS,
        })
        const sidecar = readNaiBlueSidecar(prepared.sidecarBytes!)

        expect(readRightsXmp(prepared.imageBytes, 'png')).not.toBeNull()
        expect(sidecar).toMatchObject({
            version: 2,
            outputPolicySummary: {
                rightsXmp: true,
                rightsOwner: 'bluehair.blue',
                rightsEffectiveDate: '2026-08-12',
            },
        })
        expect(() => writer.prepare(bytesFromBase64(TINY_PNG_BASE64), {
            params: { ...baseParams(), metadataMode: 'embedded' },
            imageFormat: 'png',
            metadataMode: 'embedded',
            rightsXmp: RIGHTS,
        })).toThrow(/strip-and-sidecar/)
    })
})
