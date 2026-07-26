import {
    DEFAULT_TASTE_BOARD_ID,
    createTasteBoard as createTasteBoardEntity,
    type TasteBoard,
} from '@/domain/style-lab'
import type { StyleLabRepository } from './style-lab-repository'

export interface EnsureTasteBoardsInput {
    repository: StyleLabRepository
    defaultName: string
    now?: number
}

/** Creates the stable default board only when a migrated repository has none. */
export async function ensureTasteBoards(input: EnsureTasteBoardsInput): Promise<TasteBoard[]> {
    const existing = await input.repository.listTasteBoards()
    if (existing.length > 0) return existing
    const board = createTasteBoardEntity({
        id: DEFAULT_TASTE_BOARD_ID,
        name: input.defaultName,
        createdAt: input.now ?? Date.now(),
    })
    await input.repository.putTasteBoard(board)
    return [board]
}

export async function createTasteBoard(input: {
    repository: StyleLabRepository
    name: string
    now?: number
}): Promise<TasteBoard[]> {
    const board = createTasteBoardEntity({ name: input.name, createdAt: input.now ?? Date.now() })
    await input.repository.putTasteBoard(board)
    return input.repository.listTasteBoards()
}

export async function updateTasteBoard(input: {
    repository: StyleLabRepository
    board: TasteBoard
    name?: string
    exploration?: number
    autoEvolution?: boolean
    budgetId?: string | null
    now?: number
}): Promise<TasteBoard[]> {
    const board = createTasteBoardEntity({
        id: input.board.id,
        name: input.name ?? input.board.name,
        exploration: input.exploration ?? input.board.exploration,
        autoEvolution: input.autoEvolution ?? input.board.autoEvolution,
        budgetId: input.budgetId === undefined ? input.board.budgetId : input.budgetId,
        createdAt: input.board.createdAt,
        updatedAt: Math.max(input.board.updatedAt, input.now ?? Date.now()),
    })
    await input.repository.putTasteBoard(board)
    return input.repository.listTasteBoards()
}

export async function deleteTasteBoard(input: {
    repository: StyleLabRepository
    boardId: string
}): Promise<TasteBoard[]> {
    await input.repository.deleteTasteBoard(input.boardId)
    return input.repository.listTasteBoards()
}
