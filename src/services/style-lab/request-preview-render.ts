import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import type { AnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import { sameStyleEvaluationContext, type StyleEvaluationContext } from '@/domain/style-lab'
import { captureCurrentStyleEvaluationContext } from './capture-evaluation-context'
import {
    enqueueStyleLabPreviewJobs,
    reconcileStyleLabRenderReservations,
    type EnqueueStyleLabPreviewResult,
} from '@/services/style-lab/style-lab-queue-adapter'
import { getRuntimeDurableQueueCoordinator } from '@/services/queue/runtime'
import { getRuntimeQueueRepository } from '@/services/queue/indexeddb-queue-repository'
import { useGenerationStore } from '@/stores/generation-store'
import { useStyleLabStore } from '@/stores/style-lab-store'

export interface RequestStyleLabPreviewOptions {
    evaluationContext?: StyleEvaluationContext
    budgetId?: string
    boardId?: string | null
    budgetLimit?: number
    priority?: number
    costConsent?: AnlasCostConsentSnapshot
}

const previewRequestsInFlight = new Map<string, Promise<EnqueueStyleLabPreviewResult>>()

/**
 * UI requests only identify candidates and policy. This runtime adapter captures the
 * current fair context, persists durable snapshots, and lets Queue Center own
 * execution/retry/cancellation after the caller returns.
 */
export async function requestStyleLabPreviewRenders(
    combinationIds: readonly string[],
    options: RequestStyleLabPreviewOptions = {},
): Promise<EnqueueStyleLabPreviewResult> {
    const uniqueIds = [...new Set(combinationIds)]
    const state = useStyleLabStore.getState()
    const combinations = uniqueIds
        .map(id => state.combinations.find(combo => combo.id === id))
        .filter((combo): combo is NonNullable<typeof combo> => combo !== undefined)
    if (combinations.length === 0) return { jobs: [], reservations: [], rejected: [] }

    let context = options.evaluationContext
    if (context === undefined) {
        const generation = useGenerationStore.getState()
        const seed = generation.seedLocked
            ? generation.seed
            : state.reserveRandomSeed('durable-preview-context')
        context = captureCurrentStyleEvaluationContext([seed])
    } else {
        const current = captureCurrentStyleEvaluationContext(context.seedPack, context.createdAt)
        if (!sameStyleEvaluationContext(current, context)) {
            throw new Error('Style-Lab evaluation settings changed; capture a new context before rendering')
        }
    }

    const requestKey = hashCanonicalValue({
        combinationIds: [...uniqueIds].sort(),
        contextId: context.id,
        budgetId: options.budgetId ?? null,
        boardId: options.boardId ?? null,
        budgetLimit: options.budgetLimit ?? null,
        priority: options.priority ?? null,
        costPolicy: options.costConsent === undefined ? 'advanced' : {
            pricingBasis: options.costConsent.pricingBasis,
            estimatedAnlas: options.costConsent.estimatedAnlas,
            maxAnlas: options.costConsent.maxAnlas,
        },
    })
    const existing = previewRequestsInFlight.get(requestKey)
    if (existing !== undefined) return existing

    const request = (async () => {
        const queued = await enqueueStyleLabPreviewJobs({
            combinations,
            context,
            ...(options.budgetId === undefined ? {} : { budgetId: options.budgetId }),
            ...(options.boardId === undefined ? {} : { boardId: options.boardId }),
            ...(options.budgetLimit === undefined ? {} : { budgetLimit: options.budgetLimit }),
            ...(options.priority === undefined ? {} : { priority: options.priority }),
            submissionPolicy: options.costConsent === undefined
                ? { kind: 'advanced' }
                : { kind: 'guided', costConsent: options.costConsent },
        })
        const pendingIds = new Set(queued.jobs
            .filter(job => job.state !== 'succeeded'
                && job.state !== 'failed'
                && job.state !== 'cancelled'
                && job.state !== 'skipped')
            .map(job => {
                const parameters = job.snapshot.parameters as Record<string, unknown>
                const workflow = parameters.styleLabWorkflow as { comboId?: unknown } | undefined
                return typeof workflow?.comboId === 'string' ? workflow.comboId : ''
            })
            .filter(Boolean))
        for (const comboId of pendingIds) {
            useStyleLabStore.getState().updateCombinationPreview(comboId, {
                isPreviewing: true, previewProgress: 0, previewError: undefined,
            })
        }

        const coordinator = getRuntimeDurableQueueCoordinator()
        coordinator.start()
        // Drain is deliberately detached: navigation no longer cancels Style-Lab work.
        void coordinator.drain()
            .then(() => reconcileStyleLabRenderReservations({ queueRepository: getRuntimeQueueRepository() }))
            .catch(() => undefined)
        return queued
    })()
    const tracked = request.finally(() => {
        if (previewRequestsInFlight.get(requestKey) === tracked) previewRequestsInFlight.delete(requestKey)
    })
    previewRequestsInFlight.set(requestKey, tracked)
    return tracked
}
