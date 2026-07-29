import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Scene Queue snapshot boundary', () => {
    it('delegates V1 encoding and decoding to the Scene codec', async () => {
        const [adapter, executor] = await Promise.all([
            readFile(resolve(process.cwd(), 'src/services/queue/scene-queue-adapter.ts'), 'utf8'),
            readFile(resolve(process.cwd(), 'src/services/queue/scene-queue-executor.ts'), 'utf8'),
        ])

        expect(adapter).toContain('encodeSceneJobSnapshot({')
        expect(executor).toContain('decodeSceneJobSnapshot(job.snapshot)')
        expect(adapter).not.toContain('createGenerationJobSnapshot(')
        expect(adapter).not.toContain('parseSceneQueueParameters')
        expect(adapter).not.toContain('executeNovelAIImageTransport')
        expect(executor).not.toContain('createBatchAndEnqueue')
        expect(executor).not.toMatch(/@\/stores\//)
    })
})
