import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Style Lab Queue snapshot boundary', () => {
    it('delegates V1 render encoding and decoding to the Style Lab codec', async () => {
        const [adapter, executor] = await Promise.all([
            readFile(resolve(process.cwd(), 'src/services/style-lab/style-lab-queue-adapter.ts'), 'utf8'),
            readFile(resolve(process.cwd(), 'src/services/style-lab/style-lab-queue-executor.ts'), 'utf8'),
        ])

        expect(adapter).toContain('encodeStyleLabJobSnapshot({')
        expect(executor).toContain('decodeStyleLabJobSnapshot(job.snapshot)')
        expect(adapter).not.toContain('createGenerationJobSnapshot(')
        expect(adapter).not.toContain('parseStyleLabQueueParameters')
        expect(adapter).not.toContain('executeNovelAIImageTransport')
        expect(adapter).not.toContain('getRuntimeOutputWriter')
        expect(executor).not.toContain('createBatchAndEnqueue')
        expect(executor).not.toContain('reconcileStyleLabRenderReservations')
        expect(executor).not.toMatch(/@\/stores\//)
        expect(executor).toContain('dependencies.presentation')
        expect(executor).toContain('presentation.clearPreview(workflow.comboId)')
    })
})
