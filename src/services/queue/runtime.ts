import { useAuthStore } from '@/stores/auth-store'
import { DurableQueueCoordinator } from './durable-queue-coordinator'
import { getRuntimeQueueRepository } from './indexeddb-queue-repository'
import { executeSceneQueueJob } from './scene-queue-adapter'
import { executeMainQueueJob } from './main-queue-adapter'
import { initializeQueueAfterRestart } from './queue-startup'

let runtimeCoordinator: DurableQueueCoordinator | null = null

export function getRuntimeDurableQueueCoordinator(): DurableQueueCoordinator {
    runtimeCoordinator ??= new DurableQueueCoordinator({
        repository: getRuntimeQueueRepository(),
        startup: initializeQueueAfterRestart,
        tokenProvider: () => useAuthStore.getState().getActiveTokens().map(entry => ({
            slotId: `slot-${entry.slot}`,
            token: entry.token,
        })),
        executor: {
            execute: async (job, context) => {
                if (job.workflow === 'scene') {
                    await executeSceneQueueJob(job, context)
                    return
                }
                if (job.workflow === 'main') {
                    await executeMainQueueJob(job, context)
                    return
                }
                throw new Error(`Durable executor is unavailable for ${job.workflow}`)
            },
        },
    })
    return runtimeCoordinator
}

export function resetRuntimeDurableQueueCoordinatorForTests(): void {
    runtimeCoordinator?.stop()
    runtimeCoordinator = null
}
