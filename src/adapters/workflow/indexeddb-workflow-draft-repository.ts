import type {
    CommitWorkflowDraftInput,
    CommitWorkflowDraftResult,
    WorkflowDraftRepositoryPort,
} from '@/application/workflow/workflow-draft-repository'
import {
    BATCH_IMAGE_DRAFT_SCHEMA_VERSION,
    SINGLE_IMAGE_DRAFT_SCHEMA_VERSION,
    WORKFLOW_DRAFT_STORE_KEY,
    isWorkflowDraft,
    type WorkflowDraft,
} from '@/domain/workflow/single-image-draft'
import {
    compareAndSetIndexedDBItem,
    getIndexedDBItemStrict,
} from '@/lib/indexed-db'

const WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION = 1 as const
const MAX_CAS_ATTEMPTS = 3

interface WorkflowDraftDocument {
    readonly schemaVersion: typeof WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION
    readonly drafts: readonly WorkflowDraft[]
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
    return { schemaVersion: WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION, drafts: [] }
}

function parseDocument(serialized: string | null): WorkflowDraftDocument {
    if (serialized === null) return emptyDocument()
    const parsed = JSON.parse(serialized) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new TypeError('Workflow draft repository document is invalid')
    }
    const value = parsed as { schemaVersion?: unknown; drafts?: unknown }
    if (value.schemaVersion !== WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION
        || !Array.isArray(value.drafts)
        || !value.drafts.every(isWorkflowDraft)
        || new Set(value.drafts.map(draft => draft.id)).size !== value.drafts.length) {
        throw new TypeError(
            `Unsupported workflow draft repository schema; single-image v${SINGLE_IMAGE_DRAFT_SCHEMA_VERSION} or batch-image v${BATCH_IMAGE_DRAFT_SCHEMA_VERSION} required`,
        )
    }
    return {
        schemaVersion: WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION,
        drafts: [...value.drafts],
    }
}

function serializeDocument(drafts: readonly WorkflowDraft[]): string {
    return JSON.stringify({
        schemaVersion: WORKFLOW_DRAFT_DOCUMENT_SCHEMA_VERSION,
        drafts: [...drafts].sort((left, right) => left.id.localeCompare(right.id)),
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
                serializeDocument(drafts),
            )) {
                return { status: 'committed', draft: cloneDraft(input.draft) }
            }
        }
        throw new Error('Workflow draft CAS remained contended after three attempts')
    }
}

let runtimeRepository: IndexedDbWorkflowDraftRepository | null = null

export function getWorkflowDraftRepository(): IndexedDbWorkflowDraftRepository {
    runtimeRepository ??= new IndexedDbWorkflowDraftRepository()
    return runtimeRepository
}
