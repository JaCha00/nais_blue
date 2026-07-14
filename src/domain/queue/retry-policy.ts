export type QueueFailureKind =
    | 'transient'
    | 'rate-limited'
    | 'timeout'
    | 'lease-expired'
    | 'cancelled'
    | 'missing-resource'
    | 'invalid-snapshot'

export type QueueRetryDecision =
    | { decision: 'retry'; delayMs: number; nextAttemptAt: string }
    | { decision: 'fail'; reason: 'max-attempts' | 'non-retryable' }

export interface QueueRetryInput {
    attemptCount: number
    maxAttempts: number
    failureKind: QueueFailureKind
    now: string
    baseDelayMs?: number
    maxDelayMs?: number
}

const NON_RETRYABLE_FAILURES = new Set<QueueFailureKind>([
    'cancelled',
    'missing-resource',
    'invalid-snapshot',
])

export function evaluateQueueRetry(input: QueueRetryInput): QueueRetryDecision {
    if (!Number.isSafeInteger(input.attemptCount) || input.attemptCount < 0) {
        throw new TypeError('attemptCount must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
        throw new TypeError('maxAttempts must be a positive safe integer')
    }
    if (!Number.isFinite(Date.parse(input.now))) throw new TypeError('now must be an ISO timestamp')
    if (NON_RETRYABLE_FAILURES.has(input.failureKind)) {
        return { decision: 'fail', reason: 'non-retryable' }
    }
    if (input.attemptCount >= input.maxAttempts) {
        return { decision: 'fail', reason: 'max-attempts' }
    }

    const baseDelayMs = input.baseDelayMs ?? 1_000
    const maxDelayMs = input.maxDelayMs ?? 30_000
    const exponent = Math.max(0, input.attemptCount - 1)
    const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** exponent))
    return {
        decision: 'retry',
        delayMs,
        nextAttemptAt: new Date(Date.parse(input.now) + delayMs).toISOString(),
    }
}
