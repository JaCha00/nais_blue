import { useGenerationStore } from '@/stores/generation-store'
import { useQueueStore } from '@/stores/queue-store'
import { enqueueCurrentMainBatch } from '@/services/queue/main-queue-adapter'
import { getRuntimeDurableQueueCoordinator } from '@/services/queue/runtime'

/**
 * Single UI command surface. It depends on queue authority and the legacy store
 * fallback, then routes start/cancel to exactly one executor so pages and prompt
 * panels do not orchestrate providers, persistence, or queue draining themselves.
 */
export async function startMainGenerationCommand(): Promise<void> {
    if (useQueueStore.getState().executionAuthority === 'legacy') {
        await useGenerationStore.getState().generate()
        return
    }
    const enqueued = await enqueueCurrentMainBatch()
    if (enqueued !== null) await getRuntimeDurableQueueCoordinator().drain()
}

export async function cancelMainGenerationCommand(): Promise<void> {
    if (useQueueStore.getState().executionAuthority === 'legacy') {
        useGenerationStore.getState().cancelGeneration()
        return
    }
    await getRuntimeDurableQueueCoordinator().cancelWorkflow('main')
}
