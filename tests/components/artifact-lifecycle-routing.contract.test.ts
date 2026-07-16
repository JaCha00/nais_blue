import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Artifact lifecycle routing', () => {
    it('uses a typed transient store instead of the legacy window event', async () => {
        const files = await Promise.all([
            'src/stores/generation-store.ts',
            'src/lib/scene-generation/save-scene-result.ts',
            'src/services/style-lab-generation.ts',
            'src/services/queue/main-queue-adapter.ts',
            'src/pages/MainMode.tsx',
            'src/pages/ToolsMode.tsx',
            'src/components/layout/HistoryPanel.tsx',
        ].map(source))

        for (const contents of files) {
            expect(contents).not.toContain('newImageGenerated')
        }
        expect(files.slice(0, -1).every(contents => contents.includes('publishGeneratedArtifact'))).toBe(true)
        expect(files.at(-1)).toContain('useArtifactLifecycleStore')
    })
})
