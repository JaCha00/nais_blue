import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createRuntimeCapabilities } from '@/platform/capabilities'
import { buildGenerateImagePayload } from '@/services/nai/payload'

describe('Phase 13 pre-change behavior characterization', () => {
    it('preserves the payload-owned final base and enabled character expansion', () => {
        const payload = buildGenerateImagePayload({
            prompt: '1girl\n# local note\nblue eyes',
            negativePrompt: 'lowres',
            model: 'nai-diffusion-4-5-full',
            width: 832,
            height: 1216,
            steps: 28,
            cfgScale: 5,
            cfgRescale: 0,
            sampler: 'k_euler_ancestral',
            noiseSchedule: 'karras',
            seed: 42,
            variety: false,
            qualityToggle: true,
            ucPreset: 2,
            characterPrompts: [
                { prompt: 'solo\n# local note', negativePrompt: 'bad hands', enabled: true },
                { prompt: 'ignored', negativePrompt: 'ignored', enabled: false },
            ],
            useCoords: false,
        })

        expect(payload.input).toBe('1girl\nblue eyes, very aesthetic, masterpiece, no text')
        expect(payload.parameters.v4_prompt).toMatchObject({
            caption: {
                base_caption: payload.input,
                char_captions: [{ char_caption: 'solo' }],
            },
        })
        expect(payload.parameters.v4_negative_prompt).toMatchObject({
            caption: {
                base_caption: 'lowres',
                char_captions: [{ char_caption: 'bad hands' }],
            },
        })
    })

    it('keeps unsupported mobile capabilities explicit and actionable', () => {
        const android = createRuntimeCapabilities('android')

        for (const capability of [
            android.absoluteOutputPath,
            android.localTaggerSidecar,
            android.r2ForegroundUpload,
            android.r2BackgroundUpload,
            android.secureLanSyncTransport,
        ]) {
            expect(capability.supported).toBe(false)
            expect(capability.reason).toEqual(expect.any(String))
            expect(capability.reason?.trim()).not.toBe('')
            expect(capability.alternative).toEqual(expect.any(String))
            expect(capability.alternative?.trim()).not.toBe('')
        }
    })

    it('keeps local API token and output choices behind explicit user actions', async () => {
        const [tokenCard, settings] = await Promise.all([
            readFile(resolve(process.cwd(), 'src/components/credentials/ApiTokenSettingsCard.tsx'), 'utf8'),
            readFile(resolve(process.cwd(), 'src/pages/Settings.tsx'), 'utf8'),
        ])

        expect(tokenCard).toContain('requestTokenEntry')
        expect(tokenCard).toContain("t('settingsPage.api.manage'")
        expect(settings).toContain('setSavePath')
        expect(settings).toContain('setImageFormat')
        expect(settings).toContain("<SelectItem value=\"png\">PNG</SelectItem>")
        expect(settings).toContain("<SelectItem value=\"webp\">WebP</SelectItem>")
    })
})
