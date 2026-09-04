import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import { isGenerationFolderDocument, type GenerationFolderDocument } from '@/domain/generation-folders'
import type { OutputReservationFolderBinding } from '@/domain/queue/types'

/** Captures the whole Folder authority so plans and execution can reject stale paths. */
export function createGenerationFolderDocumentBinding(
    document: GenerationFolderDocument,
): OutputReservationFolderBinding {
    if (!isGenerationFolderDocument(document)) {
        throw new TypeError('Generation folder authority is invalid')
    }
    return Object.freeze({
        resourceType: 'generation-folder-document',
        resourceId: document.workspaceId,
        revision: document.revision,
        contentHash: `sha256:${hashCanonicalValue(document)}`,
    })
}
