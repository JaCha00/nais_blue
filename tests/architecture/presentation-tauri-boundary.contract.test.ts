import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface TauriImportBaselineEntry {
    file: string
    modules: string[]
}

const PRESENTATION_ROOTS = ['src/components', 'src/hooks', 'src/pages', 'src/stores']
const TAURI_IMPORT = /(?:from\s*|import\(\s*)['"](@tauri-apps\/[^'"]+)['"]/g

async function sourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(resolve(process.cwd(), directory), { withFileTypes: true })
    const nested = await Promise.all(entries.map(async entry => {
        const path = `${directory}/${entry.name}`
        if (entry.isDirectory()) return sourceFiles(path)
        return /\.tsx?$/.test(entry.name) ? [path] : []
    }))
    return nested.flat()
}

async function observedImports(): Promise<TauriImportBaselineEntry[]> {
    const files = await Promise.all(PRESENTATION_ROOTS.map(sourceFiles)).then(groups => groups.flat())
    const entries = await Promise.all(files.map(async file => {
        const source = await readFile(resolve(process.cwd(), file), 'utf8')
        const modules = [...source.matchAll(TAURI_IMPORT)].map(match => match[1]).sort()
        return { file, modules: [...new Set(modules)] }
    }))
    return entries.filter(entry => entry.modules.length > 0).sort((left, right) => left.file.localeCompare(right.file))
}

describe('Presentation Tauri import baseline', () => {
    it('allows the transitional dependency set to shrink but never drift silently', async () => {
        const baseline = JSON.parse(await readFile(
            resolve(process.cwd(), '.dependency-cruiser-presentation-tauri-baseline.json'),
            'utf8',
        )) as TauriImportBaselineEntry[]

        // Removing an adapter debt requires deleting its baseline entry in the
        // same change; adding a file or package fails before it can become debt.
        expect(await observedImports()).toEqual(baseline)
    })

    it('keeps native shell opener imports out of presentation', async () => {
        const modules = (await observedImports()).flatMap(entry => entry.modules)

        expect(modules).not.toContain('@tauri-apps/plugin-opener')
    })
})
