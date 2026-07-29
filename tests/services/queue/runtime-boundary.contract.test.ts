import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function source(path: string): Promise<string> {
    return readFile(path, 'utf8')
}

describe('Queue runtime composition boundary', () => {
    it('injects credentials at the composition root instead of importing Zustand in the Queue service', async () => {
        const [runtime, root, main] = await Promise.all([
            source('src/services/queue/runtime.ts'),
            source('src/composition-root/core-runtime.ts'),
            source('src/main.tsx'),
        ])

        expect(runtime).not.toContain("@/stores/")
        expect(runtime).toContain('QueueTokenProvider')
        expect(root).toContain('configureRuntimeQueueDependencies')
        expect(root).toContain('useAuthStore')
        expect(main).toContain('initializeCoreRuntime()')
    })
})
