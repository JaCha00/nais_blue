import { describe, expect, it } from 'vitest'

import {
    buildNais2Params,
    cloneCompositionRandomTrace,
    redactSentPayloadForMetadata,
} from '@/lib/generation-metadata'

describe('generation metadata payload redaction', () => {
    it('removes cached reference secrets without losing the redacted array shape', () => {
        const redacted = redactSentPayloadForMetadata(JSON.stringify({
            parameters: {
                director_reference_images_cached: [
                    { cache_secret_key: 'full-secret-one' },
                    { cache_secret_key: 'full-secret-two', extra: true },
                ],
                image_cache_secret_key: 'source-secret',
            },
        }))

        expect(redacted).not.toContain('full-secret')
        expect(redacted).not.toContain('source-secret')
        expect(JSON.parse(redacted)).toEqual({
            parameters: {
                director_reference_images_cached: [
                    { cache_secret_key: '[redacted-cache-key]' },
                    { cache_secret_key: '[redacted-cache-key]', extra: true },
                ],
                image_cache_secret_key: '[redacted-cache-key]',
            },
        })
    })

    it('round-trips a byte-free composition random trace into NAIS blue metadata', () => {
        const trace = cloneCompositionRandomTrace([{
            ruleId: 'rotation:scene:one',
            streamKey: 'character-rotation:preset:one',
            drawIndex: 0,
            seed: 77,
            result: 'character:alpha',
            selectedOptionIds: ['rotation:scene:one:selected'],
            extensions: { source: 'rotation-store-sequence' },
        }])
        const metadata = buildNais2Params({
            prompt: '',
            negative_prompt: '',
            model: 'nai-diffusion-4-5-full',
            width: 832,
            height: 1216,
            steps: 28,
            cfg_scale: 5,
            cfg_rescale: 0,
            sampler: 'k_euler_ancestral',
            scheduler: 'karras',
            smea: false,
            smea_dyn: false,
            variety: false,
            seed: 77,
            compositionRandomTrace: trace,
        })

        expect(metadata.compositionRandomTrace).toEqual(trace)
        expect(JSON.stringify(metadata)).toContain('rotation-store-sequence')
        expect(JSON.stringify(metadata)).not.toContain('base64')
    })
})
