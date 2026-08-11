import { File } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
    promptModuleLines,
    promptModuleSourceLine,
} from '@/components/fragments/PromptModuleCreator'
import { renderGuidedAgentPrompt } from '@/presentation/workflow/GuidedAgentPromptComposer'
import { readGuidedPromptImportFile } from '@/presentation/workflow/GuidedPromptFileImport'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Guided prompt file import', () => {
    it('reads positive and negative prompts from a dropped NovelAI PNG', async () => {
        const png = new File([pngWithTextChunks([
            ['Comment', JSON.stringify({ prompt: '1girl, blue hour', uc: 'lowres, text' })],
            ['Source', 'NovelAI Diffusion V4.5 Full'],
        ])], 'novelai.png', { type: 'image/png' })

        await expect(readGuidedPromptImportFile(png as unknown as globalThis.File)).resolves.toMatchObject({
            positive: '1girl, blue hour',
            negative: 'lowres, text',
        })
    })

    it('reads the settings JSON saved by a Guided result', async () => {
        const file = new File([JSON.stringify({
            schemaVersion: 1,
            kind: 'nais-guided-single-image-settings',
            prompt: { positive: '1girl, moonlight', negative: 'blurry' },
        })], 'guided-settings.json', { type: 'application/json' })

        await expect(readGuidedPromptImportFile(file as unknown as globalThis.File)).resolves.toEqual({
            positive: '1girl, moonlight',
            negative: 'blurry',
            sourceName: 'guided-settings.json',
        })
    })

    it('reads plain NovelAI-shaped JSON and rejects files without prompt metadata', async () => {
        const metadata = new File([
            JSON.stringify({ prompt: 'portrait, rim light', uc: 'text, watermark' }),
        ], 'novelai.json', { type: 'application/json' })
        const invalid = new File([JSON.stringify({ width: 1024 })], 'empty.json', { type: 'application/json' })

        await expect(readGuidedPromptImportFile(metadata as unknown as globalThis.File)).resolves.toMatchObject({
            positive: 'portrait, rim light',
            negative: 'text, watermark',
        })
        await expect(readGuidedPromptImportFile(invalid as unknown as globalThis.File)).rejects.toThrow('No prompt metadata')
    })

    it('normalizes imported text and preserves one module candidate per line', () => {
        expect(promptModuleSourceLine('portrait,\n  blue light')).toBe('portrait, blue light')
        expect(promptModuleLines('silver hair\n# note\n\nblue hair')).toEqual(['silver hair', 'blue hair'])
    })

    it('mounts the common importer in every Guided prompt editor that owns image prompts', async () => {
        const [single, batch, promptTasks] = await Promise.all([
            source('src/presentation/workflow/GuidedSingleImage.tsx'),
            source('src/presentation/workflow/GuidedBatchImages.tsx'),
            source('src/presentation/workflow/GuidedPromptTasks.tsx'),
        ])
        expect(single.match(/<GuidedPromptFileImport/g)).toHaveLength(1)
        expect(batch.match(/<GuidedPromptFileImport/g)).toHaveLength(2)
        expect(promptTasks.match(/<GuidedPromptFileImport/g)).toHaveLength(2)
    })
})

function pngWithTextChunks(entries: Array<[string, string]>): Uint8Array {
    const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    return concatBytes(
        signature,
        ...entries.map(([keyword, value]) => pngChunk('tEXt', `${keyword}\0${value}`)),
        pngChunk('IEND', ''),
    )
}

function pngChunk(type: string, text: string): Uint8Array {
    const payload = new TextEncoder().encode(text)
    const chunk = new Uint8Array(12 + payload.length)
    new DataView(chunk.buffer).setUint32(0, payload.length)
    chunk.set(new TextEncoder().encode(type), 4)
    chunk.set(payload, 8)
    return chunk
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

describe('Guided local-agent prompt templates', () => {
    it('fills safe workspace variables and a selected reference file', () => {
        const prompt = renderGuidedAgentPrompt({
            templateId: 'reference',
            presetName: 'Night portrait',
            presetId: 'preset:night',
            revision: 7,
            workspacePath: 'C:\\NAIS\\agent-workspace',
            goal: 'keep the face and change the lighting',
            referencePath: 'D:\\refs\\sample.png',
        })

        expect(prompt).toContain('preset:night')
        expect(prompt).toContain('snapshot revision: 7')
        expect(prompt).toContain('D:\\refs\\sample.png')
        expect(prompt).toContain('keep the face and change the lighting')
        expect(prompt).toContain('preset.patch')
        expect(prompt).not.toMatch(/api.?token|secret access key/i)
    })
})
