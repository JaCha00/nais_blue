import { describe, expect, it, vi } from 'vitest'

import {
    recordGuidedStyleDecision,
    startGuidedStyleComparison,
} from '@/application/style-lab/guided-style-comparison'
import type { StyleLabRepository } from '@/application/style-lab/style-lab-repository'
import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import {
    createStyleEvaluationContext,
    type PreferenceProjection,
    type StylePreferenceEvent,
} from '@/domain/style-lab'

function context() {
    return createStyleEvaluationContext({
        prompt: { base: 'portrait' },
        plan: { model: 'model' },
        model: 'model',
        sampler: 'sampler',
        seedPack: [7],
        createdAt: 1,
    })
}

function repository() {
    const events: StylePreferenceEvent[] = []
    const projections: PreferenceProjection[] = []
    return {
        events,
        projections,
        port: {
            listPreferenceEvents: vi.fn(async () => [...events]),
            appendPreferenceEvents: vi.fn(async (_context, next: readonly StylePreferenceEvent[]) => {
                events.push(...next)
            }),
            replacePreferenceProjections: vi.fn(async (next: readonly PreferenceProjection[]) => {
                projections.splice(0, projections.length, ...next)
            }),
        } as unknown as StyleLabRepository,
    }
}

function freeConsent() {
    return createAnlasCostConsentSnapshot({
        pricingBasis: 'all-active-opus',
        estimatedAnlas: 0,
        maxAnlas: 0,
        estimatedAt: '2026-08-10T00:00:00.000Z',
        approvedAt: '2026-08-10T00:00:00.000Z',
    })
}

describe('Guided Style comparison application command', () => {
    it('records one exposure and queues both candidates under the same context', async () => {
        const storage = repository()
        const evaluation = context()
        const costConsent = freeConsent()
        const requestPreviews = vi.fn(async () => ({ rejected: [] }))

        const result = await startGuidedStyleComparison({
            candidates: [
                { id: 'left', elo: 1200, favorite: false },
                { id: 'right', elo: 1200, favorite: false },
            ],
            league: 'all',
            context: evaluation,
            randomSeed: 42,
            repository: storage.port,
            requestPreviews,
            costConsent,
        })

        expect(result).not.toBeNull()
        expect(storage.events.map(event => event.action)).toEqual(['impression', 'impression'])
        expect(requestPreviews).toHaveBeenCalledOnce()
        expect(requestPreviews).toHaveBeenCalledWith(result?.pair, {
            evaluationContext: evaluation,
            costConsent,
        })
        expect(result?.context).toBe(evaluation)
    })

    it('persists the selected decision before returning updated projections', async () => {
        const storage = repository()
        const evaluation = context()
        const candidates = [{ id: 'left' }, { id: 'right' }]

        const result = await recordGuidedStyleDecision({
            candidates,
            context: evaluation,
            repository: storage.port,
            decision: { kind: 'win', winnerId: 'left', loserId: 'right' },
        })

        expect(result.event.action).toBe('pair-win')
        expect(storage.events).toEqual([result.event])
        expect(result.projections.find(item => item.comboId === 'left')?.mu)
            .toBeGreaterThan(result.projections.find(item => item.comboId === 'right')?.mu ?? 0)
    })
})
