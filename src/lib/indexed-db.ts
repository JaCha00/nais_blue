import { StateStorage } from 'zustand/middleware'
// Since I cannot install packages, I will implement a minimal wrapper similar to idb-keyval logic
// or I can implement a raw IndexedDB wrapper.
// Given constraints, raw IndexedDB is safer as strict dependency rules apply.

const DB_NAME = 'nais2-db'
const STORE_NAME = 'keyval'
const DB_TIMEOUT_MS = 10000 // 10초 타임아웃

// Central backup registry used by full exports, size diagnostics, and the
// store snapshot layer so new persisted stores are added in one place.
export const BACKUP_STORE_KEYS = [
    'nais2-generation',
    'nais2-character-store',
    'nais2-character-prompts',
    'nais2-presets',
    'nais2-settings',
    'nais2-auth',
    'nais2-scenes',
    'nais2-character-rotation',
    'nais2-shortcuts',
    'nais2-theme',
    'nais2-wildcards',
    'nais2-prompt-library',
    'nais2-layout',
    'nais2-library',
    'nais2-tools',
    'nais2-update',
    'nais2-style-lab',
    'nais2-asset-modules',
    'nais2-composition-repository',
    'nais2-composition-migration-backup',
] as const

export type BackupStoreKey = typeof BACKUP_STORE_KEYS[number]

// Renamed stores remain rollback sources until a dedicated destructive cleanup
// phase is approved. Full backups include both names so an export/import cycle
// never silently discards the retained copy.
export const LEGACY_BACKUP_STORE_KEYS = [
    'nais-library-storage',
    'tools-storage',
    'nais-update',
    // Explicit Composition migration aliases. These are allowlisted rollback
    // sources, not arbitrary IndexedDB keys.
    'scenes',
    'scene-store',
    'nais2-scene-prompts',
    'scene-prompts',
    'scenePrompts',
    'wildcards',
    'fragments',
    'wildcard-content',
    'fragmentContent',
    'character-prompts',
    'characterPrompts',
    'nais2-character-positions',
    'character-positions',
    'characterPositions',
    'generation-presets',
    'generationPresets',
    'novelaiPromptEditorState',
    'prompt-presets',
    'promptPresets',
    'asset-profile',
    'assetProfile',
] as const

export const FULL_BACKUP_STORE_KEYS = [
    ...BACKUP_STORE_KEYS,
    ...LEGACY_BACKUP_STORE_KEYS,
] as const

// IndexedDB 초기화 실패 추적
let dbInitFailed = false
let dbInitError: Error | null = null

// 지연 초기화 - 모듈 로드 시점이 아닌 첫 사용 시점에 초기화
let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    
    // 이전에 초기화 실패했으면 즉시 reject
    if (dbInitFailed) {
        return Promise.reject(dbInitError || new Error('IndexedDB initialization previously failed'))
    }
    
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        // IndexedDB 지원 체크
        if (typeof indexedDB === 'undefined') {
            dbInitFailed = true
            dbInitError = new Error('IndexedDB is not supported in this environment')
            reject(dbInitError)
            return
        }
        
        // 타임아웃 설정 - DB 열기가 무한 대기되는 것 방지
        const timeoutId = setTimeout(() => {
            dbInitFailed = true
            dbInitError = new Error(`IndexedDB open timed out after ${DB_TIMEOUT_MS}ms`)
            console.error('[IndexedDB]', dbInitError.message)
            reject(dbInitError)
        }, DB_TIMEOUT_MS)
        
        try {
            const request = indexedDB.open(DB_NAME, 1)
            
            request.onupgradeneeded = (event) => {
                try {
                    const db = (event.target as IDBOpenDBRequest).result
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME)
                    }
                } catch (err) {
                    console.error('[IndexedDB] onupgradeneeded error:', err)
                }
            }
            
            request.onsuccess = () => {
                clearTimeout(timeoutId)
                const db = request.result
                
                // DB 연결 끊김 감지
                db.onclose = () => {
                    console.warn('[IndexedDB] Database connection closed unexpectedly')
                    dbPromise = null // 다음 요청 시 재연결 시도
                }
                
                db.onerror = (event) => {
                    console.error('[IndexedDB] Database error:', event)
                }
                
                console.log('[IndexedDB] Database opened successfully')
                resolve(db)
            }
            
            request.onerror = () => {
                clearTimeout(timeoutId)
                dbInitFailed = true
                dbInitError = request.error || new Error('Failed to open IndexedDB')
                console.error('[IndexedDB] Open error:', dbInitError)
                reject(dbInitError)
            }
            
            request.onblocked = () => {
                console.warn('[IndexedDB] Database blocked - another connection is open')
            }
        } catch (err) {
            clearTimeout(timeoutId)
            dbInitFailed = true
            dbInitError = err instanceof Error ? err : new Error(String(err))
            console.error('[IndexedDB] Unexpected error during open:', dbInitError)
            reject(dbInitError)
        }
    })
    
    return dbPromise
}

// DB 초기화 상태 확인용 (마이그레이션 전 체크용)
export async function ensureDbReady(): Promise<boolean> {
    try {
        await getDb()
        return true
    } catch (err) {
        console.error('[IndexedDB] ensureDbReady failed:', err)
        return false
    }
}

// DB 초기화 실패 여부 확인
export function isDbInitFailed(): boolean {
    return dbInitFailed
}

const OPERATION_TIMEOUT_MS = 5000 // 개별 작업 타임아웃

// ============================================
// Debounced Write System
// Zustand persist calls setItem on EVERY state change.
// Without debouncing, typing a single character triggers full JSON.stringify + IndexedDB write.
// With thousands of scene images, each write serializes megabytes of data.
// ============================================
const WRITE_DEBOUNCE_MS: Record<string, number> = {
    'nais2-scenes': 3000,           // Largest store (scene images), debounce aggressively
    'nais2-generation': 1000,       // Prompt typing triggers frequent updates
    'nais2-character-store': 1500,
    'nais2-character-prompts': 1500,
    'nais2-character-rotation': 1000, // Rotation snapshots must survive app restarts and full backups.
    'nais2-presets': 1500,
    'nais2-wildcards': 2000,
}
const DEFAULT_WRITE_DEBOUNCE = 500
const MAX_WRITE_INTERVAL = 10000   // Force write at least every 10 seconds even during rapid changes

const pendingWriteTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingWriteValues = new Map<string, string>()
const lastWriteTime = new Map<string, number>()
const indexedDBWriteListeners = new Set<(key: string) => void>()
const inFlightWrites = new Set<Promise<void>>()
let tauriCloseFlushInstalled = false
let tauriCloseFlushInProgress = false
let tauriCloseFlushCompleted = false

export function registerIndexedDBWriteListener(listener: (key: string) => void): () => void {
    indexedDBWriteListeners.add(listener)
    return () => indexedDBWriteListeners.delete(listener)
}

function notifyIndexedDBWrite(key: string): void {
    for (const listener of indexedDBWriteListeners) {
        try {
            listener(key)
        } catch (error) {
            console.warn(`[IndexedDB] write listener failed for ${key}:`, error)
        }
    }
}

/** Write directly to IndexedDB (no debounce) */
async function rawSetItem(name: string, value: string): Promise<void> {
    if (dbInitFailed) return
    try {
        const db = await getDb()
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                console.error(`[IndexedDB] setItem(${name}): Operation timed out`)
                reject(new Error(`setItem timed out for key: ${name}`))
            }, OPERATION_TIMEOUT_MS)

            try {
                const transaction = db.transaction(STORE_NAME, 'readwrite')

                transaction.onerror = () => {
                    clearTimeout(timeoutId)
                    console.error(`[IndexedDB] setItem(${name}): Transaction error`, transaction.error)
                    reject(transaction.error)
                }

                transaction.onabort = () => {
                    clearTimeout(timeoutId)
                    console.error(`[IndexedDB] setItem(${name}): Transaction aborted`)
                    reject(new Error('Transaction aborted'))
                }

                transaction.oncomplete = () => {
                    clearTimeout(timeoutId)
                    resolve()
                }

                const store = transaction.objectStore(STORE_NAME)
                const request = store.put(value, name)

                request.onerror = () => {
                    clearTimeout(timeoutId)
                    console.error(`[IndexedDB] setItem(${name}): Request error`, request.error)
                    reject(request.error)
                }
            } catch (err) {
                clearTimeout(timeoutId)
                throw err
            }
        })
    } catch (err) {
        console.error(`[IndexedDB] setItem(${name}): Failed`, err)
    }
}

function trackedRawSetItem(name: string, value: string): Promise<void> {
    const writePromise = rawSetItem(name, value)
    inFlightWrites.add(writePromise)
    return writePromise.finally(() => {
        inFlightWrites.delete(writePromise)
    })
}

/** Flush a single pending write immediately */
async function flushKey(name: string): Promise<void> {
    const timer = pendingWriteTimers.get(name)
    if (timer) {
        clearTimeout(timer)
        pendingWriteTimers.delete(name)
    }
    const value = pendingWriteValues.get(name)
    if (value !== undefined) {
        pendingWriteValues.delete(name)
        lastWriteTime.set(name, Date.now())
        await trackedRawSetItem(name, value)
    }
}

/** Flush ALL pending writes (called on app close) */
export async function flushAllPendingWrites(): Promise<void> {
    const keys = new Set([...pendingWriteTimers.keys(), ...pendingWriteValues.keys()])
    for (const key of keys) {
        await flushKey(key)
    }
    if (inFlightWrites.size > 0) {
        await Promise.allSettled([...inFlightWrites])
    }
}

function requestBestEffortFlush(reason: string): void {
    void flushAllPendingWrites().catch((error) => {
        console.warn(`[IndexedDB] ${reason} flush failed:`, error)
    })
}

async function installTauriCloseFlushHandler(): Promise<void> {
    if (tauriCloseFlushInstalled) return
    tauriCloseFlushInstalled = true

    try {
        const [{ invoke, isTauri }, { getCurrentWindow }] = await Promise.all([
            import('@tauri-apps/api/core'),
            import('@tauri-apps/api/window'),
        ])
        if (!isTauri()) return

        const appWindow = getCurrentWindow()
        await appWindow.onCloseRequested(async (event) => {
            if (tauriCloseFlushCompleted) return

            event.preventDefault()
            if (tauriCloseFlushInProgress) return

            tauriCloseFlushInProgress = true
            try {
                await flushAllPendingWrites()
            } catch (error) {
                console.warn('[IndexedDB] Tauri close flush failed:', error)
            } finally {
                tauriCloseFlushCompleted = true
                tauriCloseFlushInProgress = false
                await invoke('exit_app').catch(async (error) => {
                    console.warn('[IndexedDB] Failed to exit after close flush:', error)
                    await appWindow.close().catch((closeError) => {
                        console.warn('[IndexedDB] Fallback close failed:', closeError)
                    })
                })
            }
        })
    } catch (error) {
        console.warn('[IndexedDB] Failed to install Tauri close flush handler:', error)
    }
}

// Flush pending writes on app close
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => requestBestEffortFlush('pagehide'))
    window.addEventListener('beforeunload', () => requestBestEffortFlush('beforeunload'))
    void installTauriCloseFlushHandler()
}

export const indexedDBStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        // Return pending value if exists (debounced write hasn't flushed yet)
        const pendingVal = pendingWriteValues.get(name)
        if (pendingVal !== undefined) return pendingVal

        // DB 초기화 실패 시 null 반환 (데이터 손실 방지를 위해 에러 대신 null)
        if (dbInitFailed) {
            console.warn(`[IndexedDB] getItem(${name}): DB init failed, returning null`)
            return null
        }

        try {
            const db = await getDb()
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.error(`[IndexedDB] getItem(${name}): Operation timed out`)
                    reject(new Error(`getItem timed out for key: ${name}`))
                }, OPERATION_TIMEOUT_MS)

                try {
                    const transaction = db.transaction(STORE_NAME, 'readonly')

                    transaction.onerror = () => {
                        clearTimeout(timeoutId)
                        console.error(`[IndexedDB] getItem(${name}): Transaction error`, transaction.error)
                        reject(transaction.error)
                    }

                    transaction.onabort = () => {
                        clearTimeout(timeoutId)
                        console.error(`[IndexedDB] getItem(${name}): Transaction aborted`)
                        reject(new Error('Transaction aborted'))
                    }

                    const store = transaction.objectStore(STORE_NAME)
                    const request = store.get(name)

                    request.onsuccess = () => {
                        clearTimeout(timeoutId)
                        resolve(request.result as string || null)
                    }

                    request.onerror = () => {
                        clearTimeout(timeoutId)
                        console.error(`[IndexedDB] getItem(${name}): Request error`, request.error)
                        reject(request.error)
                    }
                } catch (err) {
                    clearTimeout(timeoutId)
                    throw err
                }
            })
        } catch (err) {
            console.error(`[IndexedDB] getItem(${name}): Failed`, err)
            return null
        }
    },

    setItem: async (name: string, value: string): Promise<void> => {
        if (dbInitFailed) {
            console.warn(`[IndexedDB] setItem(${name}): DB init failed, skipping persist`)
            return
        }

        // Store latest value (always keep the newest)
        pendingWriteValues.set(name, value)
        notifyIndexedDBWrite(name)

        // Clear existing debounce timer
        const existingTimer = pendingWriteTimers.get(name)
        if (existingTimer) clearTimeout(existingTimer)

        // Check if we need to force-write (prevent starvation during rapid changes)
        const lastWrite = lastWriteTime.get(name) ?? 0
        const elapsed = Date.now() - lastWrite

        if (elapsed >= MAX_WRITE_INTERVAL) {
            // Too long since last write — flush immediately
            pendingWriteTimers.delete(name)
            const val = pendingWriteValues.get(name)!
            pendingWriteValues.delete(name)
            lastWriteTime.set(name, Date.now())
            await trackedRawSetItem(name, val)
            return
        }

        // Schedule debounced write
        const debounceMs = WRITE_DEBOUNCE_MS[name] ?? DEFAULT_WRITE_DEBOUNCE
        const timer = setTimeout(async () => {
            pendingWriteTimers.delete(name)
            const val = pendingWriteValues.get(name)
            if (val !== undefined) {
                pendingWriteValues.delete(name)
                lastWriteTime.set(name, Date.now())
                try {
                    await trackedRawSetItem(name, val)
                } catch (err) {
                    console.error(`[IndexedDB] Debounced write failed for ${name}:`, err)
                }
            }
        }, debounceMs)

        pendingWriteTimers.set(name, timer)
    },
    
    removeItem: async (name: string): Promise<void> => {
        if (dbInitFailed) {
            console.warn(`[IndexedDB] removeItem(${name}): DB init failed, skipping`)
            return
        }
        
        try {
            const db = await getDb()
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.error(`[IndexedDB] removeItem(${name}): Operation timed out`)
                    reject(new Error(`removeItem timed out for key: ${name}`))
                }, OPERATION_TIMEOUT_MS)
                
                try {
                    const transaction = db.transaction(STORE_NAME, 'readwrite')
                    
                    transaction.onerror = () => {
                        clearTimeout(timeoutId)
                        reject(transaction.error)
                    }
                    
                    transaction.onabort = () => {
                        clearTimeout(timeoutId)
                        reject(new Error('Transaction aborted'))
                    }
                    
                    transaction.oncomplete = () => {
                        clearTimeout(timeoutId)
                        resolve()
                    }
                    
                    const store = transaction.objectStore(STORE_NAME)
                    const request = store.delete(name)
                    
                    request.onerror = () => {
                        clearTimeout(timeoutId)
                        reject(request.error)
                    }
                } catch (err) {
                    clearTimeout(timeoutId)
                    throw err
                }
            })
        } catch (err) {
            console.error(`[IndexedDB] removeItem(${name}): Failed`, err)
        }
    },
}

/**
 * 특정 키의 데이터 크기가 너무 크면 정리
 * (대용량 wildcard 데이터 마이그레이션 이슈 해결용)
 */
export async function cleanupLargeData(key: string, maxSizeKB: number = 100): Promise<boolean> {
    try {
        const data = await indexedDBStorage.getItem(key)
        if (data && data.length > maxSizeKB * 1024) {
            console.warn(`[IndexedDB] ${key} data is too large (${(data.length / 1024).toFixed(1)}KB), cleaning up...`)
            
            // JSON 파싱해서 content 필드 제거
            try {
                const parsed = JSON.parse(data)
                if (parsed.state?.files) {
                    parsed.state.files = parsed.state.files.map((f: any) => {
                        const { content, ...meta } = f
                        return {
                            ...meta,
                            lineCount: Array.isArray(content) ? content.length : (meta.lineCount || 0)
                        }
                    })
                    parsed.state._migrated = true
                    await indexedDBStorage.setItem(key, JSON.stringify(parsed))
                    console.log(`[IndexedDB] ${key} cleaned up successfully`)
                    return true
                }
            } catch {
                // JSON 파싱 실패하면 그냥 삭제
                await indexedDBStorage.removeItem(key)
                console.log(`[IndexedDB] ${key} removed due to parse error`)
                return true
            }
        }
        return false
    } catch (error) {
        console.error('[IndexedDB] cleanup error:', error)
        return false
    }
}

export interface StoreMigrationReader {
    getItem: (key: string) => string | null | Promise<string | null>
}

/** Strict storage read for migration/repository authority; never converts I/O failures to null. */
export async function getIndexedDBItemStrict(name: string): Promise<string | null> {
    await flushKey(name)
    const db = await getDb()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly')
        const request = transaction.objectStore(STORE_NAME).get(name)
        request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null)
        request.onerror = () => reject(request.error ?? new Error(`Strict get failed for ${name}`))
        transaction.onerror = () => reject(transaction.error ?? new Error(`Strict get transaction failed for ${name}`))
        transaction.onabort = () => reject(transaction.error ?? new Error(`Strict get transaction aborted for ${name}`))
    })
}

/** Strict immediate write used by repository commits; errors propagate to the transaction. */
export async function setIndexedDBItemStrict(name: string, value: string): Promise<void> {
    const pendingTimer = pendingWriteTimers.get(name)
    if (pendingTimer !== undefined) clearTimeout(pendingTimer)
    pendingWriteTimers.delete(name)
    pendingWriteValues.delete(name)
    const db = await getDb()
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        transaction.objectStore(STORE_NAME).put(value, name)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error(`Strict set transaction failed for ${name}`))
        transaction.onabort = () => reject(transaction.error ?? new Error(`Strict set transaction aborted for ${name}`))
    })
    lastWriteTime.set(name, Date.now())
    notifyIndexedDBWrite(name)
}

/** Strict immediate delete used only by restore compensation. */
export async function removeIndexedDBItemStrict(name: string): Promise<void> {
    const pendingTimer = pendingWriteTimers.get(name)
    if (pendingTimer !== undefined) clearTimeout(pendingTimer)
    pendingWriteTimers.delete(name)
    pendingWriteValues.delete(name)
    const db = await getDb()
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        transaction.objectStore(STORE_NAME).delete(name)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error(`Strict remove transaction failed for ${name}`))
        transaction.onabort = () => reject(transaction.error ?? new Error(`Strict remove transaction aborted for ${name}`))
    })
    if (await getIndexedDBItemStrict(name) !== null) {
        throw new Error(`Strict remove readback mismatch for ${name}`)
    }
    notifyIndexedDBWrite(name)
}

/** Atomic compare-and-set used to acquire and advance the persisted migration lease. */
export async function compareAndSetIndexedDBItem(
    name: string,
    expected: string | null,
    next: string | null,
): Promise<boolean> {
    await flushKey(name)
    const db = await getDb()
    const changed = await new Promise<boolean>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const read = store.get(name)
        let matched = false
        read.onsuccess = () => {
            const current = typeof read.result === 'string' ? read.result : null
            if (current !== expected) return
            matched = true
            if (next === null) store.delete(name)
            else store.put(next, name)
        }
        read.onerror = () => reject(read.error ?? new Error(`CAS read failed for ${name}`))
        transaction.oncomplete = () => resolve(matched)
        transaction.onerror = () => reject(transaction.error ?? new Error(`CAS transaction failed for ${name}`))
        transaction.onabort = () => reject(transaction.error ?? new Error(`CAS transaction aborted for ${name}`))
    })
    if (changed) {
        lastWriteTime.set(name, Date.now())
        notifyIndexedDBWrite(name)
    }
    return changed
}

/** Exact serialized key/value snapshot used by non-destructive migrations. */
export async function exportRawIndexedDBEntries(): Promise<Record<string, string>> {
    const db = await getDb()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const keysRequest = store.getAllKeys()
        const valuesRequest = store.getAll()
        let keys: IDBValidKey[] | null = null
        let values: unknown[] | null = null

        const finish = () => {
            if (keys === null || values === null) return
            const result: Record<string, string> = {}
            for (let index = 0; index < keys.length; index += 1) {
                const key = keys[index]
                const value = values[index]
                if (typeof key === 'string' && typeof value === 'string') {
                    result[key] = value
                }
            }
            resolve(result)
        }
        keysRequest.onsuccess = () => {
            keys = keysRequest.result
            finish()
        }
        valuesRequest.onsuccess = () => {
            values = valuesRequest.result
            finish()
        }
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error ?? new Error('Raw IndexedDB snapshot aborted'))
    })
}

/** Migration/repository writes use an explicit flush + readback boundary. */
export async function flushIndexedDBKey(name: string): Promise<void> {
    await flushKey(name)
}

export interface StoreMigrationWriter extends StoreMigrationReader {
    setItem: (key: string, value: string) => unknown | Promise<unknown>
}

export type RetainedStoreMigrationStatus =
    | 'source-missing'
    | 'target-present'
    | 'copied'
    | 'verification-failed'
    | 'failed'

export interface RetainedStoreMigrationResult {
    sourceKey: string
    targetKey: string
    status: RetainedStoreMigrationStatus
    sourceRetained: true
}

/**
 * Dual-read/single-write migration primitive. It intentionally has no delete
 * capability: the legacy value remains available for rollback and old backups.
 */
export async function copyStoreKeysRetainingSource(
    renames: readonly (readonly [string, string])[],
    source: StoreMigrationReader,
    target: StoreMigrationWriter,
    flushTarget: (key: string) => void | Promise<void> = () => undefined,
): Promise<RetainedStoreMigrationResult[]> {
    const results: RetainedStoreMigrationResult[] = []
    for (const [sourceKey, targetKey] of renames) {
        try {
            const targetData = await target.getItem(targetKey)
            if (targetData !== null) {
                results.push({ sourceKey, targetKey, status: 'target-present', sourceRetained: true })
                continue
            }

            const sourceData = await source.getItem(sourceKey)
            if (sourceData === null) {
                results.push({ sourceKey, targetKey, status: 'source-missing', sourceRetained: true })
                continue
            }

            await target.setItem(targetKey, sourceData)
            await flushTarget(targetKey)
            const verified = await target.getItem(targetKey)
            results.push({
                sourceKey,
                targetKey,
                status: verified === sourceData ? 'copied' : 'verification-failed',
                sourceRetained: true,
            })
        } catch (error) {
            console.error(`[Migration] ${sourceKey} → ${targetKey}: Failed`, error)
            results.push({ sourceKey, targetKey, status: 'failed', sourceRetained: true })
        }
    }
    return results
}

function logRetainedMigrationResults(prefix: string, results: readonly RetainedStoreMigrationResult[]): void {
    for (const result of results) {
        const route = `${result.sourceKey} → ${result.targetKey}`
        if (result.status === 'copied') {
            console.log(`${prefix} ${route}: copied and verified; legacy source retained`)
        } else if (result.status === 'verification-failed' || result.status === 'failed') {
            console.error(`${prefix} ${route}: ${result.status}; legacy source retained`)
        } else {
            console.log(`${prefix} ${route}: ${result.status}; legacy source retained`)
        }
    }
}

/** Copy renamed IndexedDB keys while retaining the old key for rollback. */
export async function migrateIndexedDBKeys(renames: [string, string][]): Promise<RetainedStoreMigrationResult[]> {
    const results = await copyStoreKeysRetainingSource(
        renames,
        indexedDBStorage,
        indexedDBStorage,
        flushKey,
    )
    logRetainedMigrationResults('[IndexedDB Migration]', results)
    return results
}

/** Copy renamed localStorage keys into IndexedDB without deleting local data. */
export async function migrateRenamedLocalStorageKeys(renames: [string, string][]): Promise<RetainedStoreMigrationResult[]> {
    const localReader: StoreMigrationReader = {
        getItem: key => localStorage.getItem(key),
    }
    const results = await copyStoreKeysRetainingSource(
        renames,
        localReader,
        indexedDBStorage,
        flushKey,
    )
    logRetainedMigrationResults('[Migration]', results)
    return results
}

/**
 * Copy canonical localStorage values into IndexedDB before Zustand hydrates.
 * The source remains intact until a separately approved cleanup phase.
 */
export async function migrateFromLocalStorage(keys: string[]): Promise<RetainedStoreMigrationResult[]> {
    const localReader: StoreMigrationReader = {
        getItem: key => localStorage.getItem(key),
    }
    const results = await copyStoreKeysRetainingSource(
        keys.map(key => [key, key] as const),
        localReader,
        indexedDBStorage,
        flushKey,
    )
    logRetainedMigrationResults('[Migration]', results)
    return results
}

export interface BackupStoragePort {
    getItem: (key: string) => string | null | Promise<string | null>
    setItem: (key: string, value: string) => unknown | Promise<unknown>
    removeItem?: (key: string) => unknown | Promise<unknown>
}

export interface BackupExportOptions {
    storeKeys?: readonly string[]
    exportedAt?: string
    exportWildcardContent?: () => Promise<{ [id: string]: string[] }>
    /** Backup Envelope v3 must not turn read failures into silent omissions. */
    strict?: boolean
}

/**
 * Storage-port form used by tests and migrations to prove a real JSON
 * export/import round trip without coupling the contract to browser IndexedDB.
 */
export async function exportBackupFromStorage(
    storage: Pick<BackupStoragePort, 'getItem'>,
    options: BackupExportOptions = {},
): Promise<{ [key: string]: unknown }> {
    const backup: { [key: string]: unknown } = {
        _exportedAt: options.exportedAt ?? new Date().toISOString(),
        _version: '2.3',
    }

    for (const key of options.storeKeys ?? FULL_BACKUP_STORE_KEYS) {
        try {
            const data = await storage.getItem(key)
            if (data !== null) {
                const parsed = filterLargeImageData(key, JSON.parse(data))
                backup[key] = parsed
            }
        } catch (err) {
            console.error(`[Backup] Failed to export ${key}:`, err)
            if (options.strict) throw err
        }
    }

    if (options.exportWildcardContent) {
        try {
            const wildcardContent = await options.exportWildcardContent()
            if (Object.keys(wildcardContent).length > 0) {
                backup['nais2-wildcard-content'] = wildcardContent
                console.log('[Backup] Wildcard content exported:', Object.keys(wildcardContent).length, 'files')
            }
        } catch (err) {
            console.error('[Backup] Failed to export wildcard content:', err)
            if (options.strict) throw err
        }
    }

    return backup
}

/**
 * Full JSON backup. Retained legacy keys are exported alongside canonical keys;
 * character/vibe bytes stay in their existing stores and are never projected
 * into Composition documents by this path.
 */
export async function exportAllData(
    options: { strict?: boolean } = {},
): Promise<{ [key: string]: unknown }> {
    const backup = await exportBackupFromStorage(indexedDBStorage, {
        strict: options.strict,
        exportWildcardContent: () => exportWildcardContentSnapshot({ strict: options.strict }),
    })
    console.log('[Backup] Export complete:', Object.keys(backup).length - 2, 'stores')
    return backup
}

/**
 * Filter out disposable preview data from store data.
 * Character/Vibe bytes and existing encoded-vibe caches are retained verbatim:
 * migration/restore must never force an API re-encode.
 */
function filterLargeImageData(key: string, data: unknown): unknown {
    if (!data || typeof data !== 'object') return data
    
    const obj = data as Record<string, unknown>
    
    // Handle Zustand persist wrapper structure: { state: {...}, version: number }
    if ('state' in obj && 'version' in obj) {
        return {
            ...obj,
            state: filterLargeImageData(key, obj.state)
        }
    }
    
    switch (key) {
        case 'nais2-character-store':
            return data
            
        case 'nais2-generation':
            // Filter history thumbnails (files exist) and temp images
            return {
                ...obj,
                history: Array.isArray(obj.history)
                    ? obj.history.map((item: Record<string, unknown>) => ({
                        ...item,
                        thumbnail: item.thumbnail && typeof item.thumbnail === 'string' && item.thumbnail.startsWith('data:')
                            ? '[THUMBNAIL_EXCLUDED]'
                            : item.thumbnail,
                    }))
                    : obj.history,
                sourceImage: null,
                previewImage: null,
                mask: null,
            }
            
        default:
            return data
    }
}

/**
 * Export all wildcard content from separate IndexedDB
 * Fixed: Race condition where getAllRequest might complete before handler is attached
 */
export interface WildcardContentExportOptions {
    /** Migration capture must fail closed instead of treating a timeout as an empty DB. */
    strict?: boolean
    timeoutMs?: number
}

export async function exportWildcardContentSnapshot(
    options: WildcardContentExportOptions = {},
): Promise<{ [id: string]: string[] }> {
    return new Promise((resolve, reject) => {
        let settled = false
        const finishResolve = (value: { [id: string]: string[] }) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve(value)
        }
        const finishReject = (error: unknown) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            reject(error)
        }
        // Add timeout to prevent infinite waiting
        const timeout = setTimeout(() => {
            const error = new Error(`Wildcard export timed out after ${options.timeoutMs ?? 30000}ms`)
            console.error('[Backup]', error.message)
            if (options.strict) finishReject(error)
            else finishResolve({})
        }, options.timeoutMs ?? 30000)
        
        const request = indexedDB.open('nais2-wildcard-content', 1)
        
        request.onerror = () => {
            finishReject(request.error)
        }
        
        request.onsuccess = () => {
            const db = request.result
            if (!db.objectStoreNames.contains('contents')) {
                finishResolve({})
                return
            }
            
            const transaction = db.transaction('contents', 'readonly')
            const store = transaction.objectStore('contents')
            const getAllRequest = store.getAll()
            const getAllKeysRequest = store.getAllKeys()
            
            const result: { [id: string]: string[] } = {}
            let keys: string[] = []
            let values: string[][] = []
            let keysReady = false
            let valuesReady = false
            
            const tryResolve = () => {
                if (keysReady && valuesReady) {
                    for (let i = 0; i < keys.length; i++) {
                        result[keys[i]] = values[i]
                    }
                    finishResolve(result)
                }
            }
            
            getAllKeysRequest.onsuccess = () => {
                keys = getAllKeysRequest.result as string[]
                keysReady = true
                tryResolve()
            }
            
            getAllRequest.onsuccess = () => {
                values = getAllRequest.result as string[][]
                valuesReady = true
                tryResolve()
            }
            
            transaction.onerror = () => {
                finishReject(transaction.error)
            }
        }
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains('contents')) {
                db.createObjectStore('contents')
            }
        }
    })
}

/**
 * Import wildcard content to separate IndexedDB
 */
export async function importWildcardContentSnapshot(content: { [id: string]: string[] }): Promise<void> {
    const normalized = Object.fromEntries(
        Object.entries(content).sort(([left], [right]) => left.localeCompare(right)),
    )
    for (const [id, lines] of Object.entries(normalized)) {
        if (!Array.isArray(lines) || lines.some(line => typeof line !== 'string')) {
            throw new Error(`Invalid wildcard content for ${id}`)
        }
    }

    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('nais2-wildcard-content', 1)
        
        request.onerror = () => reject(request.error)
        
        request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('contents', 'readwrite')
            const store = transaction.objectStore('contents')
            store.clear()
            for (const [id, lines] of Object.entries(normalized)) {
                store.put(lines, id)
            }
            
            transaction.oncomplete = () => {
                console.log('[Restore] Wildcard content restored:', Object.keys(normalized).length, 'files')
                resolve()
            }
            transaction.onerror = () => reject(transaction.error)
        }
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains('contents')) {
                db.createObjectStore('contents')
            }
        }
    })

    const readback = await exportWildcardContentSnapshot({ strict: true })
    const canonical = (value: { [id: string]: string[] }) => JSON.stringify(
        Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
    )
    if (canonical(readback) !== canonical(normalized)) {
        throw new Error('Wildcard restore readback mismatch')
    }
}

function canonicalWildcardContent(value: { [id: string]: string[] }): string {
    return JSON.stringify(
        Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
    )
}

/** Atomic compare-and-replace used by startup migration sidecar materialization. */
export async function compareAndReplaceWildcardContentSnapshot(
    expected: { [id: string]: string[] },
    replacement: { [id: string]: string[] },
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        let settled = false
        let comparisonFailed = false
        const finish = (value: boolean) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            resolve(value)
        }
        const fail = (error: unknown) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            reject(error)
        }
        const timeout = setTimeout(() => fail(new Error('Wildcard compare-and-replace timed out')), 30000)
        const request = indexedDB.open('nais2-wildcard-content', 1)

        request.onerror = () => fail(request.error)
        request.onupgradeneeded = event => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains('contents')) db.createObjectStore('contents')
        }
        request.onsuccess = () => {
            const transaction = request.result.transaction('contents', 'readwrite')
            const store = transaction.objectStore('contents')
            const keysRequest = store.getAllKeys()
            const valuesRequest = store.getAll()
            let keys: IDBValidKey[] | null = null
            let values: unknown[] | null = null

            const compareAndWrite = () => {
                if (keys === null || values === null) return
                const current: Record<string, string[]> = {}
                for (let index = 0; index < keys.length; index += 1) {
                    if (typeof keys[index] === 'string' && Array.isArray(values[index])) {
                        current[keys[index] as string] = values[index] as string[]
                    }
                }
                if (canonicalWildcardContent(current) !== canonicalWildcardContent(expected)) {
                    comparisonFailed = true
                    transaction.abort()
                    return
                }
                store.clear()
                for (const [id, lines] of Object.entries(replacement)) store.put([...lines], id)
            }
            keysRequest.onsuccess = () => { keys = keysRequest.result; compareAndWrite() }
            valuesRequest.onsuccess = () => { values = valuesRequest.result; compareAndWrite() }
            keysRequest.onerror = () => transaction.abort()
            valuesRequest.onerror = () => transaction.abort()
            transaction.oncomplete = () => finish(true)
            transaction.onabort = () => {
                if (comparisonFailed) finish(false)
                else fail(transaction.error ?? new Error('Wildcard compare-and-replace aborted'))
            }
            transaction.onerror = () => {
                if (!comparisonFailed) fail(transaction.error)
            }
        }
    })
}

export interface BackupImportOptions {
    overwrite?: boolean
    flushStore?: (key: string) => void | Promise<void>
    importWildcardContent?: (content: { [id: string]: string[] }) => Promise<void>
    readWildcardContent?: () => Promise<{ [id: string]: string[] }>
    allowedKeys?: readonly string[]
    /** External allowlisted file commit kept inside the restore journal. */
    finalizeRestore?: () => Promise<void>
    rollbackFinalize?: () => Promise<void>
    finalizeKey?: string
}

export type BackupRestoreIgnoredReason =
    | 'metadata'
    | 'legacy-marketplace-or-supabase'
    | 'unknown-store-key'

export interface BackupRestoreIgnoredKey {
    key: string
    reason: BackupRestoreIgnoredReason
}

export interface BackupRestoreDryRunReport {
    acceptedKeys: string[]
    ignoredKeys: BackupRestoreIgnoredKey[]
}

export interface BackupImportResult {
    success: string[]
    failed: string[]
    ignored: BackupRestoreIgnoredKey[]
}

export const RESTORE_STORE_ALLOWLIST = [
    ...FULL_BACKUP_STORE_KEYS,
    'nais2-wildcard-content',
] as const

function ignoredRestoreReason(key: string): BackupRestoreIgnoredReason {
    if (key.startsWith('_')) return 'metadata'
    if (/market(?:place)?|supabase|^sb-/i.test(key)) return 'legacy-marketplace-or-supabase'
    return 'unknown-store-key'
}

/**
 * Pure preflight used by every restore surface. Unknown raw keys are reported
 * but never written to IndexedDB.
 */
export function dryRunBackupRestore(
    backup: Readonly<Record<string, unknown>>,
    allowedKeys: readonly string[] = RESTORE_STORE_ALLOWLIST,
): BackupRestoreDryRunReport {
    const allowed = new Set(allowedKeys)
    const acceptedKeys: string[] = []
    const ignoredKeys: BackupRestoreIgnoredKey[] = []
    for (const key of Object.keys(backup).sort()) {
        if (allowed.has(key)) {
            acceptedKeys.push(key)
        } else {
            ignoredKeys.push({ key, reason: ignoredRestoreReason(key) })
        }
    }
    return { acceptedKeys, ignoredKeys }
}

/** Restore backup payloads with write/flush/readback verification. */
export async function importBackupToStorage(
    storage: BackupStoragePort,
    backup: { [key: string]: unknown },
    options: BackupImportOptions = {},
): Promise<BackupImportResult> {
    const dryRun = dryRunBackupRestore(backup, options.allowedKeys)
    const accepted = new Set(dryRun.acceptedKeys)
    const result: BackupImportResult = {
        success: [],
        failed: [],
        ignored: dryRun.ignoredKeys,
    }
    const previousValues = new Map<string, string | null>()
    let previousWildcardContent: { [id: string]: string[] } | undefined
    const attemptedMutations: string[] = []

    try {
        for (const key of dryRun.acceptedKeys) {
            if (key === 'nais2-wildcard-content') {
                if (options.readWildcardContent !== undefined) {
                    previousWildcardContent = await options.readWildcardContent()
                }
            } else {
                previousValues.set(key, await storage.getItem(key))
            }
        }
    } catch (error) {
        console.error('[Restore] Failed to create pre-restore journal:', error)
        result.failed.push('pre-restore-journal')
        return result
    }

    for (const [key, value] of Object.entries(backup)) {
        if (!accepted.has(key)) continue

        if (key === 'nais2-wildcard-content') {
            if (!options.importWildcardContent) {
                result.failed.push(key)
                continue
            }
            try {
                attemptedMutations.push(key)
                await options.importWildcardContent(value as { [id: string]: string[] })
                result.success.push(key)
            } catch (err) {
                console.error(`[Restore] ${key}: Failed`, err)
                result.failed.push(key)
            }
            continue
        }

        try {
            if (!options.overwrite) {
                const existing = await storage.getItem(key)
                if (existing !== null) {
                    console.log(`[Restore] ${key}: Skipping (data exists)`)
                    continue
                }
            }

            const serialized = JSON.stringify(value)
            attemptedMutations.push(key)
            await storage.setItem(key, serialized)
            await options.flushStore?.(key)
            const verified = await storage.getItem(key)
            if (verified !== serialized) {
                throw new Error(`Restore readback mismatch for ${key}`)
            }
            result.success.push(key)
            console.log(`[Restore] ${key}: Restored and verified`)
        } catch (err) {
            console.error(`[Restore] ${key}: Failed`, err)
            result.failed.push(key)
        }
    }

    if (result.failed.length === 0 && options.finalizeRestore !== undefined) {
        const finalizeKey = options.finalizeKey ?? 'external-finalize'
        try {
            await options.finalizeRestore()
            result.success.push(finalizeKey)
        } catch (error) {
            console.error(`[Restore] Finalize failed for ${finalizeKey}:`, error)
            result.failed.push(finalizeKey)
            if (options.rollbackFinalize !== undefined) {
                try {
                    await options.rollbackFinalize()
                } catch (rollbackError) {
                    console.error(`[Restore] Finalize rollback failed for ${finalizeKey}:`, rollbackError)
                    result.failed.push(`rollback:${finalizeKey}`)
                }
            }
        }
    }

    if (result.failed.length > 0 && attemptedMutations.length > 0) {
        const restoredKeys = [...new Set(attemptedMutations)].reverse()
        for (const key of restoredKeys) {
            try {
                if (key === 'nais2-wildcard-content') {
                    if (options.importWildcardContent === undefined || previousWildcardContent === undefined) {
                        throw new Error('Wildcard rollback snapshot is unavailable')
                    }
                    await options.importWildcardContent(previousWildcardContent)
                } else {
                    const previous = previousValues.get(key) ?? null
                    if (previous === null) {
                        if (storage.removeItem === undefined) {
                            throw new Error(`Storage port cannot remove newly restored key ${key}`)
                        }
                        await storage.removeItem(key)
                        await options.flushStore?.(key)
                        if (await storage.getItem(key) !== null) {
                            throw new Error(`Rollback removal readback mismatch for ${key}`)
                        }
                    } else {
                        await storage.setItem(key, previous)
                        await options.flushStore?.(key)
                        if (await storage.getItem(key) !== previous) {
                            throw new Error(`Rollback readback mismatch for ${key}`)
                        }
                    }
                }
            } catch (error) {
                console.error(`[Restore] Rollback failed for ${key}:`, error)
                result.failed.push(`rollback:${key}`)
            }
        }
        result.success = []
    }

    return result
}

/**
 * Restore data produced by exportAllData. Unknown/legacy store keys remain
 * round-trippable and no old store is removed as a side effect.
 */
export async function importAllData(
    backup: { [key: string]: unknown },
    overwrite = false,
    options: Pick<BackupImportOptions, 'finalizeRestore' | 'rollbackFinalize' | 'finalizeKey'> = {},
): Promise<BackupImportResult> {
    await flushAllPendingWrites()
    const strictRestoreStorage: BackupStoragePort = {
        getItem: getIndexedDBItemStrict,
        setItem: setIndexedDBItemStrict,
        removeItem: removeIndexedDBItemStrict,
    }
    const result = await importBackupToStorage(strictRestoreStorage, backup, {
        overwrite,
        importWildcardContent: importWildcardContentSnapshot,
        readWildcardContent: () => exportWildcardContentSnapshot({ strict: true }),
        ...options,
    })
    console.log('[Restore] Complete:', result.success.length, 'success,', result.failed.length, 'failed')
    return result
}

/**
 * 특정 스토어 데이터 크기 확인 (디버깅용)
 */
export async function getStoreSizes(): Promise<{ [key: string]: number }> {
    const sizes: { [key: string]: number } = {}
    
    for (const key of FULL_BACKUP_STORE_KEYS) {
        try {
            const data = await indexedDBStorage.getItem(key)
            sizes[key] = data ? data.length : 0
        } catch {
            sizes[key] = -1 // 에러 표시
        }
    }
    
    return sizes
}
