import { describe, expect, it } from 'vitest'

import {
    ALLOWED_JOB_TRANSITIONS,
    QueueStateTransitionError,
    assertJobTransition,
    canTransitionJob,
    isTerminalJobState,
} from '@/domain/queue/state-machine'
import { GENERATION_JOB_STATES, TERMINAL_JOB_STATES } from '@/domain/queue/types'

describe('durable queue state machine', () => {
    it('defines every allowed and rejected state transition explicitly', () => {
        for (const from of GENERATION_JOB_STATES) {
            for (const to of GENERATION_JOB_STATES) {
                const expected = ALLOWED_JOB_TRANSITIONS[from].includes(to)
                expect(canTransitionJob(from, to), `${from} -> ${to}`).toBe(expected)
                if (expected) {
                    expect(() => assertJobTransition(from, to)).not.toThrow()
                } else {
                    expect(() => assertJobTransition(from, to)).toThrow(QueueStateTransitionError)
                }
            }
        }
    })

    it('keeps every terminal state immutable', () => {
        for (const state of GENERATION_JOB_STATES) {
            expect(isTerminalJobState(state)).toBe(TERMINAL_JOB_STATES.includes(state as never))
        }
        for (const terminal of TERMINAL_JOB_STATES) {
            expect(ALLOWED_JOB_TRANSITIONS[terminal]).toEqual([])
        }
    })
})
