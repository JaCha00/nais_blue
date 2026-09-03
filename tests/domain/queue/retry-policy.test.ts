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
            retryAfterMs: 30_000,
        })).toMatchObject({ decision: 'retry', delayMs: 30_000 })
        expect(evaluateQueueRetry({
            attemptCount: 1,
            maxAttempts: 3,
            failureKind: 'rate-limited',
            now: NOW,
        })).toEqual({ decision: 'fail', reason: 'non-retryable' })
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

    it.each([
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER + 1,
        -1,
        1.5,
    ])('rejects an unsafe or non-finite Provider Retry-After delay (%s)', retryAfterMs => {
        expect(evaluateQueueRetry({
            attemptCount: 1,
            maxAttempts: 3,
            failureKind: 'rate-limited',
            now: NOW,
            retryAfterMs,
        })).toEqual({ decision: 'fail', reason: 'non-retryable' })
    })
})
