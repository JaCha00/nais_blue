import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('rescue screen contract', () => {
    it('offers retry, redacted diagnostic export, backup guidance, and safe exit as touch-sized native buttons', () => {
        const source = readFileSync(
            new URL('../../src/components/startup/RescueScreen.tsx', import.meta.url),
            'utf8',
        )

        expect(source).toContain('onRetry')
        expect(source).toContain('downloadDiagnosticsExport')
        expect(source).toContain('NAIS_Backup/full')
        expect(source).toContain('closeApplicationWithFlush')
        expect(source.match(/<button/g)?.length).toBeGreaterThanOrEqual(3)
        expect(source).toContain('min-h-11')
        expect(source).toContain('aria-label=')
        expect(source).not.toMatch(/onKeyDown|role=["']button["']/)
    })

    it('does not import or render normal generation, editing, or save entry points', () => {
        const source = readFileSync(
            new URL('../../src/components/startup/RescueScreen.tsx', import.meta.url),
            'utf8',
        )

        expect(source).not.toMatch(/from ['"].*(?:App|MainMode|SceneMode|StyleLab|generation-store)/)
        expect(source).not.toMatch(/<(?:App|MainMode|SceneMode|StyleLab)\b/)
    })
})
