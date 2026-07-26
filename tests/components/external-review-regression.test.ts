import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../src/i18n/locales/en.json'
import ja from '../../src/i18n/locales/ja.json'
import ko from '../../src/i18n/locales/ko.json'
import { reducer } from '../../src/components/ui/use-toast'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('External review regression fixes', () => {
    it('preserves native Tab traversal and assigns page cycling to modified keys', async () => {
        const [hook, store] = await Promise.all([
            source('src/hooks/useShortcuts.ts'),
            source('src/stores/shortcut-store.ts'),
        ])

        expect(hook).toContain('if (shouldPreserveNativeTabNavigation(e)) return')
        expect(hook).toContain("event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey")
        expect(store).toContain("'navigate:next': { key: 'PageDown', ctrl: true")
        expect(store).toContain("'navigate:prev': { key: 'PageUp', ctrl: true")
        expect(store).toContain("binding.key.toLowerCase() === 'tab'")
    })

    it('does not emit retired asset-module routes from active UI entry points', async () => {
        const paths = [
            'src/pages/MainMode.tsx',
            'src/pages/SceneMode.tsx',
            'src/pages/SceneDetail.tsx',
            'src/components/guidance/ProductGuidance.tsx',
        ]
        const sources = await Promise.all(paths.map(source))

        for (const contents of sources) expect(contents).not.toContain('/asset-modules')
        expect(sources.at(-1)).toContain("navigate('/r2')")
    })

    it('keeps three recent notifications instead of silently replacing each one', () => {
        let state = { toasts: [] as Array<{ id: string; title: string }> }
        for (const id of ['1', '2', '3', '4']) {
            state = reducer(state, {
                type: 'ADD_TOAST',
                toast: { id, title: id },
            }) as typeof state
        }

        expect(state.toasts.map(toast => toast.id)).toEqual(['4', '3', '2'])
    })

    it('describes the analysis provider that the current UI actually calls', () => {
        for (const locale of [ko, en, ja]) {
            expect(locale.smartTools.analysisDescription).toMatch(/Kaloscope/i)
            expect(locale.smartTools.analysisDescription).not.toMatch(/WD Tagger/i)
        }
    })
})
