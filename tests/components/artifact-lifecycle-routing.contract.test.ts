import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Artifact lifecycle routing', () => {
    it('uses a typed transient store instead of the legacy window event', async () => {
        const publishers = await Promise.all([
            'src/stores/generation-store.ts',
            'src/lib/scene-generation/save-scene-result.ts',
            'src/services/style-lab-generation.ts',
            'src/presentation/queue/zustand-main-queue-presentation.ts',
            'src/pages/MainMode.tsx',
            'src/pages/ToolsMode.tsx',
        ].map(source))
        const [mainQueue, history] = await Promise.all([
            source('src/services/queue/main-queue-executor.ts'),
            source('src/components/layout/HistoryPanel.tsx'),
        ])

        for (const contents of [...publishers, mainQueue, history]) {
            expect(contents).not.toContain('newImageGenerated')
        }
        expect(publishers.every(contents => contents.includes('publishGeneratedArtifact'))).toBe(true)
        expect(mainQueue).toContain('presentation.publishArtifact')
        expect(mainQueue).not.toContain('publishGeneratedArtifact')
        expect(history).toContain('useArtifactLifecycleStore')
    })

    it('retains optional queue lineage when History refreshes generated artifacts', async () => {
        const history = await source('src/components/layout/HistoryPanel.tsx')

        for (const field of ['artifactId', 'sourceJobId', 'sourceSceneId']) {
            expect(history).toContain(`${field}?: string`)
            expect(history).toContain(`latestGeneratedArtifact.${field}`)
        }
    })

    it('rejoins durable artifact lineage after a History disk refresh without making History authoritative', async () => {
        const history = await source('src/components/layout/HistoryPanel.tsx')

        expect(history).toContain('buildArtifactHistoryShadow')
        expect(history).toContain('artifactHistoryPathKey(image.path)')
        expect(history).toContain('Disk scan remains the current History authority')
    })
})
