import type { QueueTokenProvider } from '@/application/queue/queue-token-provider'
import { createZustandMainBatchPlanner } from '@/presentation/generation/zustand-main-batch-planner'
import { createZustandMainQueuePresentation } from '@/presentation/queue/zustand-main-queue-presentation'
import { createZustandStyleLabQueuePresentation } from '@/presentation/queue/zustand-style-lab-queue-presentation'
import { createZustandSceneResultPresentation } from '@/presentation/scene/zustand-scene-result-presentation'
import { configureRuntimeQueueDependencies } from '@/services/queue/runtime'
import { DesktopProviderResultSpool } from '@/adapters/generation/desktop-provider-result-spool'
import { selectActiveCredentialsAreOpus, useAuthStore } from '@/stores/auth-store'
import { useSettingsStore } from '@/stores/settings-store'
import { createGenerationFolderDocumentBinding } from '@/application/folder/generation-folder-binding'
import { getRuntimeOutputWriter } from '@/services/output/output-writer'

/**
 * The core composition root depends on the credential store and Queue runtime,
 * translates active credentials into the application port, and is initialized
 * before React mounts so every command observes the same dependency graph.
 */
const queueTokenProvider: QueueTokenProvider = {
    getActiveTokenSlots: () => {
        const auth = useAuthStore.getState()
        const activeCredentialsAreOpus = selectActiveCredentialsAreOpus(auth)
        return auth.getActiveTokens().map(entry => ({
            slotId: `slot-${entry.slot}`,
            token: entry.token,
            activeCredentialsAreOpus,
        }))
    },
}

let initialized = false

export function initializeCoreRuntime(): void {
    if (initialized) return
    configureRuntimeQueueDependencies({
        tokenProvider: queueTokenProvider,
        mainQueue: {
            providerResultSpool: new DesktopProviderResultSpool(),
            planner: createZustandMainBatchPlanner(),
            presentation: createZustandMainQueuePresentation(),
            outputReservations: {
                getCurrentFolderBinding: () => {
                    const document = useSettingsStore.getState().generationFolderDocument
                    return document === null ? null : createGenerationFolderDocumentBinding(document)
                },
                preflight: request => getRuntimeOutputWriter().preflightExactDestination(request),
            },
        },
        sceneQueue: {
            presentation: createZustandSceneResultPresentation(),
        },
        styleLabQueue: {
            presentation: createZustandStyleLabQueuePresentation(),
        },
    })
    initialized = true
}
