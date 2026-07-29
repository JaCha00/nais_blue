import type { QueueTokenProvider } from '@/application/queue/queue-token-provider'
import { createZustandMainBatchPlanner } from '@/presentation/generation/zustand-main-batch-planner'
import { createZustandMainQueuePresentation } from '@/presentation/queue/zustand-main-queue-presentation'
import { createZustandStyleLabQueuePresentation } from '@/presentation/queue/zustand-style-lab-queue-presentation'
import { configureRuntimeQueueDependencies } from '@/services/queue/runtime'
import { useAuthStore } from '@/stores/auth-store'

/**
 * The core composition root depends on the credential store and Queue runtime,
 * translates active credentials into the application port, and is initialized
 * before React mounts so every command observes the same dependency graph.
 */
const queueTokenProvider: QueueTokenProvider = {
    getActiveTokenSlots: () => useAuthStore.getState().getActiveTokens().map(entry => ({
        slotId: `slot-${entry.slot}`,
        token: entry.token,
    })),
}

let initialized = false

export function initializeCoreRuntime(): void {
    if (initialized) return
    configureRuntimeQueueDependencies({
        tokenProvider: queueTokenProvider,
        mainQueue: {
            planner: createZustandMainBatchPlanner(),
            presentation: createZustandMainQueuePresentation(),
        },
        styleLabQueue: {
            presentation: createZustandStyleLabQueuePresentation(),
        },
    })
    initialized = true
}
