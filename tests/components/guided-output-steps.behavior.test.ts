import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { createSingleImageDraft } from '@/domain/workflow/single-image-draft'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback: string) => fallback,
    }),
}))

vi.mock('@/hooks/useDefaultR2Readiness', () => ({
    useDefaultR2Readiness: () => ({
        status: 'unavailable',
        reason: 'profile',
        profile: null,
    }),
}))

import { GuidedDeliveryStep } from '@/presentation/workflow/GuidedMetadataPolicy'

describe('Guided output workflow steps', () => {
    it('disables automatic R2 upload and offers setup when no profile is ready', () => {
        const draft = createSingleImageDraft({
            id: 'draft:r2-unavailable',
            now: '2026-08-13T00:00:00.000Z',
            seed: 42,
            output: { metadataMode: 'strip-and-sidecar' },
        })
        const html = renderToStaticMarkup(createElement(
            MemoryRouter,
            null,
            createElement(GuidedDeliveryStep, {
                value: draft.payload.output,
                disabled: false,
                onChange: vi.fn(),
            }),
        ))

        expect(html).toContain('R2 설정과 API 키가 준비되어야 선택할 수 있어요.')
        expect(html).toContain('href="/guided-preview/task/library/r2"')
        expect(html).toMatch(/role="checkbox"[^>]*disabled=""/)
    })
})
