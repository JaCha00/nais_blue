import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Application relaunch contract', () => {
    it('reloads the Android WebView while retaining native relaunch on desktop', async () => {
        const source = await readFile(resolve(process.cwd(), 'src/lib/app-relaunch.ts'), 'utf8')

        expect(source).toContain('if (isMobileRuntime)')
        expect(source).toContain('window.location.reload()')
        expect(source).toContain('await relaunch()')
        expect(source).toContain('closeApplicationWithFlush({ exit: restartRuntime })')
    })
})
