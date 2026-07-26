import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { NAIMetadata } from '@/lib/metadata-parser'
import {
    MAX_METADATA_BATCH_FILES,
    metadataBatchSummary,
    projectSafeImageMetadata,
    readMetadataBatch,
    serializeMetadataBatchCsv,
    serializeMetadataBatchJson,
    yieldToMetadataEventLoop,
} from '@/services/metadata/batch-metadata-reader'

function file(name: string, size = 1_024, type = 'image/png'): File {
    // The injected parser only needs browser File identity fields, keeping this
    // service contract test independent from image decoding and DOM shims.
    return { name, size, type, lastModified: 1_753_478_400_000 } as File
}

const metadata: NAIMetadata = {
    prompt: 'fallback prompt',
    negativePrompt: 'fallback negative',
    model: 'nai-diffusion-4-5-full',
    steps: 28,
    cfgScale: 5,
    seed: 42,
    width: 832,
    height: 1_216,
    v4_prompt: {
        caption: {
            base_caption: 'v4 prompt',
            char_captions: [{ char_caption: 'hero', centers: [{ x: 0.3, y: 0.4 }] }],
        },
    },
    encodedVibes: ['very-large-base64-payload'],
    raw: { Comment: 'debug-only' },
    hasVibeTransfer: true,
    vibeTransferInfo: [{ strength: 0.6, informationExtracted: 0.8 }],
}

describe('batch metadata reader', () => {
    it('keeps yielding when animation frames are suspended in a hidden window', async () => {
        const suspendedFrame = vi.fn(() => 1)
        vi.stubGlobal('requestAnimationFrame', suspendedFrame)

        await expect(yieldToMetadataEventLoop()).resolves.toBeUndefined()
        expect(suspendedFrame).not.toHaveBeenCalled()

        vi.unstubAllGlobals()
    })

    it('reads a real NAIS blue sidecar through the production parser', async () => {
        const fixture = readFileSync(
            new URL('../../fixtures/metadata/data-hub-sample.nais-blue.json', import.meta.url),
            'utf8',
        )
        const sidecar = new File([fixture], 'data-hub-sample.nais-blue.json', {
            type: 'application/json',
            lastModified: 1_753_478_400_000,
        })

        const items = await readMetadataBatch([sidecar], { yieldToUi: async () => undefined })

        expect(items[0]).toMatchObject({
            status: 'found',
            fileName: 'data-hub-sample.nais-blue.json',
            metadata: {
                prompt: '1girl, blue hour portrait, quiet expression',
                model: 'nai-diffusion-4-5-full',
                width: 832,
                height: 1_216,
                seed: 424_242,
            },
        })
    })

    it('projects prompts and parameters without raw or encoded image data', () => {
        const safe = projectSafeImageMetadata(metadata)
        const serialized = JSON.stringify(safe)

        expect(safe.prompt).toBe('v4 prompt')
        expect(safe.characterPrompts).toEqual([
            { prompt: 'hero', centers: [{ x: 0.3, y: 0.4 }] },
        ])
        expect(safe.hasVibeTransfer).toBe(true)
        expect(serialized).not.toContain('encodedVibes')
        expect(serialized).not.toContain('very-large-base64-payload')
        expect(serialized).not.toContain('debug-only')
    })

    it('keeps successful, empty, and failed files in input order', async () => {
        const progress = vi.fn()
        const parser = vi.fn(async (candidate: File) => {
            if (candidate.name === 'found.png') return metadata
            if (candidate.name === 'empty.webp') return null
            throw new Error('broken metadata')
        })

        const items = await readMetadataBatch([
            file('found.png'),
            file('empty.webp', 2_048, 'image/webp'),
            file('broken.jpg', 3_072, 'image/jpeg'),
        ], {
            parse: parser,
            onProgress: progress,
            yieldToUi: async () => undefined,
        })

        expect(items.map(item => item.status)).toEqual(['found', 'empty', 'failed'])
        expect(items[2]?.error).toBe('broken metadata')
        expect(metadataBatchSummary(items)).toEqual({ found: 1, empty: 1, failed: 1 })
        expect(progress).toHaveBeenLastCalledWith({
            completed: 3,
            total: 3,
            currentFileName: 'broken.jpg',
        })
    })

    it('rejects oversized selections before parsing', async () => {
        const parser = vi.fn()
        const files = Array.from({ length: MAX_METADATA_BATCH_FILES + 1 }, (_, index) => file(`${index}.png`))

        await expect(readMetadataBatch(files, { parse: parser })).rejects.toThrow(/at most 500/i)
        expect(parser).not.toHaveBeenCalled()
    })

    it('exports deterministic JSON summaries and spreadsheet-safe CSV quoting', () => {
        const item = {
            id: '0:sample.png',
            index: 0,
            fileName: '=sample,"one".png',
            mimeType: 'image/png',
            sizeBytes: 1_024,
            lastModified: 0,
            status: 'found' as const,
            metadata: projectSafeImageMetadata(metadata),
            error: null,
        }

        const json = serializeMetadataBatchJson([item], '2026-07-26T00:00:00.000Z')
        const csv = serializeMetadataBatchCsv([item])

        expect(JSON.parse(json).summary).toEqual({ found: 1, empty: 0, failed: 0 })
        expect(csv.startsWith('\uFEFF')).toBe(true)
        expect(csv).toContain('"\'=sample,""one"".png"')
        expect(csv).toContain('"v4 prompt"')
    })
})
