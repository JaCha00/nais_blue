import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

// 별도 IndexedDB for fragment content (대용량 데이터)
// 기존 wildcard 데이터와 호환을 위해 DB 이름 유지
const CONTENT_DB_NAME = 'nais2-wildcard-content'
const CONTENT_STORE_NAME = 'contents'

let contentDbPromise: Promise<IDBDatabase> | null = null

function getContentDb(): Promise<IDBDatabase> {
    if (!contentDbPromise) {
        contentDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(CONTENT_DB_NAME, 1)
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result
                if (!db.objectStoreNames.contains(CONTENT_STORE_NAME)) {
                    db.createObjectStore(CONTENT_STORE_NAME)
                }
            }
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    }
    return contentDbPromise
}

// Content 저장/조회 함수
async function saveContent(id: string, content: string[]): Promise<void> {
    const db = await getContentDb()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONTENT_STORE_NAME, 'readwrite')
        const store = transaction.objectStore(CONTENT_STORE_NAME)
        const request = store.put(content, id)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}

async function loadContent(id: string): Promise<string[]> {
    const db = await getContentDb()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONTENT_STORE_NAME, 'readonly')
        const store = transaction.objectStore(CONTENT_STORE_NAME)
        const request = store.get(id)
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
    })
}

async function deleteContent(id: string): Promise<void> {
    const db = await getContentDb()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONTENT_STORE_NAME, 'readwrite')
        const store = transaction.objectStore(CONTENT_STORE_NAME)
        const request = store.delete(id)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}

// 모든 content 삭제 (초기화용)
async function clearAllContent(): Promise<void> {
    const db = await getContentDb()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONTENT_STORE_NAME, 'readwrite')
        const store = transaction.objectStore(CONTENT_STORE_NAME)
        const request = store.clear()
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}

// 메타데이터만 저장 (content 제외)
export interface FragmentFileMeta {
    id: string
    name: string           // 파일 이름 (확장자 제외) - 조각 프롬프트 참조명
    folder: string         // 폴더 경로 (빈 문자열이면 루트)
    lineCount: number      // 라인 수 (UI 표시용)
    createdAt: number
    updatedAt: number
}

// 전체 파일 인터페이스 (content 포함 - 에디터용)
export interface FragmentFile extends FragmentFileMeta {
    content: string[]
}

// 메모리 캐시 (자주 접근하는 content)
const contentCache = new Map<string, string[]>()
const MAX_CACHE_SIZE = 20

function addToCache(id: string, content: string[]) {
    if (contentCache.size >= MAX_CACHE_SIZE) {
        // 가장 오래된 항목 제거
        const firstKey = contentCache.keys().next().value
        if (firstKey) contentCache.delete(firstKey)
    }
    contentCache.set(id, content)
}

interface FragmentState {
    // 메타데이터 목록 (content 제외)
    files: FragmentFileMeta[]

    // 순차 조각 프롬프트용 카운터
    sequentialCounters: Record<string, number>

    // 초기화 상태
    _initialized: boolean

    // 마이그레이션 완료 여부 (persist됨)
    _migrated: boolean

    // Actions - CRUD
    addFile: (name: string, folder?: string, content?: string[]) => Promise<FragmentFile>
    updateFile: (id: string, updates: Partial<Pick<FragmentFile, 'name' | 'folder' | 'content'>>) => Promise<void>
    deleteFile: (id: string) => Promise<void>
    duplicateFile: (id: string) => Promise<FragmentFile | null>

    // Actions - Content 로드 (비동기)
    loadFileContent: (id: string) => Promise<string[]>
    getFileWithContent: (id: string) => Promise<FragmentFile | null>

    // Actions - Content
    getFileByPath: (path: string) => FragmentFileMeta | undefined
    getRandomLine: (path: string) => Promise<string | null>
    getSequentialLine: (path: string) => Promise<string | null>
    resetSequentialCounter: (path?: string) => void

    // Actions - Folder
    getFolders: () => string[]
    getFilesInFolder: (folder: string) => FragmentFileMeta[]

    // Actions - Reorder
    reorderFiles: (files: FragmentFileMeta[]) => void

    // Import/Export
    importFromText: (name: string, text: string, folder?: string) => Promise<FragmentFile>
    exportToText: (id: string) => Promise<string | null>
    exportAll: () => Promise<{ meta: FragmentFileMeta[], contents: Record<string, string[]> }>
    importAll: (data: { meta: FragmentFileMeta[], contents: Record<string, string[]> }) => Promise<number>

    // Clear all data
    clearAll: () => Promise<void>

    // Migration
    _migrateOldData: () => Promise<void>
}

export const useFragmentStore = create<FragmentState>()(
    persist(
        (set, get) => ({
            files: [],
            sequentialCounters: {},
            _initialized: false,
            _migrated: false,

            addFile: async (name, folder = '', content = []) => {
                const id = Date.now().toString()
                const newFileMeta: FragmentFileMeta = {
                    id,
                    name: name.trim(),
                    folder: folder.trim(),
                    lineCount: content.length,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                }

                // content를 별도 DB에 저장
                await saveContent(id, content)
                addToCache(id, content)

                set((state) => ({
                    files: [...state.files, newFileMeta]
                }))

                return { ...newFileMeta, content }
            },

            updateFile: async (id, updates) => {
                const file = get().files.find(f => f.id === id)
                if (!file) return

                let lineCount = file.lineCount

                if (updates.content !== undefined) {
                    await saveContent(id, updates.content)
                    addToCache(id, updates.content)
                    lineCount = updates.content.length
                }

                set((state) => ({
                    files: state.files.map((f) =>
                        f.id === id
                            ? {
                                ...f,
                                name: updates.name !== undefined ? updates.name : f.name,
                                folder: updates.folder !== undefined ? updates.folder : f.folder,
                                lineCount,
                                updatedAt: Date.now()
                            }
                            : f
                    )
                }))
            },

            deleteFile: async (id) => {
                await deleteContent(id)
                contentCache.delete(id)

                set((state) => ({
                    files: state.files.filter((f) => f.id !== id)
                }))
            },

            duplicateFile: async (id) => {
                const fileMeta = get().files.find(f => f.id === id)
                if (!fileMeta) return null

                const content = await get().loadFileContent(id)
                const newId = Date.now().toString()

                const newFileMeta: FragmentFileMeta = {
                    id: newId,
                    name: `${fileMeta.name}_copy`,
                    folder: fileMeta.folder,
                    lineCount: content.length,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                }

                await saveContent(newId, content)
                addToCache(newId, content)

                set((state) => ({
                    files: [...state.files, newFileMeta]
                }))

                return { ...newFileMeta, content }
            },

            loadFileContent: async (id) => {
                // 캐시 확인
                const cached = contentCache.get(id)
                if (cached) return cached

                const content = await loadContent(id)
                addToCache(id, content)
                return content
            },

            getFileWithContent: async (id) => {
                const fileMeta = get().files.find(f => f.id === id)
                if (!fileMeta) return null

                const content = await get().loadFileContent(id)
                return { ...fileMeta, content }
            },

            getFileByPath: (path) => {
                const { files } = get()
                const normalizedPath = path.trim().toLowerCase()

                return files.find(f => {
                    const filePath = f.folder
                        ? `${f.folder}/${f.name}`.toLowerCase()
                        : f.name.toLowerCase()
                    return filePath === normalizedPath || f.name.toLowerCase() === normalizedPath
                })
            },

            getRandomLine: async (path) => {
                const fileMeta = get().getFileByPath(path)
                if (!fileMeta) return null

                const content = await get().loadFileContent(fileMeta.id)
                if (content.length === 0) return null

                const randomIndex = Math.floor(Math.random() * content.length)
                return content[randomIndex]
            },

            getSequentialLine: async (path) => {
                const fileMeta = get().getFileByPath(path)
                if (!fileMeta) return null

                const content = await get().loadFileContent(fileMeta.id)
                if (content.length === 0) return null

                const { sequentialCounters } = get()
                const currentIndex = sequentialCounters[path] || 0
                const line = content[currentIndex % content.length]

                // 카운터 증가
                set((state) => ({
                    sequentialCounters: {
                        ...state.sequentialCounters,
                        [path]: currentIndex + 1
                    }
                }))

                return line
            },

            resetSequentialCounter: (path) => {
                if (path) {
                    set((state) => {
                        const newCounters = { ...state.sequentialCounters }
                        delete newCounters[path]
                        return { sequentialCounters: newCounters }
                    })
                } else {
                    set({ sequentialCounters: {} })
                }
            },

            getFolders: () => {
                const { files } = get()
                const folders = new Set<string>()
                files.forEach(f => {
                    if (f.folder) folders.add(f.folder)
                })
                return Array.from(folders).sort()
            },

            getFilesInFolder: (folder) => {
                const { files } = get()
                return files.filter(f => f.folder === folder)
            },

            reorderFiles: (newFiles) => {
                set({ files: newFiles })
            },

            importFromText: async (name, text, folder = '') => {
                const lines = text
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && !line.startsWith('#'))

                return get().addFile(name, folder, lines)
            },

            exportToText: async (id) => {
                const content = await get().loadFileContent(id)
                if (!content || content.length === 0) return null
                return content.join('\n')
            },

            // 전체 내보내기 (폴더 구조 포함)
            exportAll: async () => {
                const { files, loadFileContent } = get()
                const contents: Record<string, string[]> = {}
                
                for (const file of files) {
                    contents[file.id] = await loadFileContent(file.id)
                }
                
                return { meta: files, contents }
            },

            // 전체 가져오기 (기존 데이터에 추가)
            importAll: async (data) => {
                const { addFile } = get()
                let importedCount = 0
                
                for (const meta of data.meta) {
                    const content = data.contents[meta.id] || []
                    await addFile(meta.name, meta.folder, content)
                    importedCount++
                }
                
                return importedCount
            },

            // 모든 데이터 삭제 (초기화)
            clearAll: async () => {
                await clearAllContent()
                contentCache.clear()
                set({
                    files: [],
                    sequentialCounters: {},
                    _migrated: true,
                    _initialized: true,
                })
                console.log('[FragmentStore] All data cleared')
            },

            // 기존 데이터 마이그레이션 (content가 메타데이터에 포함되어 있는 경우)
            _migrateOldData: async () => {
                const { files, _initialized } = get()
                if (_initialized) return

                // content 필드가 있는 파일만 마이그레이션 대상
                const filesToMigrate = files.filter((f: any) => Array.isArray(f.content))

                if (filesToMigrate.length > 0) {
                    console.log(`[FragmentStore] Migrating ${filesToMigrate.length} files to new storage format...`)

                    for (const file of filesToMigrate) {
                        const content = (file as any).content as string[]
                        if (content && content.length > 0) {
                            await saveContent(file.id, content)
                        }
                    }

                    // 메타데이터에서 content 제거하고 _migrated 플래그 설정
                    set((state) => ({
                        files: state.files.map((f: any) => {
                            const { content, ...meta } = f
                            return {
                                ...meta,
                                lineCount: Array.isArray(content) ? content.length : (meta.lineCount || 0)
                            }
                        }),
                        _initialized: true,
                        _migrated: true
                    }))

                    console.log('[FragmentStore] Migration complete')
                } else {
                    set({ _initialized: true })
                }
            },
        }),
        {
            // 기존 wildcard 데이터와 호환을 위해 storage 이름 유지
            name: 'nais2-wildcards',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                files: state.files,
                sequentialCounters: state.sequentialCounters,
                _migrated: state._migrated,  // 마이그레이션 완료 여부 저장
            }),
            onRehydrateStorage: () => (state) => {
                // 복원 후 마이그레이션 실행 (마이그레이션 안 됐을 때만)
                if (state && !state._migrated) {
                    state._migrateOldData()
                } else if (state) {
                    state._initialized = true
                }
            },
        }
    )
)

/**
 * 조각 프롬프트 경로 정규화
 * "folder/name" 또는 "name" 형식으로 변환
 */
export function normalizeFragmentPath(path: string): string {
    return path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}
