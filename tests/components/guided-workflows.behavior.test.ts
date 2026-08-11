import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import ko from '@/i18n/locales/ko.json'

vi.mock('react-i18next', async importOriginal => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => {
                const value = key.split('.').reduce<unknown>((current, segment) => (
                    current && typeof current === 'object'
                        ? (current as Record<string, unknown>)[segment]
                        : undefined
                ), ko)
                return typeof value === 'string' ? value : key
            },
        }),
    }
})

import {
    GUIDED_WORKFLOWS,
    GuidedWorkflowHub,
    type GuidedWorkflowId,
} from '@/presentation/workflow/GuidedWorkflowHub'

const expectedOptions = {
    batch: ['sameSettings', 'variations', 'scenes', 'queue'],
    prompt: ['localAgent', 'direct', 'styleLab'],
    library: ['library', 'history', 'tools', 'metadata', 'trash', 'r2'],
    environment: ['credentials', 'appearance', 'storage', 'shortcuts', 'backup', 'device', 'web', 'diagnostics'],
} as const satisfies Record<GuidedWorkflowId, readonly string[]>

function renderHub(workflowId: GuidedWorkflowId): string {
    return renderToStaticMarkup(createElement(
        MemoryRouter,
        { initialEntries: [`/guided-preview/guide/${workflowId}`] },
        createElement(
            Routes,
            null,
            createElement(Route, {
                path: '/guided-preview/guide/:workflowId',
                element: createElement(GuidedWorkflowHub),
            }),
        ),
    ))
}

describe('Guided B-E task routing behavior', () => {
    it('renders all 21 options as Guided-native task links', () => {
        let optionCount = 0

        for (const [workflowId, optionIds] of Object.entries(expectedOptions) as [GuidedWorkflowId, readonly string[]][]) {
            expect(GUIDED_WORKFLOWS[workflowId].options.map(option => option.id)).toEqual(optionIds)
            const html = renderHub(workflowId)
            const translations = ko.guided.workflows[workflowId].options as Record<string, {
                title: string
                description: string
            }>

            for (const optionId of optionIds) {
                optionCount += 1
                expect(html).toContain(`href="/guided-preview/task/${workflowId}/${optionId}"`)
                expect(html).toContain(translations[optionId].title)
                expect(html).toContain(translations[optionId].description)
            }

            expect(html).not.toMatch(/href="\/(?:advanced|style-lab|data|library|tools|trash|r2|settings|web)/)
        }

        expect(optionCount).toBe(21)
    })
})
