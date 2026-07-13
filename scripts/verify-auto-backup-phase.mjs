import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (file) => readFileSync(join(root, file), 'utf8')

let failed = false
function check(name, condition) {
  if (condition) {
    console.log(`PASS ${name}`)
    return
  }
  failed = true
  console.error(`FAIL ${name}`)
}

const autoBackupPath = join(root, 'src/lib/auto-backup.ts')
const restoreDialogPath = join(root, 'src/components/backup/RestoreDialog.tsx')

check('auto-backup helper exists', existsSync(autoBackupPath))
check('restore dialog exists', existsSync(restoreDialogPath))

const autoBackup = existsSync(autoBackupPath) ? read('src/lib/auto-backup.ts') : ''
const restoreDialog = existsSync(restoreDialogPath) ? read('src/components/backup/RestoreDialog.tsx') : ''
const settings = read('src/pages/Settings.tsx')
const main = read('src/main.tsx')
const indexedDb = read('src/lib/indexed-db.ts')

check('auto-backup writes full B export snapshots', /exportAllData/.test(autoBackup) && /createFullAutoBackup/.test(autoBackup))
check('auto-backup restores through B import boundary', /importAllData/.test(autoBackup) && /restoreFullAutoBackup/.test(autoBackup))
check('auto-backup avoids A per-store attach hooks', !/attachStoreBackup|storeRegistry|persist\?\.getOptions/.test(autoBackup))
check('auto-backup is guarded outside Tauri browser runtime', /isTauri\(\)/.test(autoBackup))
check('auto-backup stores under the media root NAIS_Backup', /MEDIA_STORAGE_BASE_DIRECTORY/.test(autoBackup) && /NAIS_Backup/.test(autoBackup))
check('restore dialog lists and restores full snapshots', /listFullAutoBackups/.test(restoreDialog) && /restoreFullAutoBackup/.test(restoreDialog))
check('restore dialog restarts or reloads after restore', /relaunch/.test(restoreDialog) && /window\.location\.reload/.test(restoreDialog))
check('Settings exposes snapshot creation and restore UI', /createFullAutoBackup/.test(settings) && /RestoreDialog/.test(settings))
check('startup schedules disk auto-backup beside existing flow', /createFullAutoBackup/.test(main) && /Disk auto-backup/.test(main))
check('B localStorage startup backup remains preserved', /AUTO_BACKUP_KEY\s*=\s*'nais2-auto-backup'/.test(main) && /performAutoBackup/.test(main))
check('Prompt library remains in full export registry', /'nais2-prompt-library'/.test(indexedDb))

for (const locale of ['en', 'ja', 'ko']) {
  const body = read(`src/i18n/locales/${locale}.json`)
  check(`${locale} backup snapshot locale exists`, /autoSnapshotTitle/.test(body) && /restoreSnapshots/.test(body))
}

if (failed) {
  console.error('\nAuto-backup phase verification failed.')
  process.exit(1)
}

console.log('\nAuto-backup phase verification passed.')
