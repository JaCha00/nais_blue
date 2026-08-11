import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { openLibraryToolsSurface } from '@/components/library/LibraryContextMenu'
import { QueueActivityLinkView } from '@/components/layout/QueueActivityLink'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

describe('Guided embedded navigation behavior', () => {
    it('opens Library tools inline when Guided supplies the surface callback', () => {
        const openInline = vi.fn()
        const navigate = vi.fn()

        openLibraryToolsSurface(openInline, navigate)

        expect(openInline).toHaveBeenCalledOnce()
        expect(navigate).not.toHaveBeenCalled()
    })

    it('preserves the expert Library fallback outside Guided', () => {
        const navigate = vi.fn()

        openLibraryToolsSurface(undefined, navigate)

        expect(navigate).toHaveBeenCalledOnce()
        expect(navigate).toHaveBeenCalledWith('/tools')
    })

    it('renders My Work queue activity with only the injected Guided destination', () => {
        const html = renderToStaticMarkup(createElement(
            MemoryRouter,
            { initialEntries: ['/guided-preview'] },
            createElement(QueueActivityLinkView, {
                summary: { processing: 1, waiting: 2, needsAttention: 0 },
                testId: 'guided-queue',
                to: '/guided-preview/task/batch/queue',
            }),
        ))

        expect(html).toContain('href="/guided-preview/task/batch/queue"')
        expect(html).not.toContain('href="/queue"')
    })
})
