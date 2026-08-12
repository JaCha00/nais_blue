import type {
    CommitWorkflowDraftInput,
    CommitWorkflowDraftResult,
    MoveWorkflowDraftToTrashResult,
    RestoreWorkflowDraftResult,
    TrashedWorkflowDraft,
    WorkflowDraftRepositoryPort,
} from '@/application/workflow/workflow-draft-repository'
import {
    BATCH_IMAGE_DRAFT_SCHEMA_VERSION,
    SINGLE_IMAGE_DRAFT_SCHEMA_VERSION,
    WORKFLOW_DRAFT_STORE_KEY,
    isWorkflowDraft,
    migrateWorkflowDraft,
    type WorkflowDraft,
} from '@/domain/workflow/single-image-draft'
import {
    compareAndSetIndexedDBItem,
    getIndexedDBItemStrict,
} from '@/lib/indexed-db'

const WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION = 1 as const
const MAX_CAS_ATTEMPTS = 3
const WORKFLOW_DRAFT_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

interface WorkflowDraftDocument {
    readonly schemaVersion: typeof WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION
    readonly drafts: readonly WorkflowDraft[]
    readonly trash: readonly TrashedWorkflowDraft[]
}

export interface WorkflowDraftPersistencePort {
    getItem(key: string): Promise<string | null>
    compareAndSet(key: string, expected: string | null, next: string): Promise<boolean>
}

const indexedDbPersistence: WorkflowDraftPersistencePort = {
    getItem: getIndexedDBItemStrict,
    compareAndSet: (key, expected, next) => compareAndSetIndexedDBItem(key, expected, next),
}

function emptyDocument(): WorkflowDraftDocument {
    return { schemaVersion: WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION, drafts: [], trash: [] }
}

function isTrashedWorkflowDraft(value: unknown): value is TrashedWorkflowDraft {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const item = value as { draft?: unknown; deletedAt?: unknown; expiresAt?: unknown }
    return isWorkflowDraft(item.draft)
        && typeof item.deletedAt === 'number'
        && Number.isSafeInteger(item.deletedAt)
        && typeof item.expiresAt === 'number'
        && Number.isSafeInteger(item.expiresAt)
        && item.expiresAt > item.deletedAt
}

function parseDocument(serialized: string | null): WorkflowDraftDocument {
    if (serialized === null) return emptyDocument()
    const parsed = JSON.parse(serialized) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new TypeError('Workflow draft repository document is invalid')
    }
    const value = parsed as { schemaVersion?: unknown; drafts?: unknown; trash?: unknown }
    const drafts = Array.isArray(value.drafts)
        ? value.drafts.map(migrateWorkflowDraft)
        : []
    const trash = Array.isArray(value.trash)
        ? value.trash.map(item => {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
            const record = item as { draft?: unknown }
            return { ...item, draft: migrateWorkflowDraft(record.draft) }
        })
        : []
    if (value.schemaVersion !== WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION
        || !Array.isArray(value.drafts)
        || !drafts.every(isWorkflowDraft)
        || !trash.every(isTrashedWorkflowDraft)
        || new Set(drafts.map(draft => draft.id)).size !== drafts.length
        || new Set(trash.map(item => item.draft.id)).size !== trash.length
        || drafts.some(draft => trash.some(item => item.draft.id === draft.id))) {
        throw new TypeError(
            `Unsupported workflow draft repository schema; single-image v${SINGLE_IMAGE_DRAFT_SCHEMA_VERSION} or batch-image v${BATCH_IMAGE_DRAFT_SCHEMA_VERSION} required`,
        )
    }
    return {
        schemaVersion: WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION,
        drafts: [...drafts],
        trash: [...trash],
    }
}

function serializeDocument(document: Pick<WorkflowDraftDocument, 'drafts' | 'trash'>): string {
    return JSON.stringify({
        schemaVersion: WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION,
        drafts: [...document.drafts].sort((left, right) => left.id.localeCompare(right.id)),
        trash: [...document.trash].sort((left, right) => left.draft.id.localeCompare(right.draft.id)),
    } satisfies WorkflowDraftDocument)
}

function cloneDraft(draft: WorkflowDraft): WorkflowDraft {
    return structuredClone(draft)
}

/**
 * Stores the small authoritative draft document in the shared strict key-value
 * database. Whole-document CAS prevents two tabs or autosave flushes from
 * silently replacing a newer revision without adding another database.
 */
export class IndexedDbWorkflowDraftRepository implements WorkflowDraftRepositoryPort {
    constructor(
        private readonly persistence: WorkflowDraftPersistencePort = indexedDbPersistence,
        private readonly storageKey = WORKFLOW_DRAFT_STORE_KEY,
    ) {}

    async get(id: string): Promise<WorkflowDraft | null> {
        const document = parseDocument(await this.persistence.getItem(this.storageKey))
        const draft = document.drafts.find(candidate => candidate.id === id)
        return draft === undefined ? null : cloneDraft(draft)
    }

    async list(): Promise<readonly WorkflowDraft[]> {
        const document = parseDocument(await this.persistence.getItem(this.storageKey))
        return document.drafts
            .map(cloneDraft)
            .sort((left, right) => (
                Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
                || left.id.localeCompare(right.id)
            ))
    }

    async commit(input: CommitWorkflowDraftInput): Promise<CommitWorkflowDraftResult> {
        const expectedRevision = input.expectedRevision
        if ((expectedRevision !== null
                && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))
            || !isWorkflowDraft(input.draft)
            || input.draft.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)) {
            throw new TypeError('Workflow draft CAS input is invalid')
        }

        for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
            const serialized = await this.persistence.getItem(this.storageKey)
            const document = parseDocument(serialized)
            const index = document.drafts.findIndex(candidate => candidate.id === input.draft.id)
            const current = index === -1 ? null : document.drafts[index]
            if ((expectedRevision === null && current !== null)
                || (expectedRevision !== null && current?.revision !== expectedRevision)) {
                return {
                    status: 'conflict',
                    current: current === null ? null : cloneDraft(current),
                }
            }

            const drafts = [...document.drafts]
            if (index === -1) drafts.push(input.draft)
            else drafts[index] = input.draft
            if (await this.persistence.compareAndSet(
                this.storageKey,
                serialized,
                serializeDocument({ drafts, trash: document.trash }),
            )) {
                return { status: 'committed', draft: cloneDraft(input.draft) }
            }
        }
        throw new Error('Workflow draft CAS remained contended after three attempts')
    }

    async moveToTrash(
        id: string,
        expectedRevision: number,
        deletedAt: number,
    ): Promise<MoveWorkflowDraftToTrashResult> {
        if (!id || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
            || !Number.isSafeInteger(deletedAt) || deletedAt < 0) {
            throw new TypeError('Workflow draft trash input is invalid')
        }
        for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
            const serialized = await this.persistence.getItem(this.storageKey)
            const document = parseDocument(serialized)
            const current = document.drafts.find(draft => draft.id === id) ?? null
            if (current?.revision !== expectedRevision) {
                return { status: 'conflict', current: current === null ? null : cloneDraft(current) }
            }
            const item: TrashedWorkflowDraft = {
                draft: cloneDraft(current),
                deletedAt,
                expiresAt: deletedAt + WORKFLOW_DRAFT_TRASH_RETENTION_MS,
            }
            if (await this.persistence.compareAndSet(this.storageKey, serialized, serializeDocument({
                drafts: document.drafts.filter(draft => draft.id !== id),
                trash: [item, ...document.trash.filter(candidate => candidate.draft.id !== id)],
            }))) return { status: 'trashed', item: structuredClone(item) }
        }
        throw new Error('Workflow draft trash CAS remained contended after three attempts')
    }

    async listTrash(): Promise<readonly TrashedWorkflowDraft[]> {
        const document = parseDocument(await this.persistence.getItem(this.storageKey))
        return document.trash
            .map(item => structuredClone(item))
            .sort((left, right) => right.deletedAt - left.deletedAt || left.draft.id.localeCompare(right.draft.id))
    }

    async restoreFromTrash(id: string): Promise<RestoreWorkflowDraftResult> {
        for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
            const serialized = await this.persistence.getItem(this.storageKey)
            const document = parseDocument(serialized)
            const item = document.trash.find(candidate => candidate.draft.id === id)
            if (!item) return { status: 'missing' }
            if (document.drafts.some(draft => draft.id === id)) return { status: 'conflict' }
            if (await this.persistence.compareAndSet(this.storageKey, serialized, serializeDocument({
                drafts: [...document.drafts, item.draft],
                trash: document.trash.filter(candidate => candidate.draft.id !== id),
            }))) return { status: 'restored', draft: cloneDraft(item.draft) }
        }
        throw new Error('Workflow draft restore CAS remained contended after three attempts')
    }

    async permanentlyDeleteFromTrash(id: string): Promise<boolean> {
        for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
            const serialized = await this.persistence.getItem(this.storageKey)
            const document = parseDocument(serialized)
            if (!document.trash.some(item => item.draft.id === id)) return false
            if (await this.persistence.compareAndSet(this.storageKey, serialized, serializeDocument({
                drafts: document.drafts,
                trash: document.trash.filter(item => item.draft.id !== id),
            }))) return true
        }
        throw new Error('Workflow draft purge CAS remained contended after three attempts')
    }

    async pruneExpiredTrash(now: number): Promise<number> {
        if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Workflow draft trash prune time is invalid')
        for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
            const serialized = await this.persistence.getItem(this.storageKey)
            const document = parseDocument(serialized)
            const trash = document.trash.filter(item => item.expiresAt > now)
            const removed = document.trash.length - trash.length
            if (removed === 0) return 0
            if (await this.persistence.compareAndSet(this.storageKey, serialized, serializeDocument({
                drafts: document.drafts,
                trash,
            }))) return removed
        }
        throw new Error('Workflow draft trash prune CAS remained contended after three attempts')
    }
}

let runtimeRepository: IndexedDbWorkflowDraftRepository | null = null

export function getWorkflowDraftRepository(): IndexedDbWorkflowDraftRepository {
    runtimeRepository ??= new IndexedDbWorkflowDraftRepository()
    return runtimeRepository
}
