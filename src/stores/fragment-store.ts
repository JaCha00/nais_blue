import { create } from 'zustand'
import {
    createJSONStorage,
    persist,
    type StateStorage,
} from 'zustand/middleware'

import type {
    FragmentDefinitionSnapshot,
    FragmentSequenceCommitProposal,
    FragmentSequenceSnapshot,
} from '@/domain/composition/fragment-resolver'
import { fnv1a64Utf8 } from '@/domain/composition/canonical-serialize'
import { indexedDBStorage } from '@/lib/indexed-db'

export const FRAGMENT_STORE_SCHEMA_VERSION = 2 as const
export const FRAGMENT_FILE_SCHEMA_VERSION = 2 as const
export const FRAGMENT_SEQUENCE_SCHEMA_VERSION = 1 as const

const CONTENT_DB_NAME = 'nais2-wildcard-content'
const CONTENT_STORE_NAME = 'contents'
const METADATA_STORAGE_NAME = 'nais2-wildcards'
const MAX_CACHE_SIZE = 20

export type FragmentId = string

/** Metadata stays small; fragment lines continue to live in the legacy content DB. */
export interface FragmentFileMeta {
    schemaVersion: typeof FRAGMENT_FILE_SCHEMA_VERSION
    id: FragmentId
    /** Explicit join key for the separate IndexedDB content record. */
    contentKey: string
    name: string
    folder: string
    lineCount: number
    createdAt: number
    updatedAt: number
}

export interface FragmentFile extends FragmentFileMeta {
    content: string[]
}

/** Canonical sequence state is keyed by stable fragment ID, not a mutable path. */
export interface FragmentSequenceState extends FragmentSequenceSnapshot {
    schemaVersion: typeof FRAGMENT_SEQUENCE_SCHEMA_VERSION
}

export interface FragmentExportBundle {
    schemaVersion: typeof FRAGMENT_STORE_SCHEMA_VERSION
    meta: FragmentFileMeta[]
    contents: Record<FragmentId, string[]>
}

export interface FragmentImportBundle {
    schemaVersion?: number
    meta: readonly unknown[]
    contents: Record<string, string[]>
}

export interface FragmentContentRepository {
    read(contentKey: string): Promise<string[] | null>
    write(contentKey: string, content: readonly string[]): Promise<void>
    remove(contentKey: string): Promise<void>
    clear(): Promise<void>
}

/**
 * Async store boundary used by compatibility facades. It materializes immutable
 * definitions before the pure Composition resolver is called.
 */
export interface FragmentLookupRepository {
    findMetadataByPath(path: string): FragmentFileMeta | undefined
    loadDefinitionByPath(path: string): Promise<FragmentDefinitionSnapshot | null>
    getSequenceSnapshot(): FragmentSequenceSnapshot
    commitSequenceProposal(proposal: FragmentSequenceCommitProposal | null): boolean
}

export type FragmentSequenceLeaseStatus = 'active' | 'committed' | 'released' | 'conflict'

/**
 * Signals that a fragment sequence mutation cannot start because a runtime
 * lease or another repository-backed mutation owns the sequence boundary.
 */
export class FragmentSequenceMutationLockedError extends Error {
    constructor() {
        super('Fragment sequence is locked by an active lease or mutation')
        this.name = 'FragmentSequenceMutationLockedError'
    }
}

/**
 * Runtime-only lease used to keep concurrent generation workers from publishing
 * results resolved from the same sequential-fragment snapshot. Acquiring a
 * lease never advances a counter; only commit() does.
 */
export interface FragmentSequenceLease {
    readonly status: FragmentSequenceLeaseStatus
    commit(): boolean
    release(): void
}

export interface FragmentState {
    schemaVersion: typeof FRAGMENT_STORE_SCHEMA_VERSION
    files: FragmentFileMeta[]

    /** Legacy path-keyed projection retained for old callers and old backups. */
    sequentialCounters: Record<string, number>
    sequenceState: FragmentSequenceState

    _initialized: boolean
    _migrated: boolean

    addFile: (name: string, folder?: string, content?: string[]) => Promise<FragmentFile>
    updateFile: (
        id: FragmentId,
        updates: Partial<Pick<FragmentFile, 'name' | 'folder' | 'content'>>,
    ) => Promise<void>
    deleteFile: (id: FragmentId) => Promise<void>
    duplicateFile: (id: FragmentId) => Promise<FragmentFile | null>

    loadFileContent: (id: FragmentId) => Promise<string[]>
    getFileWithContent: (id: FragmentId) => Promise<FragmentFile | null>

    getFileByPath: (path: string) => FragmentFileMeta | undefined
    resetSequentialCounter: (path?: string) => void
    getSequenceSnapshot: () => FragmentSequenceSnapshot
    commitSequenceProposal: (proposal: FragmentSequenceCommitProposal | null) => boolean
    reserveSequenceProposal: (proposal: FragmentSequenceCommitProposal | null) => FragmentSequenceLease | null
    getLookupRepository: () => FragmentLookupRepository

    getFolders: () => string[]
    getFilesInFolder: (folder: string) => FragmentFileMeta[]
    reorderFiles: (files: FragmentFileMeta[]) => void

    importFromText: (name: string, text: string, folder?: string) => Promise<FragmentFile>
    exportToText: (id: FragmentId) => Promise<string | null>
    exportAll: () => Promise<FragmentExportBundle>
    importAll: (data: FragmentImportBundle) => Promise<number>

    clearAll: () => Promise<void>
    _migrateOldData: () => Promise<void>
}

interface LegacyFragmentFileMeta extends Partial<FragmentFileMeta> {
    content?: unknown
}

export interface MigratedFragmentPersistedState {
    schemaVersion: typeof FRAGMENT_STORE_SCHEMA_VERSION
    files: Array<FragmentFileMeta & { content?: string[] }>
    sequentialCounters: Record<string, number>
    sequenceState: FragmentSequenceState
    _initialized: false
    _migrated: boolean
}

export interface CreateFragmentStoreOptions {
    contentRepository?: FragmentContentRepository
    metadataStorage?: StateStorage
    skipHydration?: boolean
    storageName?: string
}

let contentDbPromise: Promise<IDBDatabase> | null = null

function getContentDb(): Promise<IDBDatabase> {
    if (contentDbPromise === null) {
        contentDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(CONTENT_DB_NAME, 1)
            request.onupgradeneeded = event => {
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

export const indexedDbFragmentContentRepository: FragmentContentRepository = {
    async read(contentKey) {
        const db = await getContentDb()
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(CONTENT_STORE_NAME, 'readonly')
            const request = transaction.objectStore(CONTENT_STORE_NAME).get(contentKey)
            request.onsuccess = () => {
                const value: unknown = request.result
                resolve(Array.isArray(value) ? value.filter(line => typeof line === 'string') : null)
            }
            request.onerror = () => reject(request.error)
        })
    },

    async write(contentKey, content) {
        const db = await getContentDb()
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(CONTENT_STORE_NAME, 'readwrite')
            transaction.objectStore(CONTENT_STORE_NAME).put([...content], contentKey)
            transaction.oncomplete = () => resolve()
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error ?? new Error('Fragment content write aborted'))
        })
    },

    async remove(contentKey) {
        const db = await getContentDb()
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(CONTENT_STORE_NAME, 'readwrite')
            transaction.objectStore(CONTENT_STORE_NAME).delete(contentKey)
            transaction.oncomplete = () => resolve()
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error ?? new Error('Fragment content delete aborted'))
        })
    },

    async clear() {
        const db = await getContentDb()
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(CONTENT_STORE_NAME, 'readwrite')
            transaction.objectStore(CONTENT_STORE_NAME).clear()
            transaction.oncomplete = () => resolve()
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error ?? new Error('Fragment content clear aborted'))
        })
    },
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object'
        ? value as Record<string, unknown>
        : null
}

function safeTimestamp(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : 0
}

function safeCounter(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined
}

function normalizeCounterRecord(value: unknown): Record<string, number> {
    const record = asRecord(value)
    if (record === null) return {}

    const counters: Record<string, number> = {}
    for (const [key, candidate] of Object.entries(record)) {
        const counter = safeCounter(candidate)
        if (counter !== undefined) counters[key] = counter
    }
    return counters
}

function stableHash(value: string): string {
    let hash = 0x811c9dc5
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index)
        hash = Math.imul(hash ^ (code & 0xff), 0x01000193) >>> 0
        hash = Math.imul(hash ^ (code >>> 8), 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
}

function allocateFragmentId(
    preferredId: string | undefined,
    fingerprint: string,
    usedIds: ReadonlySet<string>,
): FragmentId {
    const preferred = preferredId?.trim()
    const base = preferred && preferred.length > 0
        ? preferred
        : `fragment:${stableHash(fingerprint)}`
    if (!usedIds.has(base)) return base

    let attempt = 1
    while (true) {
        const candidate = `${base}~${stableHash(`${fingerprint}:${attempt}`)}`
        if (!usedIds.has(candidate)) return candidate
        attempt += 1
    }
}

function normalizeEmbeddedContent(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    return value.filter(line => typeof line === 'string')
}

function basename(path: string): string {
    const segments = path.split('/')
    return segments[segments.length - 1] ?? path
}

export function normalizeFragmentPath(path: string): string {
    return path
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .replace(/\s*\/\s*/g, '/')
}

function normalizeLookupPath(path: string): string {
    return normalizeFragmentPath(path).toLowerCase()
}

export function getFragmentCanonicalPath(file: Pick<FragmentFileMeta, 'name' | 'folder'>): string {
    return normalizeFragmentPath(file.folder ? `${file.folder}/${file.name}` : file.name)
}

function findFileByPath(
    files: readonly FragmentFileMeta[],
    path: string,
): FragmentFileMeta | undefined {
    const normalizedPath = normalizeLookupPath(path)
    if (normalizedPath.length === 0) return undefined

    const exact = files.find(file => normalizeLookupPath(getFragmentCanonicalPath(file)) === normalizedPath)
    if (exact !== undefined) return exact

    return files.find(file => normalizeLookupPath(file.name) === normalizedPath)
}

function normalizedLegacyCounterMap(counters: Readonly<Record<string, number>>): Map<string, number> {
    const normalized = new Map<string, number>()
    for (const [path, counter] of Object.entries(counters)) {
        const key = normalizeLookupPath(path)
        if (key.length > 0 && !normalized.has(key)) normalized.set(key, counter)
    }
    return normalized
}

function assignLegacyCounters(
    files: readonly FragmentFileMeta[],
    counters: Readonly<Record<string, number>>,
    target: Record<FragmentId, number>,
): void {
    const normalizedCounters = normalizedLegacyCounterMap(counters)

    // Exact canonical paths and stable IDs win regardless of object order.
    for (const file of files) {
        if (target[file.id] !== undefined) continue
        const canonicalPath = getFragmentCanonicalPath(file)
        const exact = safeCounter(counters[canonicalPath])
            ?? safeCounter(counters[file.id])
            ?? normalizedCounters.get(normalizeLookupPath(canonicalPath))
            ?? normalizedCounters.get(normalizeLookupPath(file.id))
        if (exact !== undefined) target[file.id] = exact
    }

    // A basename alias belongs only to the same first-match file that legacy
    // lookup would have selected; it must never fan out to duplicate basenames.
    for (const [path, value] of Object.entries(counters)) {
        const counter = safeCounter(value)
        if (counter === undefined) continue
        const file = findFileByPath(files, path)
        if (file !== undefined && target[file.id] === undefined) target[file.id] = counter
    }
}

/**
 * Projects the persisted sequence revision and fragment metadata into the CAS
 * snapshot consumed by Composition. Durable batch planning reuses this pure
 * projection to simulate future commits without mutating the live store.
 */
export function projectFragmentSequenceSnapshot(
    state: Pick<FragmentState, 'files' | 'sequentialCounters' | 'sequenceState'>,
): FragmentSequenceSnapshot {
    const counters: Record<FragmentId, number> = {}
    for (const [fragmentId, value] of Object.entries(state.sequenceState.counters)) {
        const counter = safeCounter(value)
        if (counter !== undefined) counters[fragmentId] = counter
    }

    assignLegacyCounters(state.files, state.sequentialCounters, counters)
    for (const file of state.files) {
        if (counters[file.id] === undefined) counters[file.id] = 0
    }

    const metadataIdentity = [...state.files]
        .map(file => ({
            id: file.id,
            contentKey: file.contentKey || file.id,
            path: getFragmentCanonicalPath(file),
            updatedAt: file.updatedAt,
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    const revision = Number.parseInt(fnv1a64Utf8(JSON.stringify({
        sequenceRevision: safeCounter(state.sequenceState.revision) ?? 0,
        metadataIdentity,
    })).slice(-8), 16) >>> 0
    return {
        revision,
        counters,
    }
}

function bumpedSequenceState(
    state: Pick<FragmentState, 'files' | 'sequentialCounters' | 'sequenceState'>,
    counters: Record<FragmentId, number> = projectFragmentSequenceSnapshot(state).counters,
): FragmentSequenceState {
    return {
        schemaVersion: FRAGMENT_SEQUENCE_SCHEMA_VERSION,
        revision: (safeCounter(state.sequenceState.revision) ?? 0) + 1,
        counters,
    }
}

function metadataFromLegacy(
    rawValue: unknown,
    index: number,
    usedIds: Set<string>,
): (FragmentFileMeta & { content?: string[] }) | null {
    const raw = asRecord(rawValue) as (Record<string, unknown> & LegacyFragmentFileMeta) | null
    if (raw === null) return null

    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const folder = typeof raw.folder === 'string' ? normalizeFragmentPath(raw.folder) : ''
    const rawId = typeof raw.id === 'string' ? raw.id.trim() : undefined
    const fingerprint = `${rawId ?? 'missing'}:${folder}/${name}:${index}`
    const id = allocateFragmentId(rawId, fingerprint, usedIds)
    usedIds.add(id)

    const embeddedContent = normalizeEmbeddedContent(raw.content)
    const rawContentKey = typeof raw.contentKey === 'string' && raw.contentKey.trim().length > 0
        ? raw.contentKey.trim()
        : rawId
    const contentKey = rawContentKey && rawContentKey.length > 0 ? rawContentKey : id
    const lineCount = safeCounter(raw.lineCount) ?? embeddedContent?.length ?? 0

    return {
        schemaVersion: FRAGMENT_FILE_SCHEMA_VERSION,
        id,
        contentKey,
        name,
        folder,
        lineCount,
        createdAt: safeTimestamp(raw.createdAt),
        updatedAt: safeTimestamp(raw.updatedAt),
        ...(embeddedContent === undefined ? {} : { content: embeddedContent }),
    }
}

/** Pure migration used by Zustand hydration and migration fixtures. */
export function migrateFragmentPersistedState(value: unknown): MigratedFragmentPersistedState {
    const raw = asRecord(value) ?? {}
    const rawFiles = Array.isArray(raw.files) ? raw.files : []
    const usedIds = new Set<string>()
    const files = rawFiles
        .map((file, index) => metadataFromLegacy(file, index, usedIds))
        .filter((file): file is FragmentFileMeta & { content?: string[] } => file !== null)
    const sequentialCounters = normalizeCounterRecord(raw.sequentialCounters)
    const rawSequence = asRecord(raw.sequenceState)
    const sequenceCounters = normalizeCounterRecord(rawSequence?.counters)
    assignLegacyCounters(files, sequentialCounters, sequenceCounters)

    const hasEmbeddedContent = files.some(file => file.content !== undefined)
    return {
        schemaVersion: FRAGMENT_STORE_SCHEMA_VERSION,
        files,
        sequentialCounters,
        sequenceState: {
            schemaVersion: FRAGMENT_SEQUENCE_SCHEMA_VERSION,
            revision: safeCounter(rawSequence?.revision) ?? 0,
            counters: sequenceCounters,
        },
        _initialized: false,
        _migrated: !hasEmbeddedContent,
    }
}

function stripEmbeddedContent(file: FragmentFileMeta & { content?: string[] }): FragmentFileMeta {
    return {
        schemaVersion: FRAGMENT_FILE_SCHEMA_VERSION,
        id: file.id,
        contentKey: file.contentKey,
        name: file.name,
        folder: file.folder,
        lineCount: file.lineCount,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
    }
}

function removeLegacyCounterAliases(
    counters: Record<string, number>,
    file: FragmentFileMeta,
    remainingFiles: readonly FragmentFileMeta[],
): void {
    const canonicalPath = getFragmentCanonicalPath(file)
    delete counters[canonicalPath]
    delete counters[file.id]

    const fileBasename = basename(canonicalPath)
    const basenameStillUsed = remainingFiles.some(candidate => (
        normalizeLookupPath(candidate.name) === normalizeLookupPath(fileBasename)
    ))
    if (!basenameStillUsed) delete counters[fileBasename]

    for (const key of Object.keys(counters)) {
        const normalized = normalizeLookupPath(key)
        if (
            normalized === normalizeLookupPath(canonicalPath)
            || normalized === normalizeLookupPath(file.id)
            || (!basenameStillUsed && normalized === normalizeLookupPath(fileBasename))
        ) {
            delete counters[key]
        }
    }
}

export function createFragmentStore(
    options: CreateFragmentStoreOptions = {},
) {
    const contentRepository = options.contentRepository ?? indexedDbFragmentContentRepository
    const metadataStorage = options.metadataStorage ?? indexedDBStorage
    const contentCache = new Map<string, string[]>()
    let creationOrdinal = 0
    let activeSequenceLease: symbol | null = null
    let activeSequenceMutation: symbol | null = null

    // Repository writes and sequence leases share this runtime-only exclusion
    // boundary. Holding the token across async IO prevents a proposal from
    // observing metadata before its corresponding content mutation completes.
    const acquireSequenceMutation = (): symbol => {
        if (activeSequenceLease !== null || activeSequenceMutation !== null) {
            throw new FragmentSequenceMutationLockedError()
        }
        const token = Symbol('fragment-sequence-mutation')
        activeSequenceMutation = token
        return token
    }

    const releaseSequenceMutation = (token: symbol): void => {
        if (activeSequenceMutation === token) activeSequenceMutation = null
    }

    const assertSequenceMutationAvailable = (): void => {
        if (activeSequenceLease !== null || activeSequenceMutation !== null) {
            throw new FragmentSequenceMutationLockedError()
        }
    }

    const cacheContent = (contentKey: string, content: readonly string[]): void => {
        if (contentCache.has(contentKey)) contentCache.delete(contentKey)
        if (contentCache.size >= MAX_CACHE_SIZE) {
            const firstKey = contentCache.keys().next().value
            if (typeof firstKey === 'string') contentCache.delete(firstKey)
        }
        contentCache.set(contentKey, [...content])
    }

    return create<FragmentState>()(
        persist(
            (set, get) => ({
                schemaVersion: FRAGMENT_STORE_SCHEMA_VERSION,
                files: [],
                sequentialCounters: {},
                sequenceState: {
                    schemaVersion: FRAGMENT_SEQUENCE_SCHEMA_VERSION,
                    revision: 0,
                    counters: {},
                },
                _initialized: false,
                _migrated: true,

                addFile: async (name, folder = '', content = []) => {
                    const mutationToken = acquireSequenceMutation()
                    try {
                        const timestamp = Date.now()
                        const normalizedName = name.trim()
                        const normalizedFolder = normalizeFragmentPath(folder)
                        const usedIds = new Set(get().files.map(file => file.id))
                        const id = allocateFragmentId(
                            undefined,
                            `new:${timestamp}:${creationOrdinal}:${normalizedFolder}/${normalizedName}`,
                            usedIds,
                        )
                        creationOrdinal += 1
                        await contentRepository.write(id, content)
                        cacheContent(id, content)

                        const newFileMeta: FragmentFileMeta = {
                            schemaVersion: FRAGMENT_FILE_SCHEMA_VERSION,
                            id,
                            contentKey: id,
                            name: normalizedName,
                            folder: normalizedFolder,
                            lineCount: content.length,
                            createdAt: timestamp,
                            updatedAt: timestamp,
                        }
                        set(state => ({
                            files: [...state.files, newFileMeta],
                            sequenceState: bumpedSequenceState(state),
                        }))
                        return { ...newFileMeta, content: [...content] }
                    } finally {
                        releaseSequenceMutation(mutationToken)
                    }
                },

                updateFile: async (id, updates) => {
                    const mutationToken = acquireSequenceMutation()
                    try {
                        const before = get().files.find(file => file.id === id)
                        if (before === undefined) return

                        if (updates.content !== undefined) {
                            // Copy-on-write detaches metadata that shared a legacy content key.
                            await contentRepository.write(id, updates.content)
                            cacheContent(id, updates.content)
                        }

                        set(state => {
                            const current = state.files.find(file => file.id === id)
                            if (current === undefined) return {}
                            const nextFiles = state.files.map(file => file.id === id
                                ? {
                                    ...file,
                                    schemaVersion: FRAGMENT_FILE_SCHEMA_VERSION,
                                    contentKey: updates.content === undefined ? file.contentKey : id,
                                    name: updates.name === undefined ? file.name : updates.name.trim(),
                                    folder: updates.folder === undefined
                                        ? file.folder
                                        : normalizeFragmentPath(updates.folder),
                                    lineCount: updates.content === undefined
                                        ? file.lineCount
                                        : updates.content.length,
                                    updatedAt: Date.now(),
                                }
                                : file)
                            const stableCounters = { ...projectFragmentSequenceSnapshot(state).counters }
                            const sequentialCounters = { ...state.sequentialCounters }
                            const nextFile = nextFiles.find(file => file.id === id)
                            const pathChanged = nextFile !== undefined && (
                                getFragmentCanonicalPath(nextFile) !== getFragmentCanonicalPath(current)
                            )
                            if (pathChanged && nextFile !== undefined) {
                                removeLegacyCounterAliases(
                                    sequentialCounters,
                                    current,
                                    nextFiles.filter(file => file.id !== id),
                                )
                                sequentialCounters[getFragmentCanonicalPath(nextFile)] = stableCounters[id] ?? 0
                            }
                            return {
                                files: nextFiles,
                                sequentialCounters,
                                sequenceState: bumpedSequenceState(state, stableCounters),
                            }
                        })
                    } finally {
                        releaseSequenceMutation(mutationToken)
                    }
                },

                deleteFile: async id => {
                    const mutationToken = acquireSequenceMutation()
                    try {
                        const stateBefore = get()
                        const file = stateBefore.files.find(candidate => candidate.id === id)
                        if (file === undefined) return
                        const contentKey = file.contentKey || file.id
                        const contentKeyIsShared = stateBefore.files.some(candidate => (
                            candidate.id !== id && (candidate.contentKey || candidate.id) === contentKey
                        ))
                        if (!contentKeyIsShared) {
                            await contentRepository.remove(contentKey)
                            contentCache.delete(contentKey)
                        }

                        set(state => {
                            const current = state.files.find(candidate => candidate.id === id)
                            if (current === undefined) return {}
                            const files = state.files.filter(candidate => candidate.id !== id)
                            const counters = { ...projectFragmentSequenceSnapshot(state).counters }
                            delete counters[id]
                            const sequentialCounters = { ...state.sequentialCounters }
                            removeLegacyCounterAliases(sequentialCounters, current, files)
                            return {
                                files,
                                sequentialCounters,
                                sequenceState: bumpedSequenceState(state, counters),
                            }
                        })
                    } finally {
                        releaseSequenceMutation(mutationToken)
                    }
                },

                duplicateFile: async id => {
                    const file = get().files.find(candidate => candidate.id === id)
                    if (file === undefined) return null
                    const content = await get().loadFileContent(id)
                    return get().addFile(`${file.name}_copy`, file.folder, content)
                },

                loadFileContent: async id => {
                    const file = get().files.find(candidate => candidate.id === id) as
                        | (FragmentFileMeta & { content?: string[] })
                        | undefined
                    if (file === undefined) return []
                    const contentKey = file.contentKey || file.id
                    const cached = contentCache.get(contentKey)
                    if (cached !== undefined) return [...cached]

                    const stored = await contentRepository.read(contentKey)
                    if (stored !== null) {
                        cacheContent(contentKey, stored)
                        return [...stored]
                    }

                    const embedded = normalizeEmbeddedContent(file.content)
                    if (embedded !== undefined) return embedded
                    return []
                },

                getFileWithContent: async id => {
                    const file = get().files.find(candidate => candidate.id === id)
                    if (file === undefined) return null
                    const content = await get().loadFileContent(id)
                    const latest = get().files.find(candidate => candidate.id === id)
                    return latest === undefined ? null : { ...latest, content }
                },

                getFileByPath: path => findFileByPath(get().files, path),

                resetSequentialCounter: path => {
                    assertSequenceMutationAvailable()
                    set(state => {
                        if (path === undefined) {
                            if (
                                Object.keys(state.sequentialCounters).length === 0
                                && Object.keys(state.sequenceState.counters).length === 0
                            ) return {}
                            return {
                                sequentialCounters: {},
                                sequenceState: bumpedSequenceState(state, {}),
                            }
                        }

                        const file = findFileByPath(state.files, path)
                        const stableCounters = { ...projectFragmentSequenceSnapshot(state).counters }
                        const legacyCounters = { ...state.sequentialCounters }
                        let changed = false
                        if (file !== undefined) {
                            if (stableCounters[file.id] !== undefined) {
                                delete stableCounters[file.id]
                                changed = true
                            }
                            const beforeSize = Object.keys(legacyCounters).length
                            removeLegacyCounterAliases(
                                legacyCounters,
                                file,
                                state.files.filter(candidate => candidate.id !== file.id),
                            )
                            changed = changed || Object.keys(legacyCounters).length !== beforeSize
                        } else {
                            const normalized = normalizeLookupPath(path)
                            for (const key of Object.keys(legacyCounters)) {
                                if (normalizeLookupPath(key) === normalized) {
                                    delete legacyCounters[key]
                                    changed = true
                                }
                            }
                        }
                        if (!changed) return {}
                        return {
                            sequentialCounters: legacyCounters,
                            sequenceState: bumpedSequenceState(state, stableCounters),
                        }
                    })
                },

                getSequenceSnapshot: () => projectFragmentSequenceSnapshot(get()),

                commitSequenceProposal: proposal => {
                    if (proposal === null || proposal.changes.length === 0) return true
                    // A worker holding the runtime lease depends on this CAS
                    // state until OutputWriter publishes its result. Direct
                    // callers must wait instead of invalidating paid work.
                    if (activeSequenceLease !== null || activeSequenceMutation !== null) return false
                    let committed = false
                    set(state => {
                        const snapshot = projectFragmentSequenceSnapshot(state)
                        if (snapshot.revision !== proposal.expectedRevision) return {}
                        for (const change of proposal.changes) {
                            const current = snapshot.counters[change.fragmentId] ?? 0
                            if (current !== change.expectedCounter) return {}
                        }

                        const stableCounters = { ...snapshot.counters }
                        const legacyCounters = { ...state.sequentialCounters }
                        for (const change of proposal.changes) {
                            stableCounters[change.fragmentId] = change.nextCounter
                            const file = state.files.find(candidate => candidate.id === change.fragmentId)
                            const canonicalPath = file === undefined
                                ? normalizeFragmentPath(change.fragmentPath)
                                : getFragmentCanonicalPath(file)
                            if (file !== undefined) {
                                removeLegacyCounterAliases(
                                    legacyCounters,
                                    file,
                                    state.files.filter(candidate => candidate.id !== file.id),
                                )
                            }
                            legacyCounters[canonicalPath] = change.nextCounter
                        }
                        committed = true
                        return {
                            sequentialCounters: legacyCounters,
                            sequenceState: bumpedSequenceState(state, stableCounters),
                        }
                    })
                    return committed
                },

                reserveSequenceProposal: proposal => {
                    if (proposal === null || proposal.changes.length === 0) {
                        let status: FragmentSequenceLeaseStatus = 'active'
                        return {
                            get status() {
                                return status
                            },
                            commit() {
                                if (status !== 'active') return false
                                status = 'committed'
                                return true
                            },
                            release() {
                                if (status === 'active') status = 'released'
                            },
                        }
                    }

                    // A no-op proposal above owns no sequence state. Only a real
                    // CAS proposal must wait for repository-backed mutations.
                    if (activeSequenceMutation !== null) return null
                    if (activeSequenceLease !== null) return null
                    const snapshot = get().getSequenceSnapshot()
                    if (snapshot.revision !== proposal.expectedRevision) return null
                    for (const change of proposal.changes) {
                        if ((snapshot.counters[change.fragmentId] ?? 0) !== change.expectedCounter) {
                            return null
                        }
                    }

                    const token = Symbol('fragment-sequence-lease')
                    activeSequenceLease = token
                    let status: FragmentSequenceLeaseStatus = 'active'
                    const releaseToken = (): void => {
                        if (activeSequenceLease === token) activeSequenceLease = null
                    }
                    return {
                        get status() {
                            return status
                        },
                        commit() {
                            if (status !== 'active' || activeSequenceLease !== token) return false
                            // Release the exclusion token only for the synchronous
                            // owner commit; competing JavaScript work cannot enter
                            // between these statements.
                            activeSequenceLease = null
                            const committed = get().commitSequenceProposal(proposal)
                            status = committed ? 'committed' : 'conflict'
                            releaseToken()
                            return committed
                        },
                        release() {
                            if (status !== 'active') return
                            status = 'released'
                            releaseToken()
                        },
                    }
                },

                getLookupRepository: () => ({
                    findMetadataByPath: path => get().getFileByPath(path),
                    loadDefinitionByPath: async path => {
                        const before = get().getFileByPath(path)
                        if (before === undefined) return null
                        const beforeContentKey = before.contentKey || before.id
                        const content = await get().loadFileContent(before.id)
                        const after = get().getFileByPath(path)
                        if (
                            after === undefined
                            || after.id !== before.id
                            || (after.contentKey || after.id) !== beforeContentKey
                            || after.updatedAt !== before.updatedAt
                        ) return null
                        return {
                            id: after.id,
                            path: getFragmentCanonicalPath(after),
                            lines: content,
                        }
                    },
                    getSequenceSnapshot: () => get().getSequenceSnapshot(),
                    commitSequenceProposal: proposal => get().commitSequenceProposal(proposal),
                }),

                getFolders: () => [...new Set(
                    get().files.map(file => file.folder).filter(folder => folder.length > 0),
                )].sort(),

                getFilesInFolder: folder => get().files.filter(file => file.folder === folder),

                reorderFiles: files => {
                    assertSequenceMutationAvailable()
                    set(state => ({
                        files: [...files],
                        sequenceState: bumpedSequenceState(state),
                    }))
                },

                importFromText: async (name, text, folder = '') => {
                    const lines = text
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0 && !line.startsWith('#'))
                    return get().addFile(name, folder, lines)
                },

                exportToText: async id => {
                    const content = await get().loadFileContent(id)
                    return content.length === 0 ? null : content.join('\n')
                },

                exportAll: async () => {
                    const files = get().files
                    const contents: Record<FragmentId, string[]> = {}
                    for (const file of files) {
                        contents[file.id] = await get().loadFileContent(file.id)
                    }
                    return {
                        schemaVersion: FRAGMENT_STORE_SCHEMA_VERSION,
                        meta: files.map(file => ({ ...file })),
                        contents,
                    }
                },

                importAll: async data => {
                    const mutationToken = acquireSequenceMutation()
                    try {
                        if (!Array.isArray(data.meta) || asRecord(data.contents) === null) return 0
                        const usedIds = new Set(get().files.map(file => file.id))
                        let importedCount = 0

                        for (let index = 0; index < data.meta.length; index += 1) {
                            const raw = asRecord(data.meta[index])
                            if (raw === null) continue
                            const name = typeof raw.name === 'string' ? raw.name.trim() : ''
                            const folder = typeof raw.folder === 'string'
                                ? normalizeFragmentPath(raw.folder)
                                : ''
                            const sourceId = typeof raw.id === 'string' && raw.id.trim().length > 0
                                ? raw.id.trim()
                                : undefined
                            const id = allocateFragmentId(
                                sourceId,
                                `import:${sourceId ?? 'missing'}:${folder}/${name}:${index}`,
                                usedIds,
                            )
                            usedIds.add(id)
                            const sourceContentKey = typeof raw.contentKey === 'string'
                                ? raw.contentKey
                                : undefined
                            const rawContent = (sourceId === undefined ? undefined : data.contents[sourceId])
                                ?? (sourceContentKey === undefined ? undefined : data.contents[sourceContentKey])
                                ?? []
                            const content = Array.isArray(rawContent)
                                ? rawContent.filter(line => typeof line === 'string')
                                : []
                            await contentRepository.write(id, content)
                            cacheContent(id, content)

                            const timestamp = Date.now()
                            const file: FragmentFileMeta = {
                                schemaVersion: FRAGMENT_FILE_SCHEMA_VERSION,
                                id,
                                contentKey: id,
                                name,
                                folder,
                                lineCount: content.length,
                                createdAt: safeTimestamp(raw.createdAt) || timestamp,
                                updatedAt: safeTimestamp(raw.updatedAt) || timestamp,
                            }
                            set(state => ({
                                files: [...state.files, file],
                                sequenceState: bumpedSequenceState(state),
                            }))
                            importedCount += 1
                        }
                        return importedCount
                    } finally {
                        releaseSequenceMutation(mutationToken)
                    }
                },

                clearAll: async () => {
                    const mutationToken = acquireSequenceMutation()
                    try {
                        await contentRepository.clear()
                        contentCache.clear()
                        set(state => ({
                            schemaVersion: FRAGMENT_STORE_SCHEMA_VERSION,
                            files: [],
                            sequentialCounters: {},
                            sequenceState: bumpedSequenceState(state, {}),
                            _migrated: true,
                            _initialized: true,
                        }))
                    } finally {
                        releaseSequenceMutation(mutationToken)
                    }
                },

                _migrateOldData: async () => {
                    const state = get()
                    if (state._initialized) return
                    const legacyFiles = state.files as Array<FragmentFileMeta & { content?: string[] }>
                    const filesWithEmbeddedContent = legacyFiles.filter(file => file.content !== undefined)

                    for (const file of filesWithEmbeddedContent) {
                        const content = normalizeEmbeddedContent(file.content) ?? []
                        const contentKey = file.contentKey || file.id
                        const separatelyStored = await contentRepository.read(contentKey)
                        if (separatelyStored === null) {
                            await contentRepository.write(contentKey, content)
                            cacheContent(contentKey, content)
                        } else {
                            // A mixed legacy store may contain a stale embedded
                            // copy beside newer IndexedDB content. The existing
                            // separate record is authoritative and must survive.
                            cacheContent(contentKey, separatelyStored)
                        }
                    }

                    set(current => ({
                        files: (current.files as Array<FragmentFileMeta & { content?: string[] }>)
                            .map(stripEmbeddedContent),
                        _initialized: true,
                        _migrated: true,
                    }))
                },
            }),
            {
                name: options.storageName ?? METADATA_STORAGE_NAME,
                storage: createJSONStorage(() => metadataStorage),
                version: FRAGMENT_STORE_SCHEMA_VERSION,
                migrate: persistedState => migrateFragmentPersistedState(persistedState) as unknown as FragmentState,
                partialize: state => ({
                    schemaVersion: state.schemaVersion,
                    files: state.files,
                    sequentialCounters: state.sequentialCounters,
                    sequenceState: state.sequenceState,
                    _migrated: state._migrated,
                }),
                skipHydration: options.skipHydration ?? false,
                onRehydrateStorage: () => state => {
                    if (state === undefined) return
                    void state._migrateOldData().catch(error => {
                        console.error('[FragmentStore] Legacy content migration failed', error)
                    })
                },
            },
        ),
    )
}

export const useFragmentStore = createFragmentStore()
