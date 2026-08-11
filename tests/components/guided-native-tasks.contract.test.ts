import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import ja from '@/i18n/locales/ja.json'
import ko from '@/i18n/locales/ko.json'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function leafKeys(value: unknown, prefix = ''): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
    return Object.entries(value as Record<string, unknown>)
        .flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
        .sort()
}

describe('Guided-native D/E task surfaces', () => {
    it('embeds every library task without handing the route to an expert workspace', () => {
        const task = source('src/presentation/workflow/GuidedLibraryTask.tsx')

        for (const id of ['library', 'history', 'tools', 'metadata', 'trash', 'r2']) {
            expect(task).toContain(`'${id}'`)
        }
        for (const surface of [
            '<GuidedLibraryWorkspace />',
            '<HistoryPanel guided />',
            '<ToolsMode guided />',
            '<MetadataWorkspace />',
            '<Trash />',
            '<R2Upload />',
        ]) {
            expect(task).toContain(surface)
        }
        expect(task).not.toMatch(/navigate\(|<Navigate|to=["']\//)
        expect(task).toContain('<Library onOpenTools={() => setToolsOpen(true)} />')
    })

    it('embeds every environment task as an immediately usable form or result surface', () => {
        const task = source('src/presentation/workflow/GuidedEnvironmentTask.tsx')

        for (const id of ['credentials', 'appearance', 'storage', 'shortcuts', 'backup', 'device', 'web', 'diagnostics']) {
            expect(task).toContain(`'${id}'`)
        }
        expect(task).toContain('<ApiTokenManager />')
        expect(task).toContain('<Settings guidedSection={section} />')
        expect(task).toContain('<DeviceConnectionPanel onOpenBackup={() => setShowBackup(true)} />')
        expect(task).toContain('<WebView />')
        expect(task).toContain('<GuidedDiagnosticsWorkspace />')
        expect(task).not.toMatch(/navigate\(|<Navigate|to=["']\//)
    })
})

describe('Guided reuse does not escape to Advanced mode', () => {
    it('turns a History selection into an inline result and hides expert-only actions', () => {
        const history = source('src/components/layout/HistoryPanel.tsx')
        const clickHandler = history.slice(
            history.indexOf('const handleImageClick'),
            history.indexOf('const requestDeleteImage'),
        )

        expect(clickHandler).toMatch(/if \(guided\) \{[\s\S]*setGuidedSelection[\s\S]*return[\s\S]*\}[\s\S]*navigate\('\/advanced'\)/)
        expect(history).toContain('{!guided && <QueueActivityLink />}')
        expect(history).toMatch(/!guided && \([\s\S]*onRegenerate[\s\S]*onOpenSmartTools[\s\S]*onI2I/)
        expect(history).toMatch(/const handleOpenSmartTools[\s\S]*if \(guided\) return[\s\S]*navigate\('\/tools'\)/)
        expect(history).toMatch(/const handleI2I[\s\S]*if \(guided\) return[\s\S]*navigate\('\/advanced'\)/)
        expect(history).toContain('data-guided-history={guided || undefined}')
    })

    it('keeps Tools results and source-edit dialogs inside Guided mode', () => {
        const tools = source('src/pages/ToolsMode.tsx')
        const i2i = source('src/components/tools/I2IDialog.tsx')

        expect(tools.match(/navigate\('\/advanced'\)/g)).toHaveLength(4)
        expect(tools).toContain("if (!guided) navigate('/advanced')")
        expect(tools).toMatch(/if \(guided\) \{\s*setIsI2IOpen\(true\)\s*return\s*\}[\s\S]*navigate\('\/advanced'\)/)
        expect(tools).toMatch(/if \(guided\) \{\s*setIsInpaintingOpen\(true\)\s*return\s*\}[\s\S]*navigate\('\/advanced'\)/)
        expect(tools).toContain("if (!guided && !open && useGenerationStore.getState().i2iMode === 'inpaint')")
        expect(tools).toContain('generateOnSave={guided}')
        expect(tools).toContain('navigateOnComplete={!guided}')
        expect(i2i).toContain("if (navigateOnComplete) navigate('/advanced')")
        const inpainting = source('src/components/tools/InpaintingDialog.tsx')
        expect(inpainting).toContain('if (generateOnSave)')
        expect(inpainting).toContain('await generate()')
        expect(inpainting).toContain('onGenerated?.(image)')
    })

    it('injects Guided destinations into Library, device fallback, and My Work queue actions', () => {
        const libraryTask = source('src/presentation/workflow/GuidedLibraryTask.tsx')
        const library = source('src/components/library/LibraryContextMenu.tsx')
        const device = source('src/pages/DataHub.tsx')
        const environmentTask = source('src/presentation/workflow/GuidedEnvironmentTask.tsx')
        const activity = source('src/presentation/activity/MyWorkActivity.tsx')
        const queueLink = source('src/components/layout/QueueActivityLink.tsx')

        expect(libraryTask).toContain('<Library onOpenTools={() => setToolsOpen(true)} />')
        expect(library).toContain('openLibraryToolsSurface(onOpenTools, navigate)')
        expect(environmentTask).toContain('<DeviceConnectionPanel onOpenBackup={() => setShowBackup(true)} />')
        expect(device).toContain("onClick={onOpenBackup ?? (() => navigate('/settings?section=backup'))}")
        expect(activity).toContain("queueTarget = '/queue'")
        expect(activity).toContain('to={queueTarget}')
        expect(source('src/presentation/workflow/GuidedShell.tsx')).toContain('queueTarget="/guided-preview/task/batch/queue"')
        expect(queueLink).toContain('to={to}')
        expect(environmentTask).not.toContain('openProductGuidance')
    })
})

describe('Guided-native destructive and credential boundaries', () => {
    it('requires verified R2 authority and confirms overwrites', () => {
        const r2 = source('src/components/r2/NativeR2SetupPanel.tsx')

        expect(r2).toMatch(/const connectionReady = nativeEnabled\s*&& credentialAvailable/)
        expect(r2).toMatch(/const uploadReady = connectionReady\s*&& connectionVerified\s*&& writeVerified/)
        expect(r2).toContain("profile.conflictPolicy === 'overwrite'")
        expect(r2).toContain('variant="destructive"')
        expect(r2).toContain('await startUpload()')
    })

    it('keeps token secrets local and deletion behind confirmation', () => {
        const credentials = source('src/components/credentials/ApiTokenDialog.tsx')

        expect(credentials).toContain('type="password"')
        expect(credentials).toContain('autoComplete="off"')
        expect(credentials).toContain("useState<Record<ApiSlot, string>>({ 1: '', 2: '' })")
        expect(credentials).toContain('auth.verifyAndSave(candidate, slot)')
        expect(credentials).toContain('auth.deleteCredential(deleteSlot)')
        expect(credentials).toContain('<ConfirmDialog')
    })
})

describe('Guided-native localization', () => {
    it('keeps user-facing Korean copy out of the task components', () => {
        const components = [
            source('src/presentation/workflow/GuidedLibraryTask.tsx'),
            source('src/presentation/workflow/GuidedEnvironmentTask.tsx'),
        ]

        for (const component of components) expect(component).not.toMatch(/[가-힣]/)
    })

    it('keeps native task copy and the shared start action aligned in every locale', () => {
        expect(leafKeys(ko.guided.workflows.native)).toEqual(leafKeys(en.guided.workflows.native))
        expect(leafKeys(ja.guided.workflows.native)).toEqual(leafKeys(en.guided.workflows.native))

        for (const locale of [ko, en, ja]) {
            expect(locale.guided.workflows.start.trim()).not.toHaveLength(0)
            expect(locale.guided.workflows.library.description.trim()).not.toHaveLength(0)
            expect(locale.guided.workflows.environment.description.trim()).not.toHaveLength(0)
        }
        expect(ko.guided.workflows.library.description).not.toMatch(/이동/)
        expect(ko.guided.workflows.environment.description).not.toMatch(/찾아갈/)
    })
})
