import {
    GENERATION_JOB_STATES,
    TERMINAL_JOB_STATES,
    type GenerationJobState,
} from './types'

export const ALLOWED_JOB_TRANSITIONS = Object.freeze({
    queued: Object.freeze(['leased', 'cancelled', 'skipped', 'blocked']),
    leased: Object.freeze(['queued', 'running', 'cancelled', 'recovering', 'blocked']),
    running: Object.freeze(['succeeded', 'failed', 'cancelled', 'recovering', 'blocked']),
    succeeded: Object.freeze([]),
    failed: Object.freeze([]),
    cancelled: Object.freeze([]),
    skipped: Object.freeze([]),
    blocked: Object.freeze(['queued', 'cancelled', 'skipped']),
    recovering: Object.freeze(['queued', 'failed', 'cancelled', 'blocked']),
} satisfies Record<GenerationJobState, readonly GenerationJobState[]>)

export class QueueStateTransitionError extends Error {
    readonly code = 'E_QUEUE_INVALID_TRANSITION' as const

    constructor(readonly from: GenerationJobState, readonly to: GenerationJobState) {
        super(`Invalid durable queue transition: ${from} -> ${to}`)
        this.name = 'QueueStateTransitionError'
    }
}

export function isGenerationJobState(value: unknown): value is GenerationJobState {
    return typeof value === 'string' && GENERATION_JOB_STATES.includes(value as GenerationJobState)
}

export function isTerminalJobState(state: GenerationJobState): boolean {
    return TERMINAL_JOB_STATES.includes(state as typeof TERMINAL_JOB_STATES[number])
}

export function canTransitionJob(from: GenerationJobState, to: GenerationJobState): boolean {
    return (ALLOWED_JOB_TRANSITIONS[from] as readonly GenerationJobState[]).includes(to)
}

export function assertJobTransition(from: GenerationJobState, to: GenerationJobState): void {
    if (!canTransitionJob(from, to)) throw new QueueStateTransitionError(from, to)
}
