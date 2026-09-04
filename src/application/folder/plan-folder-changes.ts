import {
    isGenerationFolderDocument,
    resolveGenerationFolderV2,
    type GenerationFolderDocument,
    type GenerationFolderV2,
    type GenerationFolderV2Defaults,
    type InheritedValue,
} from '@/domain/generation-folders'

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

export interface GenerationFolderPathImpact {
    readonly folderId: string
    readonly before: { readonly directory: string; readonly r2Prefix: string }
    readonly after: { readonly directory: string; readonly r2Prefix: string }
}

export type PlanGenerationFolderChangesResult =
    | {
        readonly status: 'PLANNED'
        readonly document: GenerationFolderDocument
        readonly pathImpacts: readonly GenerationFolderPathImpact[]
    }
    | { readonly status: 'INVALID'; readonly reason: string }

const PATCH_KEYS = new Set([
    'folderId', 'displayName', 'pathSegment', 'parentId', 'rootDirectory', 'useAbsolutePath',
    'commonPrompt', 'autoUpload', 'r2ProfilePolicy', 'r2BucketPolicy', 'r2PrefixPolicy',
])

/** Plans one atomic document replacement; validation happens before any caller can commit. */
export function planGenerationFolderChanges(
    current: GenerationFolderDocument,
    patches: readonly GenerationFolderPatch[],
    defaults: GenerationFolderV2Defaults,
): PlanGenerationFolderChangesResult {
    if (!isGenerationFolderDocument(current) || patches.length === 0) {
        return { status: 'INVALID', reason: 'Current document or patch set is invalid' }
    }
    const byId = new Map(current.folders.map(folder => [folder.id, folder]))
    const replacements = new Map<string, GenerationFolderV2>()
    for (const patch of patches) {
        if (typeof patch !== 'object' || patch === null
            || Object.keys(patch).some(key => !PATCH_KEYS.has(key))
            || !byId.has(patch.folderId)
            || replacements.has(patch.folderId)) {
            return { status: 'INVALID', reason: 'Patch target or shape is invalid' }
        }
        const { folderId, ...changes } = patch
        replacements.set(folderId, { ...byId.get(folderId) as GenerationFolderV2, ...structuredClone(changes) })
    }
    const next: GenerationFolderDocument = {
        ...current,
        revision: current.revision + 1,
        folders: current.folders.map(folder => replacements.get(folder.id) ?? folder),
    }
    if (!isGenerationFolderDocument(next)) return { status: 'INVALID', reason: 'Patch violates folder invariants' }

    const changedRoots = new Set([...replacements].flatMap(([id, replacement]) => {
        const original = byId.get(id) as GenerationFolderV2
        return original.pathSegment !== replacement.pathSegment
            || original.parentId !== replacement.parentId
            || original.rootDirectory !== replacement.rootDirectory
            || original.useAbsolutePath !== replacement.useAbsolutePath
            || JSON.stringify(original.r2PrefixPolicy) !== JSON.stringify(replacement.r2PrefixPolicy)
            ? [id]
            : []
    }))
    const affected = current.folders.filter(folder => {
        let cursor: GenerationFolderV2 | undefined = next.folders.find(candidate => candidate.id === folder.id)
        const visited = new Set<string>()
        while (cursor !== undefined && !visited.has(cursor.id)) {
            if (changedRoots.has(cursor.id)) return true
            visited.add(cursor.id)
            cursor = cursor.parentId === null ? undefined : next.folders.find(candidate => candidate.id === cursor?.parentId)
        }
        return false
    })
    const pathImpacts = affected.flatMap(folder => {
        const before = resolveGenerationFolderV2(current, folder.id, defaults)
        const after = resolveGenerationFolderV2(next, folder.id, defaults)
        return before === null || after === null ? [] : [{
            folderId: folder.id,
            before: { directory: before.directory, r2Prefix: before.r2.prefix },
            after: { directory: after.directory, r2Prefix: after.r2.prefix },
        }]
    })
    return { status: 'PLANNED', document: structuredClone(next), pathImpacts }
}
