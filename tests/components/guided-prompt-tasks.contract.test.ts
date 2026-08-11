import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import ja from '@/i18n/locales/ja.json'
import ko from '@/i18n/locales/ko.json'

const source = async () => (await Promise.all([
    'src/presentation/workflow/GuidedPromptTasks.tsx',
    'src/presentation/workflow/GuidedAgentPromptComposer.tsx',
].map(path => readFile(resolve(process.cwd(), path), 'utf8')))).join('\n')

const leafKeys = (value: unknown, prefix = ''): string[] => Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key
        return child && typeof child === 'object' ? leafKeys(child, path) : [path]
    })
    .sort()

const lookup = (value: unknown, path: string): unknown => path
    .split('.')
    .reduce<unknown>((current, key) => (current as Record<string, unknown>)?.[key], value)

const placeholders = (value: string): string[] => [...value.matchAll(/{{\s*([^}\s]+)\s*}}/g)]
    .map(match => match[1])
    .sort()

describe('Guided C native task contract', () => {
    it('keeps all three prompt tasks inside Guided', async () => {
        const component = await source()

        expect(component).toContain("export type GuidedPromptTaskId = 'direct' | 'styleLab' | 'localAgent'")
        expect(component).toContain('guided-prompt-task-direct')
        expect(component).toContain('guided-prompt-task-styleLab')
        expect(component).toContain('guided-prompt-task-localAgent')
        expect(component).not.toContain("navigate('/advanced")
        expect(component).not.toContain("navigate('/style-lab")
        expect(component).not.toContain("navigate('/data")
    })

    it('provides a controlled four-slot editor, real tag checks, save, and an A draft', async () => {
        const component = await source()

        for (const slot of ['base', 'additional', 'detail', 'negative']) {
            expect(component).toContain(`${slot}:`)
        }
        expect(component).toContain('<PromptSlotTabs')
        expect(component).toContain('<PromptModulePicker')
        expect(component).toContain('verifyPromptTagsWithDanbooru(values[slot])')
        expect(component).toContain('saveWorkingCopyAs(name)')
        expect(component).toContain('createSingleImageDraft({')
        expect(component).toContain('currentNodeId: \'review\'')
        expect(component).toContain('navigate(`/guided-preview/work/${prepared.id}/review`)')
    })

    it('runs the complete Style comparison and local Agent controls without page handoff', async () => {
        const component = await source()

        expect(component).toContain('state.generateRandomCombinations(count)')
        expect(component).toContain('startGuidedStyleComparison({')
        expect(component).toContain('requestPreviews: requestStyleLabPreviewRenders')
        expect(component).toContain('recordGuidedStyleDecision({')
        expect(component).toContain('generation.setAdditionalPrompt(compactPrompt(')
        expect(component).toContain('subscribeAgentWorkspaceBridge')
        expect(component).toContain('refreshAgentWorkspaceSnapshot(true)')
        expect(component).toContain('openNativePath(status.workspacePath')
    })

    it('keeps Style preview settings, exact cost consent, and duplicate-click guards inside Guided', async () => {
        const component = await source()

        expect(component).toContain('GUIDED_STYLE_MODELS.map')
        expect(component).toContain('GUIDED_STYLE_RESOLUTIONS.map')
        expect(component).toContain('setGenerationSteps(next)')
        expect(component).toContain('setSampler(event.target.value)')
        expect(component).toContain('const estimatedAnlas = calculateAnlasCost({')
        expect(component).toContain('imageCount: 1')
        expect(component).toContain('}) * 2')
        expect(component).toContain('createAnlasCostConsentSnapshot({')
        expect(component).toContain('costConsent,')
        expect(component).toContain('disabled={!costConsented || activeTokenCount === 0')
        expect(component).toContain('if (previewInFlightRef.current || busy || !costConsented')
        expect(component).toContain('previewInFlightRef.current = true')
        expect(component).toContain('previewInFlightRef.current = false')
    })

    it('localizes every prompt-task key with matching leaves and placeholders', async () => {
        const component = await source()
        const usedKeys = [...new Set(component.match(/guided\.promptTasks\.[A-Za-z0-9_.]+/g) ?? [])]
            .map(key => key.replace('guided.promptTasks.', ''))
            .sort()
        const locales = { en, ja, ko } as const
        const canonicalLeaves = leafKeys(en.guided.promptTasks)

        expect(leafKeys(ja.guided.promptTasks)).toEqual(canonicalLeaves)
        expect(leafKeys(ko.guided.promptTasks)).toEqual(canonicalLeaves)
        expect(usedKeys).toEqual(canonicalLeaves)

        for (const key of usedKeys) {
            const canonical = lookup(en.guided.promptTasks, key)
            expect(canonical, `en is missing ${key}`).toBeTypeOf('string')

            for (const [locale, messages] of Object.entries(locales)) {
                const translated = lookup(messages.guided.promptTasks, key)
                expect(translated, `${locale} is missing ${key}`).toBeTypeOf('string')
                expect((translated as string).trim(), `${locale}.${key} is empty`).not.toHaveLength(0)
                expect(placeholders(translated as string), `${locale}.${key} placeholders differ`)
                    .toEqual(placeholders(canonical as string))
            }
        }
    })
})
