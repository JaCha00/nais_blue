import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'

export const STYLE_RENDER_BUDGET_SCHEMA_VERSION = 1 as const

export interface StyleRenderBudget {
    schemaVersion: typeof STYLE_RENDER_BUDGET_SCHEMA_VERSION
    id: string
    boardId: string | null
    limit: number
    reserved: number
    spent: number
    unit: 'render'
    createdAt: number
    updatedAt: number
}

export type StyleRenderReservationState = 'reserved' | 'spent' | 'released'

export interface StyleRenderReservation {
    schemaVersion: typeof STYLE_RENDER_BUDGET_SCHEMA_VERSION
    id: string
    budgetId: string
    units: number
    state: StyleRenderReservationState
    idempotencyKey: string
    jobId: string | null
    createdAt: number
    settledAt: number | null
}

export function createStyleRenderBudget(input: {
    id: string
    boardId?: string | null
    limit: number
    createdAt: number
}): StyleRenderBudget {
    if (!input.id.trim()) throw new TypeError('Render budget ID must not be empty')
    if (!Number.isSafeInteger(input.limit) || input.limit < 0) {
        throw new TypeError('Render budget limit must be a non-negative integer')
    }
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
        throw new TypeError('Render budget createdAt must be a non-negative integer')
    }
    return Object.freeze({
        schemaVersion: STYLE_RENDER_BUDGET_SCHEMA_VERSION,
        id: input.id.trim(),
        boardId: input.boardId?.trim() || null,
        limit: input.limit,
        reserved: 0,
        spent: 0,
        unit: 'render',
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
    })
}

export function createStyleRenderReservation(input: {
    budgetId: string
    units: number
    idempotencyKey: string
    createdAt: number
}): StyleRenderReservation {
    if (!input.budgetId.trim() || !input.idempotencyKey.trim()) {
        throw new TypeError('Render reservation requires budget and idempotency identities')
    }
    if (!Number.isSafeInteger(input.units) || input.units <= 0) {
        throw new TypeError('Render reservation units must be a positive integer')
    }
    return Object.freeze({
        schemaVersion: STYLE_RENDER_BUDGET_SCHEMA_VERSION,
        id: `render-reservation:${hashCanonicalValue({
            budgetId: input.budgetId,
            idempotencyKey: input.idempotencyKey,
        })}`,
        budgetId: input.budgetId,
        units: input.units,
        state: 'reserved',
        idempotencyKey: input.idempotencyKey,
        jobId: null,
        createdAt: input.createdAt,
        settledAt: null,
    })
}

export function isStyleRenderBudget(value: unknown): value is StyleRenderBudget {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const budget = value as Partial<StyleRenderBudget>
    return budget.schemaVersion === STYLE_RENDER_BUDGET_SCHEMA_VERSION
        && typeof budget.id === 'string'
        && budget.id.length > 0
        && (budget.boardId === null || typeof budget.boardId === 'string')
        && Number.isSafeInteger(budget.limit)
        && Number.isSafeInteger(budget.reserved)
        && Number.isSafeInteger(budget.spent)
        && (budget.limit as number) >= 0
        && (budget.reserved as number) >= 0
        && (budget.spent as number) >= 0
        && (budget.reserved as number) + (budget.spent as number) <= (budget.limit as number)
        && budget.unit === 'render'
        && Number.isSafeInteger(budget.createdAt)
        && Number.isSafeInteger(budget.updatedAt)
        && (budget.createdAt as number) >= 0
        && (budget.updatedAt as number) >= (budget.createdAt as number)
}

export function isStyleRenderReservation(value: unknown): value is StyleRenderReservation {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const reservation = value as Partial<StyleRenderReservation>
    return reservation.schemaVersion === STYLE_RENDER_BUDGET_SCHEMA_VERSION
        && typeof reservation.id === 'string'
        && reservation.id.length > 0
        && typeof reservation.budgetId === 'string'
        && reservation.budgetId.length > 0
        && Number.isSafeInteger(reservation.units)
        && (reservation.units as number) > 0
        && (reservation.state === 'reserved' || reservation.state === 'spent' || reservation.state === 'released')
        && typeof reservation.idempotencyKey === 'string'
        && reservation.idempotencyKey.length > 0
        && (reservation.jobId === null || typeof reservation.jobId === 'string')
        && Number.isSafeInteger(reservation.createdAt)
        && (reservation.createdAt as number) >= 0
        && (reservation.settledAt === null || Number.isSafeInteger(reservation.settledAt))
        && (reservation.settledAt === null
            || (reservation.settledAt as number) >= (reservation.createdAt as number))
}
