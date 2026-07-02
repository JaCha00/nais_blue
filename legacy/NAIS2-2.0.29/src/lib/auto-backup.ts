import { writeFile, mkdir, exists, readDir, remove, readFile, BaseDirectory } from '@tauri-apps/plugin-fs'

const BACKUP_ROOT = 'NAIS_Backup'
const DEBOUNCE_MS = 5000
const MAX_BACKUPS_PER_NAME = 30

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const inflight = new Map<string, boolean>()

interface PersistableStore {
    getState: () => unknown
    subscribe: (listener: (state: unknown, prev: unknown) => void) => () => void
    persist?: {
        getOptions: () => {
            name: string
            storage?: { setItem: (k: string, v: string) => unknown }
            partialize?: (s: unknown) => unknown
            version?: number
        }
    }
}

const storeRegistry = new Map<string, PersistableStore>()

function tsStamp(d = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
        d.getFullYear() +
        pad(d.getMonth() + 1) +
        pad(d.getDate()) +
        '-' +
        pad(d.getHours()) +
        pad(d.getMinutes()) +
        pad(d.getSeconds())
    )
}

async function ensureDir(rel: string): Promise<void> {
    if (!(await exists(rel, { baseDir: BaseDirectory.Picture }))) {
        await mkdir(rel, { baseDir: BaseDirectory.Picture, recursive: true })
    }
}

async function rotate(dirRel: string, prefix: string): Promise<void> {
    const entries = await readDir(dirRel, { baseDir: BaseDirectory.Picture })
    const matching = entries
        .filter((e) => e.name && e.name.startsWith(prefix + '_') && e.name.endsWith('.json'))
        .map((e) => e.name as string)
        .sort()
        .reverse()
    for (let i = MAX_BACKUPS_PER_NAME; i < matching.length; i++) {
        try {
            await remove(`${dirRel}/${matching[i]}`, { baseDir: BaseDirectory.Picture })
        } catch (e) {
            console.warn('[auto-backup] rotate remove failed', matching[i], e)
        }
    }
}

async function writeSnapshot(name: string, payload: unknown): Promise<void> {
    const dirRel = `${BACKUP_ROOT}/${name}`
    await ensureDir(BACKUP_ROOT)
    await ensureDir(dirRel)

    const json = JSON.stringify({
        _exportedAt: new Date().toISOString(),
        _version: 'auto-backup/1',
        _kind: name,
        [name]: payload,
    })

    const fileName = `${name}_${tsStamp()}.json`
    const encoder = new TextEncoder()
    await writeFile(`${dirRel}/${fileName}`, encoder.encode(json), {
        baseDir: BaseDirectory.Picture,
    })

    await rotate(dirRel, name)
    console.log(`[auto-backup] ${name} -> ${fileName} (${(json.length / 1024).toFixed(1)} KB)`)
}

export function scheduleBackup(name: string, getPayload: () => unknown): void {
    const existing = timers.get(name)
    if (existing) clearTimeout(existing)
    const t = setTimeout(async () => {
        timers.delete(name)
        if (inflight.get(name)) {
            scheduleBackup(name, getPayload)
            return
        }
        inflight.set(name, true)
        try {
            await writeSnapshot(name, getPayload())
        } catch (e) {
            console.error(`[auto-backup] ${name} failed`, e)
        } finally {
            inflight.set(name, false)
        }
    }, DEBOUNCE_MS)
    timers.set(name, t)
}

export async function flushBackup(name: string, getPayload: () => unknown): Promise<void> {
    const existing = timers.get(name)
    if (existing) {
        clearTimeout(existing)
        timers.delete(name)
    }
    try {
        await writeSnapshot(name, getPayload())
    } catch (e) {
        console.error(`[auto-backup] flush ${name} failed`, e)
    }
}

/**
 * Attach auto-backup to a zustand store with persist middleware.
 * Reads partialize from the store's persist options to mirror exactly what
 * the store would normally save. Debounced to 5s, rotated to last 30 snapshots.
 */
export function attachStoreBackup(store: PersistableStore, backupName: string): void {
    storeRegistry.set(backupName, store)

    const buildSnap = () => {
        const opts = store.persist?.getOptions()
        const full = store.getState()
        const partial = opts?.partialize ? opts.partialize(full) : full
        return { state: partial, version: opts?.version ?? 0 }
    }

    let lastSerialized = ''
    store.subscribe(() => {
        try {
            const snap = JSON.stringify(buildSnap())
            if (snap === lastSerialized) return
            lastSerialized = snap
            scheduleBackup(backupName, () => JSON.parse(snap))
        } catch (e) {
            console.warn(`[auto-backup] ${backupName} subscribe error`, e)
        }
    })

    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => {
            void flushBackup(backupName, buildSnap)
        })
    }
}

// ===== Listing & Restore APIs (used by RestoreDialog) =====

export interface BackupEntry {
    fileName: string
    relPath: string
    timestamp: string  // YYYYMMDD-HHMMSS extracted from filename
}

export interface BackupGroup {
    name: string                // 'scenes', 'generation', etc.
    storageKey: string          // 'nais2-scenes' etc. (from persist options)
    isRegistered: boolean       // store currently attached
    entries: BackupEntry[]      // newest-first
}

export async function listBackups(): Promise<BackupGroup[]> {
    if (!(await exists(BACKUP_ROOT, { baseDir: BaseDirectory.Picture }))) return []
    const dirs = await readDir(BACKUP_ROOT, { baseDir: BaseDirectory.Picture })

    const groups: BackupGroup[] = []
    for (const d of dirs) {
        if (!d.isDirectory || !d.name) continue
        const name = d.name
        const sub = `${BACKUP_ROOT}/${name}`
        let files: BackupEntry[] = []
        try {
            const fs = await readDir(sub, { baseDir: BaseDirectory.Picture })
            files = fs
                .filter((f) => f.name && f.name.startsWith(name + '_') && f.name.endsWith('.json'))
                .map((f) => ({
                    fileName: f.name as string,
                    relPath: `${sub}/${f.name as string}`,
                    timestamp: (f.name as string).slice(name.length + 1, -5),
                }))
                .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        } catch (e) {
            console.warn('[auto-backup] listBackups read failed for', name, e)
        }

        const reg = storeRegistry.get(name)
        const storageKey = reg?.persist?.getOptions().name ?? `nais2-${name}`
        groups.push({ name, storageKey, isRegistered: !!reg, entries: files })
    }
    return groups.sort((a, b) => a.name.localeCompare(b.name))
}

export async function restoreFromBackup(backupName: string, fileRelPath: string): Promise<void> {
    const store = storeRegistry.get(backupName)
    if (!store?.persist) throw new Error(`Store not registered for ${backupName}`)
    const opts = store.persist.getOptions()

    const bytes = await readFile(fileRelPath, { baseDir: BaseDirectory.Picture })
    const text = new TextDecoder().decode(bytes)
    const wrapped = JSON.parse(text)

    // Wrapper format: { _exportedAt, _version, _kind, [backupName]: { state, version } }
    const inner = wrapped[backupName] ?? wrapped
    if (!inner || !('state' in inner)) {
        throw new Error('Backup file missing "state" field')
    }
    const persistPayload = JSON.stringify({
        state: inner.state,
        version: inner.version ?? opts.version ?? 0,
    })

    if (opts.storage?.setItem) {
        await opts.storage.setItem(opts.name, persistPayload)
    } else {
        localStorage.setItem(opts.name, persistPayload)
    }
}
