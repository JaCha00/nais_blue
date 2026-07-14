export type PersistenceCriticality = 'critical' | 'best-effort'

export type PersistenceFaultKind =
    | 'database-unavailable'
    | 'database-blocked'
    | 'quota-exceeded'
    | 'transaction-aborted'
    | 'transaction-failed'
    | 'readback-mismatch'
    | 'operation-timeout'
    | 'flush-failed'
    | 'unknown'

export type PersistenceFaultCode =
    | 'PERSISTENCE_DATABASE_UNAVAILABLE'
    | 'PERSISTENCE_DATABASE_BLOCKED'
    | 'PERSISTENCE_QUOTA_EXCEEDED'
    | 'PERSISTENCE_TRANSACTION_ABORTED'
    | 'PERSISTENCE_TRANSACTION_FAILED'
    | 'PERSISTENCE_READBACK_MISMATCH'
    | 'PERSISTENCE_OPERATION_TIMEOUT'
    | 'PERSISTENCE_FLUSH_FAILED'
    | 'PERSISTENCE_UNKNOWN_FAILURE'

const FAULT_CODES: Record<PersistenceFaultKind, PersistenceFaultCode> = {
    'database-unavailable': 'PERSISTENCE_DATABASE_UNAVAILABLE',
    'database-blocked': 'PERSISTENCE_DATABASE_BLOCKED',
    'quota-exceeded': 'PERSISTENCE_QUOTA_EXCEEDED',
    'transaction-aborted': 'PERSISTENCE_TRANSACTION_ABORTED',
    'transaction-failed': 'PERSISTENCE_TRANSACTION_FAILED',
    'readback-mismatch': 'PERSISTENCE_READBACK_MISMATCH',
    'operation-timeout': 'PERSISTENCE_OPERATION_TIMEOUT',
    'flush-failed': 'PERSISTENCE_FLUSH_FAILED',
    unknown: 'PERSISTENCE_UNKNOWN_FAILURE',
}

export interface PersistenceFaultContext {
    operation: string
    storeKey?: string
    criticality?: PersistenceCriticality
    kind?: PersistenceFaultKind
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.name : ''
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function inferFaultKind(error: unknown, context: PersistenceFaultContext): PersistenceFaultKind {
    if (context.kind !== undefined) return context.kind
    const name = errorName(error)
    const message = errorMessage(error)
    if (name === 'QuotaExceededError' || /quota exceeded/i.test(message)) return 'quota-exceeded'
    if (name === 'AbortError' || /transaction (?:was )?aborted|transaction abort/i.test(message)) {
        return 'transaction-aborted'
    }
    if (/timed? out|timeout/i.test(message)) return 'operation-timeout'
    if (/blocked/i.test(message)) return 'database-blocked'
    if (/transaction/i.test(message)) return 'transaction-failed'
    return 'unknown'
}

function safeMessage(kind: PersistenceFaultKind, context: PersistenceFaultContext): string {
    const target = context.storeKey === undefined ? 'IndexedDB' : `IndexedDB store ${context.storeKey}`
    switch (kind) {
        case 'database-unavailable': return 'IndexedDB is unavailable.'
        case 'database-blocked': return 'IndexedDB open was blocked by another connection.'
        case 'quota-exceeded': return `${target} exceeded its available storage quota.`
        case 'transaction-aborted': return `${target} transaction was aborted.`
        case 'transaction-failed': return `${target} transaction failed.`
        case 'readback-mismatch': return `${target} write did not match its committed readback.`
        case 'operation-timeout': return `${target} operation timed out.`
        case 'flush-failed': return 'One or more pending IndexedDB writes could not be committed.'
        case 'unknown': return `${target} operation failed.`
    }
}

export class PersistenceFault extends Error {
    readonly code: PersistenceFaultCode
    readonly kind: PersistenceFaultKind
    readonly operation: string
    readonly storeKey?: string
    readonly criticality: PersistenceCriticality

    constructor(kind: PersistenceFaultKind, context: PersistenceFaultContext, cause?: unknown) {
        super(safeMessage(kind, context))
        this.name = 'PersistenceFault'
        this.code = FAULT_CODES[kind]
        this.kind = kind
        this.operation = context.operation
        this.storeKey = context.storeKey
        this.criticality = context.criticality ?? 'critical'
        if (cause !== undefined) {
            const errorWithCause = this as Error & { cause?: unknown }
            errorWithCause.cause = cause
        }
    }
}

export function toPersistenceFault(error: unknown, context: PersistenceFaultContext): PersistenceFault {
    if (error instanceof PersistenceFault) return error
    return new PersistenceFault(inferFaultKind(error, context), context, error)
}
