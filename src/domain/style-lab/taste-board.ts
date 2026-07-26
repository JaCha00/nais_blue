import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'

export const TASTE_BOARD_SCHEMA_VERSION = 1 as const
export const DEFAULT_TASTE_BOARD_ID = 'taste-board:default' as const
export const DEFAULT_TASTE_BOARD_EXPLORATION = 0.35

export interface TasteBoard {
    schemaVersion: typeof TASTE_BOARD_SCHEMA_VERSION
    id: string
    name: string
    exploration: number
    autoEvolution: boolean
    budgetId: string | null
    createdAt: number
    updatedAt: number
}

export interface CreateTasteBoardInput {
    id?: string
    name: string
    exploration?: number
    autoEvolution?: boolean
    budgetId?: string | null
    createdAt: number
    updatedAt?: number
}

function timestamp(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${field} must be a non-negative integer`)
    }
    return value
}

function exploration(value: number | undefined): number {
    if (value === undefined) return DEFAULT_TASTE_BOARD_EXPLORATION
    if (!Number.isFinite(value)) throw new TypeError('TasteBoard exploration must be finite')
    return Math.min(1, Math.max(0, value))
}

/**
 * Board identity and settings are independent from React and persistence. The
 * repository stores this validated entity, while collect events reference its ID
 * so deleting a board never destroys historical preference evidence.
 */
export function createTasteBoard(input: CreateTasteBoardInput): TasteBoard {
    const name = input.name.trim()
    if (!name) throw new TypeError('TasteBoard name must not be empty')
    const createdAt = timestamp(input.createdAt, 'TasteBoard createdAt')
    const updatedAt = timestamp(input.updatedAt ?? createdAt, 'TasteBoard updatedAt')
    if (updatedAt < createdAt) throw new TypeError('TasteBoard updatedAt must not precede createdAt')
    const id = input.id?.trim() || `taste-board:${hashCanonicalValue({ name, createdAt })}`
    const budgetId = input.budgetId?.trim() || null
    return Object.freeze({
        schemaVersion: TASTE_BOARD_SCHEMA_VERSION,
        id,
        name,
        exploration: exploration(input.exploration),
        autoEvolution: input.autoEvolution ?? false,
        budgetId,
        createdAt,
        updatedAt,
    })
}

export function isTasteBoard(value: unknown): value is TasteBoard {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const board = value as Partial<TasteBoard>
    return board.schemaVersion === TASTE_BOARD_SCHEMA_VERSION
        && typeof board.id === 'string'
        && board.id.length > 0
        && typeof board.name === 'string'
        && board.name.trim().length > 0
        && typeof board.exploration === 'number'
        && Number.isFinite(board.exploration)
        && board.exploration >= 0
        && board.exploration <= 1
        && typeof board.autoEvolution === 'boolean'
        && (board.budgetId === null || typeof board.budgetId === 'string')
        && Number.isSafeInteger(board.createdAt)
        && (board.createdAt as number) >= 0
        && Number.isSafeInteger(board.updatedAt)
        && (board.updatedAt as number) >= (board.createdAt as number)
}
