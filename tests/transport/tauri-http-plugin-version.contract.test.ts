import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readText = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Tauri HTTP plugin body protocol contract', () => {
    it('pins matching JavaScript and Rust plugin versions', async () => {
        const [packageJsonText, packageLockText, cargoToml, cargoLock] = await Promise.all([
            readText('package.json'),
            readText('package-lock.json'),
            readText('src-tauri/Cargo.toml'),
            readText('src-tauri/Cargo.lock'),
        ])
        const packageJson = JSON.parse(packageJsonText) as {
            dependencies: Record<string, string>
        }
        const packageLock = JSON.parse(packageLockText) as {
            packages: Record<string, { version?: string }>
        }
        const javascriptManifestVersion = packageJson.dependencies['@tauri-apps/plugin-http']
        const javascriptLockVersion = packageLock.packages['node_modules/@tauri-apps/plugin-http']?.version
        const rustManifestVersion = cargoToml.match(/^tauri-plugin-http\s*=\s*"=([^"]+)"$/m)?.[1]
        const rustLockVersion = cargoLock.match(/\[\[package\]\]\s+name = "tauri-plugin-http"\s+version = "([^"]+)"/m)?.[1]

        expect(javascriptLockVersion).toMatch(/^\d+\.\d+\.\d+$/)
        expect(javascriptManifestVersion).toBe(javascriptLockVersion)
        expect(rustManifestVersion).toBe(javascriptLockVersion)
        expect(rustLockVersion).toBe(javascriptLockVersion)
    })
})
