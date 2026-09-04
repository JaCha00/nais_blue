import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (relativePath: string) => readFile(path.join(root, relativePath), 'utf8')

describe('native NovelAI credential contract', () => {
    it('persists only secret-free references while keeping the existing token-entry UX', async () => {
        const [authStore, adapter, nativeVault, tauriLib, app, dialog, settingsCard, guidedGate, startup] = await Promise.all([
            source('src/stores/auth-store.ts'),
            source('src/services/credentials/native-novelai-credential-vault.ts'),
            source('src-tauri/src/novelai_credentials.rs'),
            source('src-tauri/src/lib.rs'),
            source('src/App.tsx'),
            source('src/components/credentials/ApiTokenDialog.tsx'),
            source('src/components/credentials/ApiTokenSettingsCard.tsx'),
            source('src/presentation/workflow/GuidedCredentialGate.tsx'),
            source('src/main.tsx'),
        ])

        expect(authStore).toContain('getRuntimeCredentialVault')
        expect(authStore).toContain('persistAuthStateV3')
        expect(authStore).toContain('completeLegacyAuthMigration')
        expect(authStore).not.toContain('serializeLocalAuth')
        expect(authStore).not.toContain('version: 4')
        expect(adapter).toContain('browserSecrets = new Map')
        expect(adapter).toContain('runtimeCapabilities.novelAiCredentialVault.supported')
        expect(adapter).not.toMatch(/localStorage|indexedDB/i)
        expect(nativeVault).toContain('blue.bluehair.naiblue.novelai')
        expect(nativeVault).toContain('keyring::Entry')
        expect(nativeVault).not.toMatch(/println!|dbg!|tracing::/)
        for (const command of [
            'novelai_store_credential',
            'novelai_load_credential',
            'novelai_credential_status',
            'novelai_delete_credential',
        ]) {
            expect(tauriLib).toContain(`novelai_credentials::${command}`)
        }
        expect(authStore).not.toContain('unlockVault')
        expect(dialog).not.toMatch(/passphrase|unlockVault|vaultStatus/i)
        expect(dialog).toContain('sessionStorageDescription')
        expect(settingsCard).toContain('sessionStorageDescription')
        expect(guidedGate).toContain('runtimeCapabilities.novelAiCredentialVault.supported')
        expect(guidedGate).toContain('guided.credential.descriptionSession')
        expect(guidedGate).toContain('guided.credential.descriptionDesktop')
        expect(app).toContain('<ApiTokenDialog />')
        expect(startup).toContain('Loading secure API credentials')
    })

    it('routes missing-token callers to the same direct token entry and keeps relaunch flushes', async () => {
        const [mainGeneration, sceneGeneration, styleLab, history, persistence, relaunchLifecycle] = await Promise.all([
            source('src/services/generation/generation-runtime-store.ts'),
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

    it('localizes desktop persistence and session-only guided disclosures separately', async () => {
        const locales = await Promise.all([
            source('src/i18n/locales/ko.json'),
            source('src/i18n/locales/en.json'),
            source('src/i18n/locales/ja.json'),
        ])
        for (const locale of locales) {
            expect(locale).toContain('"descriptionDesktop"')
            expect(locale).toContain('"descriptionSession"')
            expect(locale).toContain('"sessionStorageDescription"')
        }
    })
})
