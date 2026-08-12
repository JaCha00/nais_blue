import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

async function sourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(resolve(process.cwd(), directory), { withFileTypes: true })
    return (await Promise.all(entries.map(entry => {
        const path = `${directory}/${entry.name}`
        return entry.isDirectory()
            ? sourceFiles(path)
            : Promise.resolve(/\.tsx?$/.test(entry.name) ? [path] : [])
    }))).flat()
}

describe('external URL boundary', () => {
    it('keeps raw anchors out of app surfaces so installed builds use the opener adapter', async () => {
        const paths = (await Promise.all([
            sourceFiles('src/components'),
            sourceFiles('src/pages'),
            sourceFiles('src/presentation'),
        ])).flat()
        const rawAnchors = (await Promise.all(paths.map(async path => ({
            path,
            source: await readFile(resolve(process.cwd(), path), 'utf8'),
        })))).filter(item => /<a\b/u.test(item.source)).map(item => item.path)

        expect(rawAnchors).toEqual([])
    })

    it('routes the R2 and NovelAI guide controls through the shared external URL component', async () => {
        const [r2Setup, credentialGate] = await Promise.all([
            readFile(resolve(process.cwd(), 'src/components/r2/NativeR2SetupPanel.tsx'), 'utf8'),
            readFile(resolve(process.cwd(), 'src/presentation/workflow/GuidedCredentialGate.tsx'), 'utf8'),
        ])

        expect(r2Setup).toContain('<ExternalUrlLink')
        expect(credentialGate).toContain('<ExternalUrlLink')
    })
})
