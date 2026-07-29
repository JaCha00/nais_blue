import type { MainBatchPlannerPort } from '@/application/generation/plan-main-batch'
import type { CapturedMainGeneration } from '@/services/generation/main-generation-plan'
import { useGenerationStore } from '@/stores/generation-store'

/**
 * Compatibility adapter between the current Zustand generation engine and the
 * new Application Planner port. It keeps Store access in Presentation while
 * the preparation algorithm is incrementally moved out of generation-store.
 */
export function createZustandMainBatchPlanner(): MainBatchPlannerPort<CapturedMainGeneration> {
    const planner: MainBatchPlannerPort<CapturedMainGeneration> = {
        getRequestedCount: () => useGenerationStore.getState().batchCount,
        capturePrepared: async collect => {
            await useGenerationStore.getState().generate({ capturePrepared: collect })
        },
    }
    return Object.freeze(planner)
}
