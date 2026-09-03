import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    CURRENT_NAI_PAYLOAD_BUILDER_REVISION,
    LEGACY_NAI_PAYLOAD_BUILDER_REVISION,
    NAI_COMPATIBILITY_REGISTRY,
    queryNaiCompatibility,
} from '@/services/nai/compatibility'

describe('NovelAI compatibility registry', () => {
    it.each([
        LEGACY_NAI_PAYLOAD_BUILDER_REVISION,
        CURRENT_NAI_PAYLOAD_BUILDER_REVISION,
    ])('binds %s to the real synthetic fixture hash without claiming a pass', async payloadBuilderRevision => {
        const entry = NAI_COMPATIBILITY_REGISTRY[payloadBuilderRevision]
        const bytes = await readFile(resolve(process.cwd(), entry.path))
        const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
        const result = queryNaiCompatibility({
            model: 'nai-diffusion-4-5-full',
            action: 'generate',
            features: [],
            payloadBuilderRevision,
        })

        expect(entry.sha256).toBe(sha256)
        expect(entry.provenance).toBe('synthetic-only')
        expect(result.status).toBe('synthetic-only')
        expect(result.warnings).toEqual(['W_NAI_COMPATIBILITY_SYNTHETIC_ONLY'])
        expect(['captured-pass', 'live-canary-pass']).not.toContain(result.status)
    })

    it('fails closed for unknown revisions and known model-feature divergence', () => {
        expect(queryNaiCompatibility({
            model: 'nai-diffusion-4-5-full',
            action: 'generate',
            features: [],
            payloadBuilderRevision: 'future-wire-v99',
        }).status).toBe('unsupported')

        expect(queryNaiCompatibility({
            model: 'nai-diffusion-5-full',
            action: 'generate',
            features: ['vibe-transfer'],
            payloadBuilderRevision: CURRENT_NAI_PAYLOAD_BUILDER_REVISION,
        }).status).toBe('known-divergence')
    })
})
