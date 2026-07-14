import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Backup restore UI contract', () => {
    it.each([
        {
            path: 'src/components/backup/RestoreDialog.tsx',
            restoreCall: 'restoreFullAutoBackup\\(selectedRelPath\\)',
        },
        {
            path: 'src/components/backup/StoreSnapshotRestoreDialog.tsx',
            restoreCall: 'restoreStoreSnapshot\\(selectedGroup\\.storeKey, selectedRelPath\\)',
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
})
