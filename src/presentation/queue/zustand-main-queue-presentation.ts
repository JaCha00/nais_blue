import type { MainQueuePresentationPort } from '@/application/generation/main-queue-presentation-port'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useQueueStore } from '@/stores/queue-store'

/**
 * Projects Queue lifecycle and result facts into the existing Zustand read
 * models. Main Queue depends only on the Application port; this Presentation
 * adapter owns Store coordination until repositories replace those read models.
 */
export function createZustandMainQueuePresentation(): MainQueuePresentationPort {
    const presentation: MainQueuePresentationPort = {
        beginEnqueueOperation: () => useQueueStore.getState().beginEnqueueOperation('main'),
        completeEnqueueOperation: operationId => {
            useQueueStore.getState().completeEnqueueOperation('main', operationId)
        },
        beginExecution: () => {
            const generation = useGenerationStore.getState()
            generation.setGeneratingMode('main')
            generation.setIsGenerating(true)
            generation.setStreamProgress(0)
        },
        reportStreamProgress: (progress, previewImage) => {
            const generation = useGenerationStore.getState()
            generation.setStreamProgress(progress)
            if (previewImage !== undefined) generation.setPreviewImage(previewImage)
        },
        commitHistory: (history, previewImage) => {
            const generation = useGenerationStore.getState()
            generation.addToHistory({ ...history })
            generation.setPreviewImage(previewImage)
        },
        rollbackHistory: (historyId, previewImage) => {
            useGenerationStore.setState(state => ({
                history: state.history.filter(item => item.id !== historyId),
                previewImage: state.previewImage === previewImage ? null : state.previewImage,
            }))
        },
        publishArtifact: artifact => {
            publishGeneratedArtifact({ ...artifact })
        },
        updateEncodedVibes: encodedVibes => {
            const { vibeImages, updateVibeImage } = useCharacterStore.getState()
            let encodedIndex = 0
            for (let index = 0; index < vibeImages.length && encodedIndex < encodedVibes.length; index += 1) {
                if (!vibeImages[index].encodedVibe) {
                    updateVibeImage(vibeImages[index].id, { encodedVibe: encodedVibes[encodedIndex] })
                    encodedIndex += 1
                }
            }
        },
        refreshAnlas: slot => {
            void useAuthStore.getState().refreshAnlas(slot)
        },
        finishExecution: () => {
            const generation = useGenerationStore.getState()
            generation.setStreamProgress(0)
            generation.setIsGenerating(false)
            generation.setGeneratingMode(null)
            useCharacterStore.getState().releaseImageData()
        },
    }
    return Object.freeze(presentation)
}
