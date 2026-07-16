import { useGenerationStore } from '@/stores/generation-store'
import { useQueueStore } from '@/stores/queue-store'
import { enqueueCurrentMainBatch } from './main-queue-adapter'
import { getRuntimeDurableQueueCoordinator } from './runtime'

/** Shared command seam for page, prompt sheet, and keyboard shortcuts. */
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
