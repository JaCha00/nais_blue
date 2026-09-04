import {
    applyGenerationFolderChanges,
    type ApplyGenerationFolderChangesInput,
    type ApplyGenerationFolderChangesResult,
} from '@/application/folder/apply-folder-changes'
import { IndexedDbGenerationFolderRepository } from '@/adapters/folder/indexeddb-generation-folder-repository'
import { inspectRuntimeFolderOccupancy } from './runtime-folder-occupancy'

/** Production command surface over the Folder CAS and runtime occupancy authorities. */
export function applyRuntimeGenerationFolderChanges(
    input: Omit<ApplyGenerationFolderChangesInput, 'repository' | 'occupancyGuard'>,
): Promise<ApplyGenerationFolderChangesResult> {
    return applyGenerationFolderChanges({
        ...input,
        repository: new IndexedDbGenerationFolderRepository(),
        occupancyGuard: folderIds => inspectRuntimeFolderOccupancy(input.workspaceId, folderIds),
    })
}
