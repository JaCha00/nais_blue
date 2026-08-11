import { describe, expect, it, vi } from 'vitest'

import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import { createStyleEvaluationContext } from '@/domain/style-lab'

const mocks = vi.hoisted(() => ({
    context: null as ReturnType<typeof createStyleEvaluationContext> | null,
    enqueue: vi.fn(),
    reconcile: vi.fn(async () => ({ spent: 0, released: 0 })),
    start: vi.fn(),
    drain: vi.fn(async () => undefined),
    updateCombinationPreview: vi.fn(),
}))

vi.mock('@/services/style-lab/style-lab-queue-adapter', () => ({
    enqueueStyleLabPreviewJobs: mocks.enqueue,
    reconcileStyleLabRenderReservations: mocks.reconcile,
}))

vi.mock('@/services/style-lab/capture-evaluation-context', () => ({
    captureCurrentStyleEvaluationContext: () => mocks.context,
}))

vi.mock('@/services/queue/runtime', () => ({
    getRuntimeDurableQueueCoordinator: () => ({ start: mocks.start, drain: mocks.drain }),
}))

vi.mock('@/services/queue/indexeddb-queue-repository', () => ({
    getRuntimeQueueRepository: () => ({}),
}))

vi.mock('@/stores/generation-store', () => ({
    useGenerationStore: { getState: () => ({}) },
}))

vi.mock('@/stores/style-lab-store', () => ({
    useStyleLabStore: {
        getState: () => ({
            combinations: [{ id: 'left' }, { id: 'right' }],
            updateCombinationPreview: mocks.updateCombinationPreview,
        }),
    },
}))

import { requestStyleLabPreviewRenders } from '@/services/style-lab/request-preview-render'

describe('Style-Lab preview request deduplication', () => {
    it('shares one enqueue while an identical Guided request is in flight', async () => {
        const context = createStyleEvaluationContext({
            prompt: { base: 'portrait' },
            plan: { width: 1024, height: 1024, steps: 28 },
            model: 'nai-diffusion-4-5-full',
            sampler: 'k_euler_ancestral',
            seedPack: [7],
            createdAt: 1,
        })
        mocks.context = context
        let finish!: (value: { jobs: never[]; reservations: never[]; rejected: never[] }) => void
        mocks.enqueue.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
        const instant = '2026-08-10T00:00:00.000Z'
        const costConsent = createAnlasCostConsentSnapshot({
            pricingBasis: 'all-active-opus', estimatedAnlas: 0, maxAnlas: 0,
            estimatedAt: instant, approvedAt: instant,
        })

        const first = requestStyleLabPreviewRenders(['left', 'right'], { evaluationContext: context, costConsent })
        const second = requestStyleLabPreviewRenders(['right', 'left'], { evaluationContext: context, costConsent })

        expect(mocks.enqueue).toHaveBeenCalledOnce()
        finish({ jobs: [], reservations: [], rejected: [] })
        await expect(Promise.all([first, second])).resolves.toHaveLength(2)
        expect(mocks.start).toHaveBeenCalledOnce()
        expect(mocks.drain).toHaveBeenCalledOnce()
    })
})
