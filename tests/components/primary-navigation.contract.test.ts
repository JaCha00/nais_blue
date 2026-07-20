import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Primary navigation contract', () => {
    it('removes retired feature routes and redirects stale deep links', async () => {
        const app = await source('src/App.tsx')

        for (const route of ['/asset-modules', '/organizer', '/prompts']) {
            expect(app).not.toContain(`path="${route}"`)
        }
        expect(app).toContain('path="/r2"')
        expect(app).toContain('path="*"')
        expect(app).toContain('<Navigate to="/" replace />')
    })

    it('keeps every remaining destination in the top navigation', async () => {
        const layout = await source('src/components/layout/ThreeColumnLayout.tsx')

        for (const route of ['/', '/scenes', '/tools', '/style-lab', '/queue', '/r2', '/web', '/library', '/settings']) {
            expect(layout).toContain(`path: '${route}'`)
        }
        expect(layout).not.toContain("path: '/asset-modules'")
        expect(layout).not.toContain("path: '/organizer'")
        expect(layout).not.toContain("path: '/prompts'")
    })

    it('only condenses navigation below the large desktop layout', async () => {
        const navigation = await source('src/components/layout/AnimatedNavBar.tsx')

        expect(navigation).toContain("items.map(item => renderItem(item, 'activeTab-desktop', true))")
        expect(navigation).toContain('min-[1800px]:flex')
        expect(navigation).toContain('lg:hidden')
    })

    it('removes Discord community shortcuts from settings', async () => {
        const settings = await source('src/pages/Settings.tsx')

        expect(settings).not.toContain('discord.gg')
        expect(settings).not.toContain('MessagesSquare')
    })
})
