import type { MainQueuePresentationPort } from '@/application/generation/main-queue-presentation-port'
import type { MainBatchPlannerPort } from '@/application/generation/plan-main-batch'
import type { PreparedMainGeneration } from '@/services/generation/main-generation-plan'

export interface RuntimeMainQueueDependencies {
    readonly planner: MainBatchPlannerPort<PreparedMainGeneration>
    readonly presentation: MainQueuePresentationPort
}

let runtimeMainQueueDependencies: RuntimeMainQueueDependencies | null = null

/**
 * Composition Root supplies the Main Planner bridge and result projector used
 * by both enqueue and execution modules. Centralizing this registry prevents
 * either infrastructure half from importing Zustand while preserving one
 * application-session dependency set.
 */
export function configureRuntimeMainQueueDependencies(
    dependencies: RuntimeMainQueueDependencies,
): void {
    runtimeMainQueueDependencies = dependencies
}

export function getRuntimeMainQueueDependencies(): RuntimeMainQueueDependencies {
    if (runtimeMainQueueDependencies === null) {
        throw new Error('Main Queue dependencies are not configured')
    }
    return runtimeMainQueueDependencies
}

export function resetRuntimeMainQueueDependenciesForTests(): void {
    runtimeMainQueueDependencies = null
}
