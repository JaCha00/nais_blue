import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')
const exists = (path) => existsSync(join(root, path))

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail })
}

const snapshotPath = 'src/lib/store-snapshots.ts'
const dialogPath = 'src/components/backup/StoreSnapshotRestoreDialog.tsx'

check('store snapshot helper exists', exists(snapshotPath))
check('store snapshot restore dialog exists', exists(dialogPath))

const snapshots = exists(snapshotPath) ? read(snapshotPath) : ''
const dialog = exists(dialogPath) ? read(dialogPath) : ''
const indexedDb = read('src/lib/indexed-db.ts')
const main = read('src/main.tsx')
const settings = read('src/pages/Settings.tsx')

check('BACKUP_STORE_KEYS is exported', /export const BACKUP_STORE_KEYS/.test(indexedDb))
check('BACKUP_STORE_KEYS includes prompt library', /BACKUP_STORE_KEYS[\s\S]*'nais2-prompt-library'/.test(indexedDb))
check('BACKUP_STORE_KEYS includes character rotation', /BACKUP_STORE_KEYS[\s\S]*'nais2-character-rotation'/.test(indexedDb))
check('exportAllData uses the full backup registry', /exportAllData[\s\S]*exportBackupFromStorage/.test(indexedDb) && /options\.storeKeys \?\? FULL_BACKUP_STORE_KEYS/.test(indexedDb))
check('getStoreSizes uses the full backup registry', /getStoreSizes[\s\S]*for\s*\(\s*const key of FULL_BACKUP_STORE_KEYS\s*\)/.test(indexedDb))

check('store snapshot scheduler exports start function', /export function startStoreSnapshotScheduler/.test(snapshots))
check('store snapshot scheduler is Tauri guarded', /isTauri\(\)/.test(snapshots))
check('store snapshots use the media root NAIS_Backup', /MEDIA_STORAGE_BASE_DIRECTORY/.test(snapshots) && /NAIS_Backup/.test(snapshots))
check('store snapshots are debounced 5s', /DEBOUNCE_MS\s*=\s*5000/.test(snapshots))
check('store snapshots keep max 30 per store', /MAX_SNAPSHOTS_PER_STORE\s*=\s*30/.test(snapshots))
check('store snapshots subscribe to IndexedDB writes', /registerIndexedDBWriteListener/.test(snapshots))
check('store snapshots use shared store key registry', /BACKUP_STORE_KEYS/.test(snapshots))
check('store snapshots write importAllData-compatible envelope', /_exportedAt/.test(snapshots) && /_version/.test(snapshots) && /\[storeKey\]/.test(snapshots))
check('store snapshot restore uses importAllData', /importAllData/.test(snapshots) && /restoreStoreSnapshot/.test(snapshots))

const flushIndex = snapshots.indexOf('await flushAllPendingWrites()')
const readIndex = snapshots.indexOf('indexedDBStorage.getItem(storeKey)')
check(
  'store snapshots flush pending writes before reading IndexedDB',
  flushIndex >= 0 && readIndex >= 0 && flushIndex < readIndex,
  `flushIndex=${flushIndex}, readIndex=${readIndex}`,
)

const mainCallIndex = main.indexOf('startStoreSnapshotScheduler()')
const postRenderIndex = main.indexOf('function runPostRenderStartupTasks()')
const scheduleIndex = main.indexOf('function schedulePostRenderStartupTasks()')
check(
  'main imports store snapshot scheduler',
  /import \{ startStoreSnapshotScheduler \} from '\.\/lib\/store-snapshots'/.test(main)
    || /import\('\.\/lib\/store-snapshots'\)/.test(main),
)
check(
  'main starts scheduler only inside runPostRenderStartupTasks',
  mainCallIndex > postRenderIndex && mainCallIndex < scheduleIndex && (main.match(/startStoreSnapshotScheduler\(\)/g) || []).length === 1,
)

check('Settings imports store snapshot restore dialog', /StoreSnapshotRestoreDialog/.test(settings))
check('Settings tracks store snapshot dialog state', /storeSnapshotRestoreDialogOpen/.test(settings))
check('Settings has button to open store snapshot dialog', /setStoreSnapshotRestoreDialogOpen\(true\)/.test(settings))
check('Settings renders store snapshot restore dialog', /<StoreSnapshotRestoreDialog/.test(settings))
check('dialog lists store snapshot groups', /listStoreSnapshots/.test(dialog))
check('dialog restores selected store snapshot', /restoreStoreSnapshot/.test(dialog))
check('dialog restarts or reloads after restore', /relaunch/.test(dialog) && /window\.location\.reload/.test(dialog))

for (const locale of ['en', 'ja', 'ko']) {
  const body = read(`src/i18n/locales/${locale}.json`)
  check(`${locale} store snapshot locale exists`, /storeSnapshotTitle/.test(body) && /restoreStoreSnapshots/.test(body))
}

const failed = checks.filter((entry) => !entry.pass)
for (const entry of checks) {
  console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.detail ? ` - ${entry.detail}` : ''}`)
}

if (failed.length > 0) {
  console.error(`\nStore snapshot phase verification failed: ${failed.length} check(s).`)
  process.exit(1)
}

console.log(`\nStore snapshot phase verification passed: ${checks.length} checks.`)
