import { describe, expect, it } from 'vitest'

import {
    naiStyleCatalogModuleName,
    naiStyleCatalogModuleParts,
    parseNaiStyleCatalogFile,
} from '@/lib/nai-style-catalog'

describe('NAI style catalog import', () => {
    it('streams a one-line catalog using JSON structure rather than schema text markers', async () => {
        const json = JSON.stringify([
            {
                schema: 'nai-style-record/v1',
                id: 'shared-style-00000000000000000001',
                title: '공유 그림체 0001',
                base: 'literal {"schema":"inside prompt"}, 눈빛과 \\ escape',
                negative: 'lowres',
                negative_full: 'preset text that must not replace negative',
                characters: [{
                    prompt: 'silver hair',
                    negative: 'blue hair',
                    centers: [{ x: 0.2, y: 0.8 }],
                }],
                params: { position_mode: 'ai', use_coords: true },
            },
            {
                schema: 'nai-style-record/v1',
                id: 'shared-style-00000000000000000002',
                title: '공유 그림체 0002',
                base: 'watercolor',
                negative: 'text',
                characters: [{
                    prompt: 'blue eyes',
                    negative: '',
                    centers: [{ x: 0.3, y: 0.7 }],
                }],
                params: { position_mode: 'coordinate' },
            },
            {
                schema: 'nai-style-record/v1',
                id: 'shared-style-00000000000000000003',
                title: 'legacy coordinates',
                base: 'ink',
                negative: '',
                characters: [
                    { prompt: 'hat', centers: [{ x: 0.4, y: 0.6 }] },
                    { prompt: 'legacy default', centers: [{ x: 0, y: 0 }] },
                ],
                params: {},
            },
        ])

        const result = await parseNaiStyleCatalogFile(streamOnlyFile(json, 7))

        expect(result?.items).toHaveLength(3)
        expect(result?.items[0]).toMatchObject({
            positive: 'literal {"schema":"inside prompt"}, 눈빛과 \\ escape',
            negative: 'lowres',
            characters: [{ position: { x: 0.5, y: 0.5 } }],
        })
        expect(result?.items[1].characters[0].position).toEqual({ x: 0.3, y: 0.7 })
        expect(result?.items[2].characters[0].position).toEqual({ x: 0.4, y: 0.6 })
        expect(result?.items[2].characters[1].position).toEqual({ x: 0.5, y: 0.5 })
    })

    it('returns null for ordinary JSON and rejects a broken recognized catalog', async () => {
        await expect(parseNaiStyleCatalogFile(streamOnlyFile(JSON.stringify({ prompt: 'portrait' }), 2))).resolves.toBeNull()
        await expect(parseNaiStyleCatalogFile(streamOnlyFile(
            '[{"schema":"nai-style-record/v1","id":"style-1","title":"one","base":"ink","negative":""},]',
            3,
        ))).rejects.toThrow('Invalid value')
    })

    it('builds stable module identities and retains every character caption without positions', async () => {
        const result = await parseNaiStyleCatalogFile(streamOnlyFile(JSON.stringify([{
            schema: 'nai-style-record/v1',
            id: 'shared-style-0cd0dd10298bc288f67b',
            title: 'Shared style',
            base: 'masterpiece',
            negative: 'lowres',
            characters: [
                { prompt: 'silver hair', negative: 'blue hair', centers: [{ x: 0.2, y: 0.3 }] },
                { prompt: 'black hair', negative: 'white hair', centers: [{ x: 0.7, y: 0.8 }] },
            ],
            params: { position_mode: 'coordinate' },
        }])))
        const item = result?.items[0]
        expect(item).toBeDefined()
        if (!item) return

        expect(naiStyleCatalogModuleName(item)).toBe('Shared style · c288f67b')
        expect(naiStyleCatalogModuleParts(item)).toEqual({
            base: 'masterpiece',
            negative: 'lowres',
            character: 'silver hair\n\nblack hair',
            'character-negative': 'blue hair\n\nwhite hair',
        })
    })
})

function streamOnlyFile(json: string, chunkSize = 64): File {
    const bytes = new TextEncoder().encode(json)
    return {
        name: '그림체.json',
        type: 'application/json',
        size: bytes.byteLength,
        stream: () => {
            let offset = 0
            return new ReadableStream<Uint8Array>({
                pull(controller) {
                    if (offset >= bytes.length) {
                        controller.close()
                        return
                    }
                    controller.enqueue(bytes.slice(offset, offset + chunkSize))
                    offset += chunkSize
                },
            })
        },
        text: () => { throw new Error('The streaming parser must not call File.text()') },
        arrayBuffer: () => { throw new Error('The streaming parser must not call File.arrayBuffer()') },
    } as unknown as File
}
