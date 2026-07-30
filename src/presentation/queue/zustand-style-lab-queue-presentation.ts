import type {
    StyleLabQueuePresentationPort,
    StyleLabQueueResultProjection,
} from '@/application/style-lab/style-lab-queue-presentation-port'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useStyleLabStore } from '@/stores/style-lab-store'

function clearPreview(comboId: string): void {
    useStyleLabStore.getState().updateCombinationPreview(comboId, {
        isPreviewing: false,
        previewProgress: 0,
    })
}

/**
 * Depends on Style Lab, generation-history, and artifact lifecycle Stores. It
 * projects one committed Queue result into those UI read models and provides
 * the matching rollback/cleanup operations without exposing Zustand to the
 * durable executor.
 */
export function createZustandStyleLabQueuePresentation(): StyleLabQueuePresentationPort {
    const presentation: StyleLabQueuePresentationPort = {
        beginPreview: comboId => {
            useStyleLabStore.getState().updateCombinationPreview(comboId, {
                isPreviewing: true,
                previewProgress: 0,
                previewError: undefined,
            })
        },
        commitResult: (result: StyleLabQueueResultProjection) => {
            useStyleLabStore.getState().updateCombinationPreview(result.comboId, {
                previewImage: undefined,
                previewPath: result.preview.path,
                previewThumbnail: result.preview.thumbnail,
                previewSeed: result.preview.seed,
                previewPrompt: result.preview.prompt,
                previewContextId: result.preview.contextId,
                previewProgress: 1,
                isPreviewing: false,
            })
            useGenerationStore.getState().addToHistory({ ...result.history })
            publishGeneratedArtifact({ ...result.artifact })
        },
        rollbackResult: (comboId, historyId) => {
            useGenerationStore.setState(state => ({
                history: state.history.filter(item => item.id !== historyId),
            }))
            clearPreview(comboId)
        },
        clearPreview,
    }
    return Object.freeze(presentation)
}
