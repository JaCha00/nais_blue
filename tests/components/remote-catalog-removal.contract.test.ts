import { access, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')
const exists = async (path: string) => {
    try {
        await access(resolve(process.cwd(), path))
        return true
    } catch {
        return false
    }
}

const removedCatalogName = ['Market', 'place'].join('')
const removedCatalogPath = `/${removedCatalogName.toLowerCase()}`
const removedAuthStore = ['market', 'auth', 'store'].join('-')
const removedBackendClient = ['supa', 'base'].join('')

describe('removed remote catalog runtime contract', () => {
    it('keeps its pages, component tree, auth store and backend client out of runtime source', async () => {
        const removedCandidates = [
            `src/pages/${removedCatalogName}.tsx`,
            `src/pages/${removedCatalogName}Detail.tsx`,
            `src/stores/${removedAuthStore}.ts`,
            `src/lib/${removedBackendClient}.ts`,
        ]

        await expect(Promise.all(removedCandidates.map(exists))).resolves.toEqual(
            removedCandidates.map(() => false),
        )

        const removedComponentDirectory = `src/components/${removedCatalogName.toLowerCase()}`
        const componentEntries = await exists(removedComponentDirectory)
            ? await readdir(resolve(process.cwd(), removedComponentDirectory))
            : []
        expect(componentEntries).toEqual([])
    })

    it('does not register the removed destination and has no startup auth/backend initialization', async () => {
        const app = await source('src/App.tsx')
        const lowerApp = app.toLowerCase()

        expect(lowerApp).not.toContain(`path="${removedCatalogPath}`)
        expect(lowerApp).not.toContain(removedAuthStore)
        expect(lowerApp).not.toContain(removedBackendClient)
        expect(lowerApp).not.toContain(`use${removedCatalogName.toLowerCase()}`)

        const layout = await source('src/components/layout/ThreeColumnLayout.tsx')
        expect(layout.toLowerCase()).not.toContain(`path: '${removedCatalogPath}'`)
        expect(layout.toLowerCase()).not.toContain(`href="${removedCatalogPath}`)
    })

    it('preserves local Scene JSON import and image/JSON export paths', async () => {
        const scene = await source('src/pages/SceneMode.tsx')

        expect(scene).toContain('const handleFileInputChange')
        expect(scene).toContain('accept=".json"')
        expect(scene).toContain('importPreset(json)')
        expect(scene).toContain("import { ExportDialog } from '@/components/scene/ExportDialog'")
        expect(scene).toContain('JSON.stringify(exportData, null, 2)')
        expect(scene).toContain('await writeFile(filePath, encoder.encode(content))')
        expect(scene).toContain('<ExportDialog')
    })

    it('preserves local Fragment text/JSON import, export and editor save paths', async () => {
        const fragment = await source('src/components/fragments/FragmentPromptDialog.tsx')

        expect(fragment).toContain('const handleImportTxt = async () =>')
        expect(fragment).toContain('const handleExportTxt = async () =>')
        expect(fragment).toContain('const handleImportAll = async () =>')
        expect(fragment).toContain('const handleExportAll = async () =>')
        expect(fragment).toContain('await importFromText(fileName, content')
        expect(fragment).toContain('await exportToText(selectedFileId)')
        expect(fragment).toContain('await importAll(data)')
        expect(fragment).toContain('await exportAll()')
        expect(fragment).toContain('<AutocompleteTextarea')
        expect(fragment).toContain('await updateFile(selectedFileId, {')
    })

    it('keeps project-local Codex tooling untracked and outside release inputs', async () => {
        const gate = await source('scripts/verify-remote-runtime-removal.mjs')
        const gitignore = await source('.gitignore')
        const vite = await source('vite.config.ts')
        const publicRelease = await source('scripts/create-public-release.ps1')

        expect(gate).toContain('trackedCodexToolingFiles')
        expect(gate).toContain("relativePath.startsWith('.codex/')")
        expect(gate).toContain('readTrackedFileFromIndex')
        expect(gate).toContain('repositoryFiles.tracked.has(relativePath)')
        expect(gate).toContain('repositoryRootIsNotPublicInput')
        expect(gate).toContain('publicSourceExcludesCodexTooling')
        expect(gitignore.split(/\r?\n/)).toContain('.codex/')
        expect(vite).not.toMatch(/publicDir\s*:\s*['"](?:\.|\.\/)['"]/i)
        expect(publicRelease).toMatch(/['"]\.codex['"]/i)
    })
})
