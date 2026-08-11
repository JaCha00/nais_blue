import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback ?? _key,
    }),
}))

vi.mock('@/components/ui/dialog', async () => {
    const react = await import('react')
    const Passthrough = ({ children }: { children?: ReactNode }) => (
        react.createElement(react.Fragment, null, children)
    )
    return {
        Dialog: Passthrough,
        DialogContent: Passthrough,
        DialogDescription: Passthrough,
        DialogHeader: Passthrough,
        DialogTitle: Passthrough,
        DialogTrigger: Passthrough,
    }
})

vi.mock('@/stores/fragment-store', () => {
    const state = {
        files: [],
        loadFileContent: async () => [] as string[],
    }
    return {
        getFragmentCanonicalPath: () => '',
        useFragmentStore: (selector: (current: typeof state) => unknown) => selector(state),
    }
})

import { PromptModulePicker } from '@/components/fragments/PromptModulePicker'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

function renderPicker(showManageAction: boolean): string {
    return renderToStaticMarkup(createElement(
        MemoryRouter,
        null,
        createElement(PromptModulePicker, {
            onSelectLine: () => undefined,
            showManageAction,
        }),
    ))
}

describe('Guided prompt-module handoff boundary', () => {
    it('opts every Guided picker out of the Advanced manage action', async () => {
        const callers = [
            ['src/presentation/workflow/GuidedSingleImage.tsx', 2],
            ['src/presentation/workflow/GuidedBatchImages.tsx', 2],
            ['src/presentation/workflow/GuidedPromptTasks.tsx', 1],
        ] as const

        for (const [path, expectedCount] of callers) {
            const component = await source(path)
            const pickers = component.match(/<PromptModulePicker\b[\s\S]*?\/>/g) ?? []

            expect(pickers, path).toHaveLength(expectedCount)
            for (const picker of pickers) {
                expect(picker, path).toContain('showManageAction={false}')
            }
        }
    })

    it('does not render the Advanced manage link when the action is hidden', () => {
        expect(renderPicker(false)).not.toContain('/advanced?guided=fragments')
        expect(renderPicker(true)).toContain('href="/advanced?guided=fragments"')
    })
})
