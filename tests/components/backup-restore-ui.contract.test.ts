import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Backup restore UI contract', () => {
    it.each([
        'src/pages/Settings.tsx',
        'src/components/backup/RestoreDialog.tsx',
        'src/components/backup/StoreSnapshotRestoreDialog.tsx',
    ])('uses an in-app confirmation that is visible in Android WebView in %s', async (path) => {
        const restoreUi = await source(path)

        expect(restoreUi).toContain('<ConfirmDialog')
        expect(restoreUi).not.toContain('window.confirm')
        expect(restoreUi).toContain("t('settingsPage.backup.confirmRestoreDesc')")
    })

    it.each([
        {
            path: 'src/components/backup/RestoreDialog.tsx',
            restoreCall: 'restoreFullAutoBackup\\(pendingRestore\\.relPath\\)',
        },
        {
            path: 'src/components/backup/StoreSnapshotRestoreDialog.tsx',
            restoreCall: 'restoreStoreSnapshot\\(pendingRestore\\.storeKey, pendingRestore\\.relPath\\)',
        },
    ])('restarts immediately after a verified restore in $path', async ({ path, restoreCall }) => {
        const restoreDialog = await source(path)

        expect(restoreDialog).toMatch(
            new RegExp(
                `const result = await ${restoreCall}[\\s\\S]*?if \\(result\\.failed\\.length > 0\\)[\\s\\S]*?await restartAfterRestore\\(\\)`,
            ),
        )
        expect(restoreDialog).toContain(
            '<Dialog open={open} onOpenChange={(nextOpen) => !restoring && onOpenChange(nextOpen)}>',
        )
        expect(restoreDialog).toContain('onClick={() => onOpenChange(false)} disabled={restoring}')
        expect(restoreDialog).not.toContain('pendingRestart')
        expect(restoreDialog).not.toContain('setPendingRestart')
        expect(restoreDialog).toContain('settingsPage.backup.credentialReentryRequired')
    })

    it('reads Android document-picker files through the WebView File API', async () => {
        const settings = await source('src/pages/Settings.tsx')

        expect(settings).toContain('if (isMobileRuntime)')
        expect(settings).toContain('backupFileInputRef.current?.click()')
        expect(settings).toContain('prepareImportedBackup(await file.text())')
        expect(settings).toContain('const content = await readTextFile(filePath)')
    })
})
