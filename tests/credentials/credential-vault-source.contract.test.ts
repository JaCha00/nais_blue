import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (relativePath: string) => readFile(path.join(root, relativePath), 'utf8')

describe('direct local NovelAI token contract', () => {
    it('loads tokens from local app storage without a vault or passphrase session', async () => {
        const [authStore, app, dialog, startup] = await Promise.all([
            source('src/stores/auth-store.ts'),
            source('src/App.tsx'),
            source('src/components/credentials/ApiTokenDialog.tsx'),
            source('src/main.tsx'),
        ])

        expect(authStore).toContain('getRuntimeAuthMigrationStorage().setStrict')
        expect(authStore).toContain('version: 4')
        expect(authStore).not.toContain('getRuntimeCredentialVault')
        expect(authStore).not.toContain('unlockVault')
        expect(dialog).not.toMatch(/passphrase|unlockVault|vaultStatus/i)
        expect(app).toContain('<ApiTokenDialog />')
        expect(startup).toContain('Loading local API tokens')
    })

    it('routes missing-token callers to direct token entry and keeps relaunch flushes', async () => {
        const [mainGeneration, sceneGeneration, styleLab, history, persistence, relaunchLifecycle] = await Promise.all([
            source('src/stores/generation-store.ts'),
            source('src/hooks/useSceneGeneration.ts'),
            source('src/services/style-lab-generation.ts'),
            source('src/components/layout/HistoryPanel.tsx'),
            source('src/lib/indexed-db.ts'),
            source('src/lib/app-relaunch.ts'),
        ])
        for (const caller of [mainGeneration, sceneGeneration, styleLab]) {
            expect(caller).toContain('requestTokenEntry')
        }
        expect(history).toContain('await waitForApiTokenReady()')
        expect(persistence).not.toContain('getRuntimeCredentialVault().lock()')
        expect(relaunchLifecycle).toContain('closeApplicationWithFlush')
    })
})
