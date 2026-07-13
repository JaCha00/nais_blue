import { useCallback, useEffect, useMemo, useState } from 'react'

import {
    mergeCompositionDocuments,
    validateCompositionAuthoringDocument,
    type CompositionMergeResolution,
} from '@/domain/composition/authoring'
import type { CompositionEngineIssue, CompositionEnginePlan } from '@/domain/composition/engine'
import type { CompositionDocument, ResolutionIssue } from '@/domain/composition/types'
import type {
    CompositionStudioConflict,
    ConflictChoice,
} from '@/components/asset-module-studio/CompositionStudioV2'
import {
    createRepositoryCompositionAuthoringSession,
    readCompositionAuthoringSnapshot,
} from '@/services/composition-authoring-adapter'
import { createCompositionAuthoringRepository } from '@/services/composition-authoring-runtime'
import type { CompositionAuthoringSessionState } from '@/services/composition-authoring-session'
import { resolveCompositionStudioPreview } from '@/services/composition-studio-preview'

const EXTERNAL_POLL_MS = 2_500

function pathLabel(path: readonly (string | number)[]): string {
    if (path.length === 0) return '$'
    return path.reduce<string>((label, segment) => (
        typeof segment === 'number' ? `${label}[${segment}]` : `${label}.${segment}`
    ), '$')
}

function valueAtPath(value: unknown, path: readonly (string | number)[]): unknown {
    let current = value
    for (const segment of path) {
        if (current === null || typeof current !== 'object') return undefined
        current = (current as Record<string | number, unknown>)[segment]
    }
    return current
}

export interface CompositionStudioSessionView {
    state: CompositionAuthoringSessionState
    document: CompositionDocument | null
    issues: readonly ResolutionIssue[]
    preview: CompositionEnginePlan | null
    previewErrors: readonly CompositionEngineIssue[]
    externalDocument?: CompositionDocument
    conflicts: readonly CompositionStudioConflict[]
    commit: () => Promise<void>
    undo: () => void
    updateDraft: (next: CompositionDocument) => void
    reloadExternal: () => Promise<void>
    resolveConflict: (path: string, choice: ConflictChoice) => void
    reload: () => Promise<void>
}

export function useCompositionStudioSession(): CompositionStudioSessionView {
    const repository = useMemo(() => createCompositionAuthoringRepository(), [])
    const session = useMemo(
        () => createRepositoryCompositionAuthoringSession(repository),
        [repository],
    )
    const [state, setState] = useState<CompositionAuthoringSessionState>(() => session.getState())
    const [resolutions, setResolutions] = useState<CompositionMergeResolution[]>([])

    useEffect(() => session.subscribe(setState), [session])

    const reload = useCallback(async () => {
        setResolutions([])
        await session.load()
    }, [session])

    useEffect(() => {
        let disposed = false
        let polling = false
        void reload().catch(() => undefined)
        const timer = window.setInterval(() => {
            if (disposed || polling) return
            polling = true
            void readCompositionAuthoringSnapshot(repository)
                .then(snapshot => {
                    if (!disposed) session.ingestExternal(snapshot)
                })
                .catch(() => undefined)
                .finally(() => {
                    polling = false
                })
        }, EXTERNAL_POLL_MS)
        return () => {
            disposed = true
            window.clearInterval(timer)
        }
    }, [reload, repository, session])

    useEffect(() => {
        if (state.conflict === null) setResolutions([])
    }, [state.conflict])

    const merge = useMemo(() => {
        if (state.conflict === null) return null
        return mergeCompositionDocuments({
            base: state.conflict.base,
            local: state.conflict.local,
            external: state.conflict.external,
            resolutions,
        })
    }, [resolutions, state.conflict])

    const conflictPaths = useMemo(() => new Map(
        (merge?.conflicts ?? []).map(conflict => [pathLabel(conflict.path), conflict.path]),
    ), [merge?.conflicts])

    const conflicts = useMemo<CompositionStudioConflict[]>(() => (
        (merge?.conflicts ?? []).map(conflict => ({
            path: pathLabel(conflict.path),
            base: conflict.base,
            local: conflict.local,
            external: conflict.external,
            merged: valueAtPath(merge?.value, conflict.path),
            ...(conflict.resolution === 'unresolved' ? {} : { resolution: conflict.resolution }),
        }))
    ), [merge])

    const document = state.draftDocument
    const validation = useMemo(
        () => document === null ? null : validateCompositionAuthoringDocument(document),
        [document],
    )
    const previewResult = useMemo(
        () => document === null ? null : resolveCompositionStudioPreview(document),
        [document],
    )
    const preview = previewResult?.success === true
        ? JSON.parse(JSON.stringify(previewResult.plan)) as CompositionEnginePlan
        : null
    const previewErrors = previewResult === null || previewResult.success
        ? []
        : JSON.parse(JSON.stringify(previewResult.errors)) as CompositionEngineIssue[]

    const updateDraft = useCallback((next: CompositionDocument) => {
        session.dispatch(() => next)
    }, [session])

    const commit = useCallback(async () => {
        if (validation !== null && !validation.valid) {
            throw new Error('Composition draft has blocking validation errors')
        }
        await session.commit()
    }, [session, validation])

    const reloadExternal = useCallback(async () => {
        if (session.getState().conflict !== null) {
            session.resolveConflict({ strategy: 'external' })
            return
        }
        session.ingestExternal(await readCompositionAuthoringSnapshot(repository))
    }, [repository, session])

    const resolveConflict = useCallback((path: string, choice: ConflictChoice) => {
        if (state.conflict === null) return
        if (choice === 'merged') {
            if (merge?.document === null || merge?.document === undefined) return
            const unresolved = merge.conflicts.some(conflict => conflict.resolution === 'unresolved')
            if (!unresolved && merge.validation.valid) {
                session.resolveConflict({ strategy: 'merged', document: merge.document })
            }
            return
        }
        const mergePath = conflictPaths.get(path)
        if (mergePath === undefined) return
        setResolutions(current => [
            ...current.filter(item => pathLabel(item.path) !== path),
            { path: mergePath, choice },
        ])
    }, [conflictPaths, merge, session, state.conflict])

    return {
        state,
        document,
        issues: validation?.semanticIssues ?? [],
        preview,
        previewErrors,
        ...(state.conflict === null ? {} : { externalDocument: state.conflict.external }),
        conflicts,
        commit,
        undo: () => {
            session.undo()
        },
        updateDraft,
        reloadExternal,
        resolveConflict,
        reload,
    }
}
