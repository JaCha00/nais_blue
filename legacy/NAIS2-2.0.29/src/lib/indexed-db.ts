import { StateStorage } from 'zustand/middleware'
// Since I cannot install packages, I will implement a minimal wrapper similar to idb-keyval logic
// or I can implement a raw IndexedDB wrapper.
// Given constraints, raw IndexedDB is safer as strict dependency rules apply.

const DB_NAME = 'nais2-db'
const STORE_NAME = 'keyval'

const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME)
        }
    }
    request.onsuccess = () => {
        resolve(request.result)
    }
    request.onerror = () => reject(request.error)
})

export const indexedDBStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        const db = await dbPromise
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.get(name)
            request.onsuccess = () => resolve(request.result as string || null)
            request.onerror = () => reject(request.error)
        })
    },
    setItem: async (name: string, value: string): Promise<void> => {
        const db = await dbPromise
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.put(value, name)
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
    },
    removeItem: async (name: string): Promise<void> => {
        const db = await dbPromise
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.delete(name)
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
        })
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
