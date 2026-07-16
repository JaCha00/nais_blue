import { describe, expect, it } from 'vitest'

import { buildNais2Params } from '@/lib/generation-metadata'
import { parseNais2SidecarMetadata } from '@/lib/metadata-parser'
import {
    embedNais2Params,
    encodeNais2Sidecar,
    parseNais2Params,
    readNais2Params,
    readNais2Sidecar,
} from '@/lib/nais2-png-meta'
import type { GenerationParams } from '@/services/novelai-types'

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+4xVnAAAAAElFTkSuQmCC'

function baseParams(overrides: Partial<GenerationParams> = {}): GenerationParams {
    return {
        prompt: 'base prompt',
        negative_prompt: 'negative prompt',
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
        ...overrides,
    }
}

function bytesFromBase64(value: string): Uint8Array {
    return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

describe('NAIS2 Metadata v2', () => {
    it('builds the required portable fields and omits the payload by default', () => {
        const redactedPayload = JSON.stringify({ parameters: { prompt: 'secret-ish details' } })
        const metadata = buildNais2Params(baseParams({
            sourceJobId: 'job:durable:1',
            engineVersion: 'composition-engine-v1',
            sourceRevision: 12,
            compositionRecipeId: 'recipe:portrait',
            sentPayloadSummary: redactedPayload,
            characterPrompts: [{
                stableId: 'character:alice',
                prompt: 'alice',
                negative: 'bad hands',
                enabled: true,
                position: { x: 0.25, y: 0.75 },
            }],
            outputPolicySummary: {
                imageFormat: 'png',
                metadataMode: 'embedded',
                destinationKind: 'library',
                writesThumbnail: true,
                collisionPolicy: 'unique',
            },
        }))

        expect(metadata.version).toBe(2)
        if (metadata.version !== 2) throw new Error('expected v2')
        expect(metadata.engineVersion).toBe('composition-engine-v1')
        expect(metadata.sourceRevision).toBe(12)
        expect(metadata.sourceJobId).toBe('job:durable:1')
        expect(metadata.recipeId).toBe('recipe:portrait')
        expect(metadata.characters[0]).toMatchObject({ stableId: 'character:alice' })
        expect(metadata.resolvedParams).toMatchObject({ width: 832, height: 1216, seed: 77 })
        expect(metadata.redactedPayloadHash).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(JSON.stringify(metadata)).not.toContain('secret-ish details')
        expect(metadata.outputPolicySummary).toEqual({
            imageFormat: 'png',
            metadataMode: 'embedded',
            destinationKind: 'library',
            writesThumbnail: true,
            collisionPolicy: 'unique',
        })
    })

    it('does not hash an existing redacted payload digest twice', () => {
        const digest = `sha256:${'a'.repeat(64)}`
        const metadata = buildNais2Params(baseParams({ sentPayloadSummary: digest }))
        expect(metadata.version).toBe(2)
        if (metadata.version !== 2) throw new Error('expected v2')
        expect(metadata.redactedPayloadHash).toBe(digest)
    })

    it('strictly round-trips v2 through embedded metadata and sidecars', () => {
        const metadata = buildNais2Params(baseParams())
        const embedded = embedNais2Params(TINY_PNG_BASE64, metadata)
        expect(readNais2Params(bytesFromBase64(embedded))).toEqual(metadata)

        const sidecar = encodeNais2Sidecar(metadata)
        expect(readNais2Sidecar(sidecar)).toEqual(metadata)
        expect(parseNais2SidecarMetadata(sidecar)).toMatchObject({
            metadataVersion: 2,
            width: 832,
            height: 1216,
            seed: 77,
        })
    })

    it('reads known legacy metadata but rejects credential-bearing policy summaries', () => {
        expect(readNais2Sidecar('{"version":1,"qualityToggle":true}')).toEqual({
            version: 1,
            qualityToggle: true,
        })

        const valid = buildNais2Params(baseParams())
        expect(valid.version).toBe(2)
        const invalid = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>
        invalid.outputPolicySummary = {
            imageFormat: 'png',
            metadataMode: 'embedded',
            accessKey: 'must-not-be-readable',
        }
        expect(parseNais2Params(invalid)).toBeNull()
    })
})
