import type { GenerationFolderV1Projection } from '@/domain/generation-folders'

/** Read-only compatibility seam over the existing V1 settings authority. */
export interface GenerationFolderRepositoryPort {
    readLegacyProjection(): Promise<GenerationFolderV1Projection | null>
}
