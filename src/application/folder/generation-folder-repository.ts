import type {
    GenerationFolderDocument,
    GenerationFolderV1Projection,
} from '@/domain/generation-folders'

export interface GenerationFolderDocumentSummary {
    readonly workspaceId: string
    readonly revision: number
    readonly folderCount: number
}

export type GenerationFolderCommitResult =
    | { readonly status: 'COMMITTED'; readonly document: GenerationFolderDocument }
    | { readonly status: 'REVISION_CONFLICT'; readonly current: GenerationFolderDocument | null }
    | { readonly status: 'STORAGE_CONFLICT' }

/** Read-only compatibility seam over the existing V1 settings authority. */
export interface GenerationFolderRepositoryPort {
    readLegacyProjection(): Promise<GenerationFolderV1Projection | null>
    getDocument(workspaceId: string): Promise<GenerationFolderDocument | null>
    listDocuments(): Promise<readonly GenerationFolderDocumentSummary[]>
    commit(next: GenerationFolderDocument, expectedRevision: number): Promise<GenerationFolderCommitResult>
    materializeLegacy(workspaceId: string): Promise<GenerationFolderDocument | null>
}
