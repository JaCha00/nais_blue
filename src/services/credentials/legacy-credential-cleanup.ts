import { isTauri } from '@tauri-apps/api/core'
import { readFile, remove } from '@tauri-apps/plugin-fs'

import { listFullAutoBackups } from '@/lib/auto-backup'
import { listStoreSnapshots } from '@/lib/store-snapshots'
import { MEDIA_STORAGE_BASE_DIRECTORY } from '@/platform/storage'
import {
    AUTH_STORE_KEY,
    authPayloadContainsRawSecret,
} from '@/services/credentials/auth-vault-migration'

const LOCAL_AUTO_BACKUP_KEY = 'nais2-auto-backup'
const decoder = new TextDecoder()
const R2_SECRET_KEYS = new Set([
    'accesskeyid',
    'secretaccesskey',
    'r2accesskey',
    'r2secretkey',
])

export interface LegacyCredentialCleanupResult {
    inspected: number
    unsafe: number
    deleted: number
    failed: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Structural scan only; secret values are never returned or logged. */
export function backupArtifactContainsRawCredential(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(backupArtifactContainsRawCredential)
    if (!isRecord(value)) return false

    for (const [key, child] of Object.entries(value)) {
        if (key === AUTH_STORE_KEY && authPayloadContainsRawSecret(child)) return true
        if (key === 'serializedStores' && isRecord(child)) {
            const serializedAuth = child[AUTH_STORE_KEY]
            if (authPayloadContainsRawSecret(serializedAuth)) return true
        }
        if (R2_SECRET_KEYS.has(normalizedKey(key))
            && typeof child === 'string'
            && child.trim().length > 0) {
            return true
        }
        if (backupArtifactContainsRawCredential(child)) return true
    }
    return false
}

function parseJson(raw: string): unknown {
    return JSON.parse(raw) as unknown
}

function cleanLocalAutoBackups(result: LegacyCredentialCleanupResult): void {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(LOCAL_AUTO_BACKUP_KEY)
    if (raw === null) return
    let entries: unknown
    try {
        entries = parseJson(raw)
    } catch {
        result.failed += 1
        return
    }
    if (!Array.isArray(entries)) {
        result.failed += 1
        return
    }

    const retained: unknown[] = []
    let unsafeEntries = 0
    for (const entry of entries) {
        result.inspected += 1
        if (backupArtifactContainsRawCredential(entry)) {
            result.unsafe += 1
            unsafeEntries += 1
        } else {
            retained.push(entry)
        }
    }
    if (unsafeEntries === 0) return
    const serialized = JSON.stringify(retained)
    try {
        localStorage.setItem(LOCAL_AUTO_BACKUP_KEY, serialized)
        if (localStorage.getItem(LOCAL_AUTO_BACKUP_KEY) !== serialized) {
            result.failed += unsafeEntries
            return
        }
        result.deleted += unsafeEntries
    } catch {
        result.failed += unsafeEntries
    }
}

async function removeUnsafeFile(
    relPath: string,
    result: LegacyCredentialCleanupResult,
): Promise<void> {
    result.inspected += 1
    try {
        const parsed = parseJson(decoder.decode(await readFile(relPath, {
            baseDir: MEDIA_STORAGE_BASE_DIRECTORY,
        })))
        if (!backupArtifactContainsRawCredential(parsed)) return
        result.unsafe += 1
        await remove(relPath, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
        result.deleted += 1
    } catch {
        result.failed += 1
    }
}

/**
 * Deletes only managed backup artifacts that structurally contain credentials.
 * The caller must obtain an explicit destructive confirmation first.
 */
export async function cleanupLegacyCredentialBackups(): Promise<LegacyCredentialCleanupResult> {
    const result: LegacyCredentialCleanupResult = {
        inspected: 0,
        unsafe: 0,
        deleted: 0,
        failed: 0,
    }
    cleanLocalAutoBackups(result)
    if (!isTauri()) return result

    const [fullBackupResult, snapshotResult] = await Promise.allSettled([
        listFullAutoBackups(),
        listStoreSnapshots(),
    ])
    if (fullBackupResult.status === 'fulfilled') {
        for (const entry of fullBackupResult.value) {
            await removeUnsafeFile(entry.relPath, result)
        }
    } else {
        result.failed += 1
    }
    if (snapshotResult.status === 'fulfilled') {
        for (const group of snapshotResult.value) {
            for (const entry of group.entries) {
                await removeUnsafeFile(entry.relPath, result)
            }
        }
    } else {
        result.failed += 1
    }
    return result
}
