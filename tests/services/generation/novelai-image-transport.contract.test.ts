import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('NovelAI image transport boundary', () => {
    it('routes direct Main and durable Main, Scene, and Style Lab through one provider entry', async () => {
        const workflows = await Promise.all([
            'src/services/generation/main-transport-executor.ts',
            'src/services/queue/main-queue-executor.ts',
            'src/services/queue/scene-queue-executor.ts',
            'src/services/style-lab/style-lab-queue-adapter.ts',
        ].map(source))

        for (const workflow of workflows) {
            expect(workflow).toContain('executeNovelAIImageTransport')
            expect(workflow).not.toContain("from '@/services/novelai-api'")
            expect(workflow).not.toContain('generateImageStream(')
            expect(workflow).not.toContain('generateImage(')
        }
    })
})
