import { exists, mkdir, readDir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { exportAllData, flushAllPendingWrites, importAllData } from '@/lib/indexed-db'
import { MEDIA_STORAGE_BASE_DIRECTORY } from '@/platform/storage'

const BACKUP_ROOT = 'NAIS_Backup'
const FULL_BACKUP_DIR = `${BACKUP_ROOT}/full`
const FULL_BACKUP_PREFIX = 'nais2-full'
const MAX_FULL_BACKUPS = 10
export const DISK_AUTO_BACKUP_LAST_KEY = 'nais2-last-disk-auto-backup'

export interface FullAutoBackupEntry {
    fileName: string
    relPath: string
    timestamp: string
    exportedAt?: string
}

export type CreateFullAutoBackupResult =
    | { status: 'created'; entry: FullAutoBackupEntry; storeCount: number }
    | { status: 'skipped'; reason: 'not-tauri' | 'interval'; nextBackupAt?: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function tsStamp(d = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function formatAutoBackupTimestamp(timestamp: string): string {
    if (timestamp.length < 15) return timestamp
    return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)} ${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`
}

async function ensureBackupDir(): Promise<void> {
    if (!(await exists(BACKUP_ROOT, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY }))) {
        await mkdir(BACKUP_ROOT, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY, recursive: true })
    }
    if (!(await exists(FULL_BACKUP_DIR, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY }))) {
        await mkdir(FULL_BACKUP_DIR, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY, recursive: true })
    }
}

async function rotateFullBackups(): Promise<void> {
    const entries = await listFullAutoBackups()
    for (const entry of entries.slice(MAX_FULL_BACKUPS)) {
        try {
            await remove(entry.relPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
        } catch (error) {
            console.warn('[AutoBackup] Failed to remove old disk snapshot:', entry.fileName, error)
        }
    }
}

function parseBackupEntry(fileName: string): FullAutoBackupEntry | null {
    if (!fileName.startsWith(`${FULL_BACKUP_PREFIX}_`) || !fileName.endsWith('.json')) {
        return null
    }
    const timestamp = fileName.slice(FULL_BACKUP_PREFIX.length + 1, -5)
    return {
        fileName,
        relPath: `${FULL_BACKUP_DIR}/${fileName}`,
        timestamp,
    }
}

export async function listFullAutoBackups(): Promise<FullAutoBackupEntry[]> {
    if (!isTauri()) return []
    if (!(await exists(FULL_BACKUP_DIR, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY }))) return []

    const entries = await readDir(FULL_BACKUP_DIR, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
    return entries
        .map((entry) => entry.name ? parseBackupEntry(entry.name) : null)
        .filter((entry): entry is FullAutoBackupEntry => entry !== null)
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
}

interface CreateFullAutoBackupOptions {
    force?: boolean
    minIntervalMs?: number
}

export async function createFullAutoBackup(options: CreateFullAutoBackupOptions = {}): Promise<CreateFullAutoBackupResult> {
    if (!isTauri()) {
        return { status: 'skipped', reason: 'not-tauri' }
    }

    const now = Date.now()
    const minIntervalMs = options.minIntervalMs ?? 24 * 60 * 60 * 1000
    const lastBackup = Number(localStorage.getItem(DISK_AUTO_BACKUP_LAST_KEY) ?? 0)
    if (!options.force && Number.isFinite(lastBackup) && now - lastBackup < minIntervalMs) {
        return {
            status: 'skipped',
            reason: 'interval',
            nextBackupAt: new Date(lastBackup + minIntervalMs).toISOString(),
        }
    }

    await ensureBackupDir()

    // Phase 2 integration boundary: disk snapshots are full B exports, not A-style
    // per-store hooks, so restore semantics stay aligned with IndexedDB migrations.
    const backup = await exportAllData()
    const timestamp = tsStamp(new Date(now))
    const fileName = `${FULL_BACKUP_PREFIX}_${timestamp}.json`
    const relPath = `${FULL_BACKUP_DIR}/${fileName}`
    const json = JSON.stringify(backup, null, 2)

    await writeFile(relPath, encoder.encode(json), { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
    localStorage.setItem(DISK_AUTO_BACKUP_LAST_KEY, String(now))
    localStorage.setItem('nais2-last-disk-auto-backup-file', relPath)

    await rotateFullBackups()

    return {
        status: 'created',
        entry: {
            fileName,
            relPath,
            timestamp,
            exportedAt: typeof backup._exportedAt === 'string' ? backup._exportedAt : new Date(now).toISOString(),
        },
        storeCount: Object.keys(backup).filter((key) => !key.startsWith('_')).length,
    }
}

export async function restoreFullAutoBackup(fileRelPath: string): Promise<{ success: string[]; failed: string[] }> {
    if (!isTauri()) {
        throw new Error('Disk auto-backup restore is only available in the Tauri app.')
    }

    const bytes = await readFile(fileRelPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
    const backup = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>
    if (!backup._exportedAt || !backup._version) {
        throw new Error('Backup file is missing NAIS2 export metadata.')
    }

    const result = await importAllData(backup, true)
    await flushAllPendingWrites()
    return result
}
