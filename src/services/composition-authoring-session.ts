import { compositionDocumentHash } from '@/domain/composition/repository'
import { parseCompositionDocument } from '@/domain/composition/schema'
import type { CompositionDocument } from '@/domain/composition/types'

export interface CompositionAuthoringRepositorySnapshot {
    revision: number
    document: CompositionDocument
}

export type CompositionAuthoringCommand = (
    draft: CompositionDocument,
) => CompositionDocument

export interface CompositionAuthoringConflict {
    baseRevision: number
    externalRevision: number
    base: CompositionDocument
    local: CompositionDocument
    external: CompositionDocument
}

export interface CompositionAuthoringCommitRequest<TChangeSet> {
    expectedRevision: number
    base: CompositionDocument
    draft: CompositionDocument
    changeSet: TChangeSet
}

export type CompositionAuthoringCommitResult =
    | {
        status: 'committed'
        snapshot: CompositionAuthoringRepositorySnapshot
    }
    | {
        status: 'stale'
        external: CompositionAuthoringRepositorySnapshot
    }

export interface CompositionAuthoringSessionDependencies<TChangeSet> {
    loadDocument: () => Promise<CompositionAuthoringRepositorySnapshot>
    createChangeSet: (
        base: CompositionDocument,
        draft: CompositionDocument,
    ) => TChangeSet
    commitDocument: (
        request: CompositionAuthoringCommitRequest<TChangeSet>,
    ) => Promise<CompositionAuthoringCommitResult>
}

export type CompositionAuthoringSessionStatus =
    | 'unloaded'
    | 'loading'
    | 'ready'
    | 'committing'
    | 'conflict'
    | 'error'

export interface CompositionAuthoringSessionState {
    status: CompositionAuthoringSessionStatus
    baseRevision: number | null
    baseDocument: CompositionDocument | null
    draftDocument: CompositionDocument | null
    dirty: boolean
    canUndo: boolean
    canRedo: boolean
    conflict: CompositionAuthoringConflict | null
    lastError: string | null
}

export type CompositionAuthoringConflictResolution =
    | { strategy: 'external' }
    | { strategy: 'local' }
    | { strategy: 'merged'; document: CompositionDocument }

export type CompositionAuthoringSessionListener = (
    state: CompositionAuthoringSessionState,
) => void

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function assertRevision(revision: number): void {
    if (!Number.isInteger(revision) || revision < 0) {
        throw new Error(`Composition repository revision is invalid: ${revision}`)
    }
}

function cloneDocument(document: CompositionDocument): CompositionDocument {
    return parseCompositionDocument(JSON.parse(JSON.stringify(document)) as unknown)
}

function cloneSnapshot(
    snapshot: CompositionAuthoringRepositorySnapshot,
): CompositionAuthoringRepositorySnapshot {
    assertRevision(snapshot.revision)
    return {
        revision: snapshot.revision,
        document: cloneDocument(snapshot.document),
    }
}

function documentsEqual(
    left: CompositionDocument,
    right: CompositionDocument,
): boolean {
    return compositionDocumentHash(left) === compositionDocumentHash(right)
}

function cloneConflict(
    conflict: CompositionAuthoringConflict | null,
): CompositionAuthoringConflict | null {
    if (conflict === null) return null
    return {
        baseRevision: conflict.baseRevision,
        externalRevision: conflict.externalRevision,
        base: cloneDocument(conflict.base),
        local: cloneDocument(conflict.local),
        external: cloneDocument(conflict.external),
    }
}

export class CompositionAuthoringSession<TChangeSet> {
    private state: CompositionAuthoringSessionState = {
        status: 'unloaded',
        baseRevision: null,
        baseDocument: null,
        draftDocument: null,
        dirty: false,
        canUndo: false,
        canRedo: false,
        conflict: null,
        lastError: null,
    }

    private readonly undoStack: CompositionDocument[] = []
    private readonly redoStack: CompositionDocument[] = []
    private readonly listeners = new Set<CompositionAuthoringSessionListener>()
    private loadEpoch = 0

    constructor(
        private readonly dependencies: CompositionAuthoringSessionDependencies<TChangeSet>,
    ) {}

    getState(): CompositionAuthoringSessionState {
        return {
            ...this.state,
            baseDocument: this.state.baseDocument === null
                ? null
                : cloneDocument(this.state.baseDocument),
            draftDocument: this.state.draftDocument === null
                ? null
                : cloneDocument(this.state.draftDocument),
            conflict: cloneConflict(this.state.conflict),
        }
    }

    subscribe(listener: CompositionAuthoringSessionListener): () => void {
        this.listeners.add(listener)
        listener(this.getState())
        return () => this.listeners.delete(listener)
    }

    private publish(patch: Partial<CompositionAuthoringSessionState>): void {
        this.state = { ...this.state, ...patch }
        const snapshot = this.getState()
        for (const listener of this.listeners) listener(snapshot)
    }

    private resetHistory(): void {
        this.undoStack.length = 0
        this.redoStack.length = 0
    }

    private requireReady(): {
        baseRevision: number
        baseDocument: CompositionDocument
        draftDocument: CompositionDocument
    } {
        if (this.state.status !== 'ready'
            || this.state.baseRevision === null
            || this.state.baseDocument === null
            || this.state.draftDocument === null) {
            throw new Error(`Composition authoring session is not ready (${this.state.status})`)
        }
        return {
            baseRevision: this.state.baseRevision,
            baseDocument: this.state.baseDocument,
            draftDocument: this.state.draftDocument,
        }
    }

    async load(): Promise<CompositionAuthoringSessionState> {
        const epoch = ++this.loadEpoch
        this.publish({ status: 'loading', lastError: null })
        try {
            const loaded = cloneSnapshot(await this.dependencies.loadDocument())
            if (epoch !== this.loadEpoch) return this.getState()
            this.resetHistory()
            this.publish({
                status: 'ready',
                baseRevision: loaded.revision,
                baseDocument: loaded.document,
                draftDocument: cloneDocument(loaded.document),
                dirty: false,
                canUndo: false,
                canRedo: false,
                conflict: null,
                lastError: null,
            })
            return this.getState()
        } catch (error) {
            if (epoch === this.loadEpoch) {
                this.publish({ status: 'error', lastError: errorMessage(error) })
            }
            throw error
        }
    }

    dispatch(command: CompositionAuthoringCommand): CompositionAuthoringSessionState {
        const { baseDocument, draftDocument } = this.requireReady()
        const previous = cloneDocument(draftDocument)
        const next = cloneDocument(command(cloneDocument(draftDocument)))
        if (documentsEqual(previous, next)) return this.getState()

        this.undoStack.push(previous)
        this.redoStack.length = 0
        this.publish({
            draftDocument: next,
            dirty: !documentsEqual(baseDocument, next),
            canUndo: true,
            canRedo: false,
            lastError: null,
        })
        return this.getState()
    }

    undo(): boolean {
        const { baseDocument, draftDocument } = this.requireReady()
        const previous = this.undoStack.pop()
        if (previous === undefined) return false
        this.redoStack.push(cloneDocument(draftDocument))
        this.publish({
            draftDocument: previous,
            dirty: !documentsEqual(baseDocument, previous),
            canUndo: this.undoStack.length > 0,
            canRedo: true,
            lastError: null,
        })
        return true
    }

    redo(): boolean {
        const { baseDocument, draftDocument } = this.requireReady()
        const next = this.redoStack.pop()
        if (next === undefined) return false
        this.undoStack.push(cloneDocument(draftDocument))
        this.publish({
            draftDocument: next,
            dirty: !documentsEqual(baseDocument, next),
            canUndo: true,
            canRedo: this.redoStack.length > 0,
            lastError: null,
        })
        return true
    }

    async commit(): Promise<CompositionAuthoringSessionState> {
        const ready = this.requireReady()
        if (!this.state.dirty) return this.getState()

        const base = cloneDocument(ready.baseDocument)
        const draft = cloneDocument(ready.draftDocument)
        const expectedRevision = ready.baseRevision
        let changeSet: TChangeSet
        try {
            changeSet = this.dependencies.createChangeSet(
                cloneDocument(base),
                cloneDocument(draft),
            )
        } catch (error) {
            // Validation/change-set construction errors are recoverable by
            // editing the current draft; keep the authoring session usable.
            this.publish({ status: 'ready', lastError: errorMessage(error) })
            throw error
        }

        this.publish({ status: 'committing', lastError: null })
        try {
            const result = await this.dependencies.commitDocument({
                expectedRevision,
                base: cloneDocument(base),
                draft: cloneDocument(draft),
                changeSet,
            })
            if (result.status === 'stale') {
                const external = cloneSnapshot(result.external)
                this.resetHistory()
                this.publish({
                    status: 'conflict',
                    dirty: true,
                    canUndo: false,
                    canRedo: false,
                    conflict: {
                        baseRevision: expectedRevision,
                        externalRevision: external.revision,
                        base,
                        local: draft,
                        external: external.document,
                    },
                    lastError: 'Composition document changed before commit.',
                })
                return this.getState()
            }

            const committed = cloneSnapshot(result.snapshot)
            this.resetHistory()
            this.publish({
                status: 'ready',
                baseRevision: committed.revision,
                baseDocument: committed.document,
                draftDocument: cloneDocument(committed.document),
                dirty: false,
                canUndo: false,
                canRedo: false,
                conflict: null,
                lastError: null,
            })
            return this.getState()
        } catch (error) {
            this.publish({ status: 'ready', lastError: errorMessage(error) })
            throw error
        }
    }

    ingestExternal(
        snapshot: CompositionAuthoringRepositorySnapshot,
    ): CompositionAuthoringSessionState {
        const external = cloneSnapshot(snapshot)
        if (this.state.status === 'unloaded' || this.state.status === 'error') {
            this.resetHistory()
            this.publish({
                status: 'ready',
                baseRevision: external.revision,
                baseDocument: external.document,
                draftDocument: cloneDocument(external.document),
                dirty: false,
                canUndo: false,
                canRedo: false,
                conflict: null,
                lastError: null,
            })
            return this.getState()
        }
        if (this.state.baseRevision === null || external.revision <= this.state.baseRevision) {
            return this.getState()
        }
        if (this.state.status === 'committing' || this.state.status === 'loading') {
            throw new Error(`Cannot ingest an external document while session is ${this.state.status}`)
        }
        if (this.state.status === 'conflict' && this.state.conflict !== null) {
            this.publish({
                conflict: {
                    ...this.state.conflict,
                    externalRevision: external.revision,
                    external: external.document,
                },
            })
            return this.getState()
        }
        if (this.state.baseDocument === null || this.state.draftDocument === null) {
            throw new Error('Composition authoring session has no loaded document')
        }
        if (!this.state.dirty) {
            this.resetHistory()
            this.publish({
                status: 'ready',
                baseRevision: external.revision,
                baseDocument: external.document,
                draftDocument: cloneDocument(external.document),
                dirty: false,
                canUndo: false,
                canRedo: false,
                conflict: null,
                lastError: null,
            })
            return this.getState()
        }

        this.resetHistory()
        this.publish({
            status: 'conflict',
            canUndo: false,
            canRedo: false,
            conflict: {
                baseRevision: this.state.baseRevision,
                externalRevision: external.revision,
                base: cloneDocument(this.state.baseDocument),
                local: cloneDocument(this.state.draftDocument),
                external: external.document,
            },
            lastError: 'An external composition update conflicts with the local draft.',
        })
        return this.getState()
    }

    resolveConflict(
        resolution: CompositionAuthoringConflictResolution,
    ): CompositionAuthoringSessionState {
        if (this.state.status !== 'conflict' || this.state.conflict === null) {
            throw new Error('Composition authoring session has no conflict to resolve')
        }
        const conflict = this.state.conflict
        const base = cloneDocument(conflict.external)
        const draft = resolution.strategy === 'external'
            ? cloneDocument(conflict.external)
            : resolution.strategy === 'local'
                ? cloneDocument(conflict.local)
                : cloneDocument(resolution.document)
        this.resetHistory()
        this.publish({
            status: 'ready',
            baseRevision: conflict.externalRevision,
            baseDocument: base,
            draftDocument: draft,
            dirty: !documentsEqual(base, draft),
            canUndo: false,
            canRedo: false,
            conflict: null,
            lastError: null,
        })
        return this.getState()
    }
}

export function createCompositionAuthoringSession<TChangeSet>(
    dependencies: CompositionAuthoringSessionDependencies<TChangeSet>,
): CompositionAuthoringSession<TChangeSet> {
    return new CompositionAuthoringSession(dependencies)
}
