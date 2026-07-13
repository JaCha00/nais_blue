import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Composition workspace shell routing', () => {
    it('gives Main and Scene the desktop rails while preserving Prompt and History sheets', async () => {
        const layout = await source('src/components/layout/ThreeColumnLayout.tsx')

        expect(layout).toContain("location.pathname === '/'")
        expect(layout).toContain("location.pathname === '/scenes'")
        expect(layout).toContain("location.pathname.startsWith('/scenes/')")
        expect(layout).toContain('const supportPanelsAreDocked = isDesktopShell && !compositionWorkspaceOwnsRails')
        expect(layout).toContain("id=\"nais2-prompt-sheet\"")
        expect(layout).toContain("id=\"nais2-history-sheet\"")
        expect(layout).toContain('supportPanelsAreDocked ? leftSidebarVisible : leftSheetOpen')
        expect(layout).toContain('supportPanelsAreDocked ? rightSidebarVisible : rightSheetOpen')
    })

    it('keeps focus trapping and focus return delegated to the Radix sheet primitive', async () => {
        const sheet = await source('src/components/ui/sheet.tsx')

        expect(sheet).toContain('SheetPrimitive.Content')
        expect(sheet).toContain('SheetPrimitive.Overlay')
        expect(sheet).toContain('SheetPrimitive.Close')
    })
})
