import { describe, expect, it } from 'vitest'

import { evaluateQueueRetry } from '@/domain/queue/retry-policy'

const NOW = '2026-07-14T03:00:00.000Z'

describe('durable queue retry policy', () => {
    it('uses deterministic bounded exponential delay for retryable failures', () => {
        expect(evaluateQueueRetry({
            attemptCount: 1,
            maxAttempts: 3,
            failureKind: 'lease-expired',
            now: NOW,
        })).toEqual({
            decision: 'retry',
            delayMs: 1_000,
            nextAttemptAt: '2026-07-14T03:00:01.000Z',
        })
        expect(evaluateQueueRetry({
            attemptCount: 8,
            maxAttempts: 10,
            failureKind: 'rate-limited',
            now: NOW,
        })).toMatchObject({ decision: 'retry', delayMs: 30_000 })
    })

    it('never retries blocked/non-retryable work or an exhausted attempt budget', () => {
        for (const failureKind of ['cancelled', 'missing-resource', 'invalid-snapshot'] as const) {
            expect(evaluateQueueRetry({
                attemptCount: 0,
                maxAttempts: 3,
                failureKind,
                now: NOW,
            })).toEqual({ decision: 'fail', reason: 'non-retryable' })
        }
        expect(evaluateQueueRetry({
            attemptCount: 3,
            maxAttempts: 3,
            failureKind: 'timeout',
            now: NOW,
        })).toEqual({ decision: 'fail', reason: 'max-attempts' })
    })
})
