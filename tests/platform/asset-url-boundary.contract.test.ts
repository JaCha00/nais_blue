import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIRECT_ASSET_PROTOCOL_IMPORT = /import\s*\{[^}]*\bconvertFileSrc\b[^}]*\}\s*from\s*['"]@tauri-apps\/api\/core['"]/s

async function sourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(resolve(process.cwd(), directory), { withFileTypes: true })
    const nested = await Promise.all(entries.map(async entry => {
        const path = `${directory}/${entry.name}`
        if (entry.isDirectory()) return sourceFiles(path)
        return /\.tsx?$/.test(entry.name) ? [path] : []
    }))
    return nested.flat()
}

describe('Native asset URL boundary', () => {
    it('keeps Tauri asset protocol conversion out of pages and components', async () => {
        const presentationFiles = await Promise.all([
            sourceFiles('src/components'),
            sourceFiles('src/pages'),
        ]).then(groups => groups.flat())
        const sources = await Promise.all(presentationFiles.map(async path => ({
            path,
            text: await readFile(resolve(process.cwd(), path), 'utf8'),
        })))

        expect(sources.filter(source => DIRECT_ASSET_PROTOCOL_IMPORT.test(source.text)).map(source => source.path)).toEqual([])
    })

    it('keeps the native protocol call behind the platform adapter', async () => {
        const adapter = await readFile(resolve(process.cwd(), 'src/platform/asset-url.ts'), 'utf8')

        expect(adapter).toContain("import { convertFileSrc } from '@tauri-apps/api/core'")
        expect(adapter).toContain('export function toNativeAssetUrl')
    })
})
