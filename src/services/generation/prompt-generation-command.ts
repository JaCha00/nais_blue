import {
    cancelMainGenerationCommand,
    startMainGenerationCommand,
} from '@/services/generation/generation-command'
import { enqueueCurrentSceneQueue } from '@/services/queue/scene-queue-adapter'
import { getRuntimeDurableQueueCoordinator } from '@/services/queue/runtime'
import { useRotationStore } from '@/stores/character-rotation-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useQueueStore } from '@/stores/queue-store'
import { useSceneStore } from '@/stores/scene-store'

export type PromptGenerationRoute = 'main' | 'scene'
export type PromptGenerationCommandOutcome =
    | 'started'
    | 'cancel-requested'
    | 'rotation-stopped'
    | 'no-scene-work'
    | 'blocked-conflict'

/**
 * Route command adapter used by prompt controls in either a Dock or Sheet. It
 * coordinates the Scene/Rotation/Queue stores and the established Main
 * command boundary, keeping executor selection out of visual components.
 */
export async function executePromptGenerationCommand(
    route: PromptGenerationRoute,
): Promise<PromptGenerationCommandOutcome> {
    if (route === 'main') {
        const generation = useGenerationStore.getState()
        if (generation.isGenerating) {
            // Buttons pre-disable cross-route conflicts, while keyboard and future
            // callers enter here directly; keep the command boundary authoritative.
            if (generation.generatingMode === 'scene') return 'blocked-conflict'
            // Style Lab owns a direct store AbortController even when Main uses the
            // durable queue; Main generations keep the durable/legacy command boundary.
            if (generation.generatingMode === 'styleLab') generation.cancelGeneration()
            else await cancelMainGenerationCommand()
            return 'cancel-requested'
        }
        await startMainGenerationCommand()
        return 'started'
    }

    const rotation = useRotationStore.getState()
    if (rotation.active) {
        rotation.stop({ reason: 'prompt controls stop', keepSnapshot: true })
        return 'rotation-stopped'
    }

    const scene = useSceneStore.getState()
    if (scene.isGenerating || scene.isCancelling) {
        scene.cancelSceneGeneration()
        return 'cancel-requested'
    }
    const generatingMode = useGenerationStore.getState().generatingMode
    if (generatingMode === 'main' || generatingMode === 'styleLab') return 'blocked-conflict'
    if (useQueueStore.getState().executionAuthority === 'legacy') {
        scene.startNewGenerationSession()
        return 'started'
    }

    const sceneQueueCount = scene.activePresetId === null
        ? 0
        : scene.getTotalQueueCount(scene.activePresetId)
    if (sceneQueueCount === 0) return 'no-scene-work'
    const result = await enqueueCurrentSceneQueue()
    if (result !== null) await getRuntimeDurableQueueCoordinator().drain()
    return result === null ? 'no-scene-work' : 'started'
}
