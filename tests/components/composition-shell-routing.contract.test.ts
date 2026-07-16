import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Composition workspace shell routing', () => {
    it('gives Main and Scene the desktop rails while preserving store-owned Prompt and History sheets', async () => {
        const [layout, layoutStore] = await Promise.all([
            source('src/components/layout/ThreeColumnLayout.tsx'),
            source('src/stores/layout-store.ts'),
        ])

        expect(layout).toContain("location.pathname === '/'")
        expect(layout).toContain("location.pathname === '/scenes'")
        expect(layout).toContain("location.pathname.startsWith('/scenes/')")
        expect(layout).toContain('const promptPanelIsDocked = isDesktopShell')
        expect(layout).toContain('const historyPanelIsDocked = isDesktopShell && !compositionWorkspaceOwnsRails')
        expect(layout).toContain("id=\"nais2-prompt-sheet\"")
        expect(layout).toContain("id=\"nais2-history-sheet\"")
        expect(layout).toContain('promptPanelIsDocked ? leftSidebarVisible : leftSheetOpen')
        expect(layout).toContain('historyPanelIsDocked ? rightSidebarVisible : rightSheetOpen')
        expect(layout).toMatch(/<Sheet[\s\S]*?modal=\{false\}/)
        expect(layout).toContain('showOverlay={false}')
        expect(layout).not.toContain('LAYOUT_SHEET_EVENTS')
        expect(layoutStore).toContain("supportSheet: 'prompt' | 'history' | null")
        expect(layoutStore).toContain('openSupportSheet:')
        expect(layoutStore).toContain('closeSupportSheet:')
        expect(layoutStore).toContain('partialize: ({ leftSidebarVisible, rightSidebarVisible })')
    })

    it('keeps route-independent executors and global listeners behind one App lifetime boundary', async () => {
        const [app, runtimeProviders] = await Promise.all([
            source('src/App.tsx'),
            source('src/components/runtime/RuntimeProviders.tsx'),
        ])

        expect(app).toContain('<RuntimeProviders>')
        expect(app).not.toContain('useSceneGeneration()')
        expect(runtimeProviders).toContain('useSceneGeneration()')
        expect(runtimeProviders).toContain('useDurableQueueRuntime()')
        expect(runtimeProviders).toContain('useR2UploadRuntime()')
        expect(runtimeProviders).not.toContain("document.addEventListener('contextmenu'")
        expect(runtimeProviders).not.toContain('preventDefault()')
    })

    it('keeps focus trapping and focus return delegated to the Radix sheet primitive', async () => {
        const sheet = await source('src/components/ui/sheet.tsx')

        expect(sheet).toContain('SheetPrimitive.Content')
        expect(sheet).toContain('SheetPrimitive.Overlay')
        expect(sheet).toContain('SheetPrimitive.Close')
    })
})
