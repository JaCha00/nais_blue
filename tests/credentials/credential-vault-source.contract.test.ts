import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

async function source(relativePath: string): Promise<string> {
    return readFile(path.join(root, relativePath), 'utf8')
}

describe('native credential vault source contract', () => {
    it('registers the official Stronghold plugin with desktop and mobile minimum capabilities', async () => {
        const [cargo, rust, desktop, mobile, packageJson] = await Promise.all([
            source('src-tauri/Cargo.toml'),
            source('src-tauri/src/lib.rs'),
            source('src-tauri/capabilities/default.json'),
            source('src-tauri/capabilities/mobile.json'),
            source('package.json'),
        ])

        expect(cargo).toContain('tauri-plugin-stronghold')
        expect(rust).toContain('create_dir_all(&credential_vault_data_dir)')
        expect(rust).toContain('create_dir_all(&credential_vault_local_data_dir)')
        expect(rust).toContain('tauri_plugin_stronghold::Builder::with_argon2')
        expect(packageJson).toContain('@tauri-apps/plugin-stronghold')
        for (const capability of [desktop, mobile]) {
            expect(capability).toContain('stronghold:allow-initialize')
            expect(capability).toContain('stronghold:allow-create-client')
            expect(capability).toContain('stronghold:allow-load-client')
            expect(capability).toContain('stronghold:allow-get-store-record')
            expect(capability).toContain('stronghold:allow-save-store-record')
            expect(capability).toContain('stronghold:allow-remove-store-record')
            expect(capability).toContain('stronghold:allow-save')
            expect(capability).toContain('stronghold:allow-destroy')
            expect(capability).not.toContain('stronghold:default')
        }
    })

    it('has no Base64, localStorage, or plaintext fallback in the credential backend', async () => {
        const backend = await source('src/services/credentials/stronghold-credential-vault.ts')
        expect(backend).not.toMatch(/btoa\s*\(|atob\s*\(|Base64|base64/i)
        expect(backend).not.toMatch(/localStorage|indexedDBStorage|setIndexedDBItemStrict/)
        expect(backend).not.toMatch(/fallback/i)
        expect(backend).toContain("from '@tauri-apps/plugin-stronghold'")
    })

    it('keeps raw token reveal out of the vault dialog and exposes privacy/destructive-cleanup warnings', async () => {
        const dialog = await source('src/components/credentials/CredentialVaultDialog.tsx')
        expect(dialog).toContain('credentialVault.legacyBackupWarning')
        expect(dialog).toContain('credentialVault.cleanupConfirmation')
        expect(dialog).toContain('lastFour')
        expect(dialog).not.toMatch(/showToken|revealToken|currentToken/)
        expect(dialog).not.toMatch(/type=["']text["'][^>]*(?:token|secret)/i)
    })

    it('keeps AuthState session plaintext out of Zustand persistence and requests unlock from generation callers', async () => {
        const [authStore, mainGeneration, sceneGeneration, styleLab, startup] = await Promise.all([
            source('src/stores/auth-store.ts'),
            source('src/stores/generation-store.ts'),
            source('src/hooks/useSceneGeneration.ts'),
            source('src/services/style-lab-generation.ts'),
            source('src/main.tsx'),
        ])
        expect(authStore).not.toMatch(/createJSONStorage|partialize\s*:|persist\s*\(/)
        expect(startup).toContain('initializeAuthCredentialState')
        for (const caller of [mainGeneration, sceneGeneration, styleLab]) {
            expect(caller).toContain('requestCredentialUnlock')
        }
    })

    it('awaits vault readiness before History enters source edit and routes every relaunch through cleanup', async () => {
        const [authStore, history, persistence, relaunchLifecycle, settings, updateStore, restore, storeRestore] = await Promise.all([
            source('src/stores/auth-store.ts'),
            source('src/components/layout/HistoryPanel.tsx'),
            source('src/lib/indexed-db.ts'),
            source('src/lib/app-relaunch.ts'),
            source('src/pages/Settings.tsx'),
            source('src/stores/update-store.ts'),
            source('src/components/backup/RestoreDialog.tsx'),
            source('src/components/backup/StoreSnapshotRestoreDialog.tsx'),
        ])

        expect(authStore).toContain('waitForCredentialVaultReady')
        expect(history).toContain('await waitForCredentialVaultReady()')
        expect(history).toContain('sourceEditPreparing')
        expect(persistence).toContain('getRuntimeCredentialVault().lock()')
        expect(relaunchLifecycle).toContain('closeApplicationWithFlush')
        expect(relaunchLifecycle).toContain('relaunch')
        for (const caller of [settings, updateStore, restore, storeRestore]) {
            expect(caller).toContain("@/lib/app-relaunch")
            expect(caller).not.toContain("from '@tauri-apps/plugin-process'")
        }
    })
})
