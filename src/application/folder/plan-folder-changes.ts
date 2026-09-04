import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import { createGenerationFolderDocumentBinding } from './generation-folder-binding'
import {
    isGenerationFolderDocument,
    isGenerationFolderV2,
    resolveGenerationFolderV2,
    type GenerationFolderDocument,
    type GenerationFolderV2,
    type GenerationFolderV2Defaults,
    type InheritedValue,
    type ResolvedGenerationFolderV2,
} from '@/domain/generation-folders'

/** Existing update shape remains untagged for source compatibility. */
export interface GenerationFolderPatch {
    readonly folderId: string
    readonly displayName?: string
    readonly pathSegment?: string
    readonly parentId?: string | null
    readonly rootDirectory?: string | null
    readonly useAbsolutePath?: boolean
    readonly commonPrompt?: string
    readonly autoUpload?: boolean
    readonly r2ProfilePolicy?: InheritedValue<string>
    readonly r2BucketPolicy?: InheritedValue<string>
    readonly r2PrefixPolicy?: InheritedValue<string>
}

export interface CreateGenerationFolderChange {
    readonly op: 'create'
    readonly folder: GenerationFolderV2
}

export interface DeleteGenerationFolderChange {
    readonly op: 'delete'
    readonly folderId: string
}

export type GenerationFolderChange = GenerationFolderPatch | CreateGenerationFolderChange | DeleteGenerationFolderChange

export interface GenerationFolderPathImpact {
    readonly folderId: string
    readonly before: { readonly directory: string; readonly r2Prefix: string }
    readonly after: { readonly directory: string; readonly r2Prefix: string }
}

export interface GenerationFolderCollisionIssue {
    readonly parentId: string | null
    readonly pathSegment: string
    readonly folderIds: readonly string[]
}

export interface GenerationFolderDirectoryAuthorization {
    readonly folderId: string
    readonly directory: string
}

export interface GenerationFolderDocumentBinding {
    readonly resourceType: 'generation-folder-document'
    readonly resourceId: string
    readonly revision: number
    readonly contentHash: `sha256:${string}`
}

export type PlanGenerationFolderChangesResult =
    | {
        readonly status: 'PLANNED'
        readonly planHash: `sha256:${string}`
        readonly documentBinding: GenerationFolderDocumentBinding
        readonly document: GenerationFolderDocument
        readonly resultingTree: readonly ResolvedGenerationFolderV2[]
        /** Compatibility name retained for existing callers. */
        readonly pathImpacts: readonly GenerationFolderPathImpact[]
        readonly pathMoves: readonly GenerationFolderPathImpact[]
        readonly collisions: readonly GenerationFolderCollisionIssue[]
        readonly requiredAuthorizations: readonly GenerationFolderDirectoryAuthorization[]
    }
    | { readonly status: 'INVALID'; readonly reason: string }

const PATCH_KEYS = new Set([
    'folderId', 'displayName', 'pathSegment', 'parentId', 'rootDirectory', 'useAbsolutePath',
    'commonPrompt', 'autoUpload', 'r2ProfilePolicy', 'r2BucketPolicy', 'r2PrefixPolicy',
])

function sha256(value: unknown): `sha256:${string}` {
    return `sha256:${hashCanonicalValue(value)}`
}

function collisionIssues(folders: readonly GenerationFolderV2[]): GenerationFolderCollisionIssue[] {
    const siblings = new Map<string, GenerationFolderV2[]>()
    for (const folder of folders) {
        const key = `${folder.parentId ?? '<root>'}\0${folder.pathSegment.toLocaleLowerCase('en-US')}`
        const group = siblings.get(key) ?? []
        group.push(folder)
        siblings.set(key, group)
    }
    return [...siblings.values()]
        .filter(group => group.length > 1)
        .map(group => ({
            parentId: group[0].parentId,
            pathSegment: group[0].pathSegment,
            folderIds: group.map(folder => folder.id).sort(),
        }))
        .sort((left, right) => left.folderIds[0].localeCompare(right.folderIds[0]))
}

function validTreeIgnoringSiblingCollisions(folders: readonly GenerationFolderV2[]): boolean {
    if (!folders.every(isGenerationFolderV2)) return false
    const byId = new Map(folders.map(folder => [folder.id, folder]))
    if (byId.size !== folders.length) return false
    for (const folder of folders) {
        if (folder.parentId === null) {
            if (folder.rootDirectory === null) return false
        } else if (!byId.has(folder.parentId) || folder.rootDirectory !== null || folder.useAbsolutePath) {
            return false
        }
        const visited = new Set<string>()
        let current: GenerationFolderV2 | undefined = folder
        while (current !== undefined) {
            if (visited.has(current.id)) return false
            visited.add(current.id)
            current = current.parentId === null ? undefined : byId.get(current.parentId)
        }
    }
    return true
}

function isCreate(change: GenerationFolderChange): change is CreateGenerationFolderChange {
    return 'op' in change && change.op === 'create'
}

function isDelete(change: GenerationFolderChange): change is DeleteGenerationFolderChange {
    return 'op' in change && change.op === 'delete'
}

/** Plans one atomic document replacement without storage or filesystem side effects. */
export function planGenerationFolderChanges(
    current: GenerationFolderDocument,
    changes: readonly GenerationFolderChange[],
    defaults: GenerationFolderV2Defaults,
): PlanGenerationFolderChangesResult {
    if (!isGenerationFolderDocument(current) || changes.length === 0) {
        return { status: 'INVALID', reason: 'Current document or change set is invalid' }
    }
    const folders = current.folders.map(folder => structuredClone(folder))
    const touched = new Set<string>()
    const changedRoots = new Set<string>()
    const createdIds = new Set<string>()
    const deletedIds = new Set<string>()

    for (const change of changes) {
        if (typeof change !== 'object' || change === null) {
            return { status: 'INVALID', reason: 'Change target or shape is invalid' }
        }
        if (isCreate(change)) {
            if (Object.keys(change).some(key => key !== 'op' && key !== 'folder')
                || !isGenerationFolderV2(change.folder)
                || folders.some(folder => folder.id === change.folder.id)
                || touched.has(change.folder.id)) {
                return { status: 'INVALID', reason: 'Create change is invalid' }
            }
            folders.push(structuredClone(change.folder))
            touched.add(change.folder.id)
            createdIds.add(change.folder.id)
            changedRoots.add(change.folder.id)
            continue
        }
        if (isDelete(change)) {
            const index = folders.findIndex(folder => folder.id === change.folderId)
            if (Object.keys(change).some(key => key !== 'op' && key !== 'folderId')
                || index < 0
                || touched.has(change.folderId)
                || folders.some(folder => folder.parentId === change.folderId)) {
                return { status: 'INVALID', reason: 'Delete change must target an existing leaf folder' }
            }
            folders.splice(index, 1)
            touched.add(change.folderId)
            deletedIds.add(change.folderId)
            continue
        }
        if (Object.keys(change).some(key => !PATCH_KEYS.has(key)) || touched.has(change.folderId)) {
            return { status: 'INVALID', reason: 'Patch target or shape is invalid' }
        }
        const index = folders.findIndex(folder => folder.id === change.folderId)
        if (index < 0) return { status: 'INVALID', reason: 'Patch target or shape is invalid' }
        const original = folders[index]
        const { folderId, ...updates } = change
        const replacement = { ...original, ...structuredClone(updates) }
        folders[index] = replacement
        touched.add(folderId)
        if (original.pathSegment !== replacement.pathSegment
            || original.parentId !== replacement.parentId
            || original.rootDirectory !== replacement.rootDirectory
            || original.useAbsolutePath !== replacement.useAbsolutePath
            || JSON.stringify(original.r2PrefixPolicy) !== JSON.stringify(replacement.r2PrefixPolicy)) {
            changedRoots.add(folderId)
        }
    }

    if (!validTreeIgnoringSiblingCollisions(folders)) {
        return { status: 'INVALID', reason: 'Patch violates folder invariants' }
    }
    const collisions = collisionIssues(folders)
    const next: GenerationFolderDocument = { ...current, revision: current.revision + 1, folders }
    if (collisions.length === 0 && !isGenerationFolderDocument(next)) {
        return { status: 'INVALID', reason: 'Patch violates folder invariants' }
    }

    const affectedIds = new Set<string>(createdIds)
    for (const folder of folders) {
        let cursor: GenerationFolderV2 | undefined = folder
        const visited = new Set<string>()
        while (cursor !== undefined && !visited.has(cursor.id)) {
            if (changedRoots.has(cursor.id)) {
                affectedIds.add(folder.id)
                break
            }
            visited.add(cursor.id)
            cursor = cursor.parentId === null ? undefined : folders.find(candidate => candidate.id === cursor?.parentId)
        }
    }
    const pathMoves = current.folders.flatMap(folder => {
        if (!affectedIds.has(folder.id) || deletedIds.has(folder.id)) return []
        const before = resolveGenerationFolderV2(current, folder.id, defaults)
        const after = collisions.length === 0 ? resolveGenerationFolderV2(next, folder.id, defaults) : null
        if (before === null || after === null
            || (before.directory === after.directory && before.r2.prefix === after.r2.prefix)) return []
        return [{
            folderId: folder.id,
            before: { directory: before.directory, r2Prefix: before.r2.prefix },
            after: { directory: after.directory, r2Prefix: after.r2.prefix },
        }]
    })
    const resultingTree = collisions.length === 0
        ? folders.map(folder => resolveGenerationFolderV2(next, folder.id, defaults))
            .filter((folder): folder is ResolvedGenerationFolderV2 => folder !== null)
        : []
    const requiredAuthorizations = resultingTree
        .filter(folder => affectedIds.has(folder.id) && folder.useAbsolutePath)
        .map(folder => ({ folderId: folder.id, directory: folder.directory }))
    const documentBinding: GenerationFolderDocumentBinding = createGenerationFolderDocumentBinding(current)
    const planHash = sha256({ documentBinding, resultingDocument: next, pathMoves, collisions, requiredAuthorizations })
    return {
        status: 'PLANNED',
        planHash,
        documentBinding,
        document: structuredClone(next),
        resultingTree: structuredClone(resultingTree),
        pathImpacts: structuredClone(pathMoves),
        pathMoves: structuredClone(pathMoves),
        collisions: structuredClone(collisions),
        requiredAuthorizations: structuredClone(requiredAuthorizations),
    }
}
