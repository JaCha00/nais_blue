import type { StateStorage } from 'zustand/middleware'
import type { StyleLabRepository } from '@/application/style-lab/style-lab-repository'
import { canonicalSerialize } from '@/domain/composition/canonical-serialize'
import {
    STYLE_LAB_REPOSITORY_SCHEMA_VERSION,
    STYLE_LAB_REPOSITORY_STORE_KEY,
    isStyleEvaluationContext,
    isPreferenceProjection,
    isStylePreferenceEvent,
    isStylePreviewAsset,
    isStyleRenderBudget,
    isStyleRenderReservation,
    isEvolutionLineage,
    isStyleEvolutionArchiveCell,
    isTasteBoard,
    type PreferenceProjection,
    type StyleEvaluationContext,
    type StylePreferenceEvent,
    type StylePreviewAsset,
    type StyleRenderBudget,
    type StyleRenderReservation,
    type StyleRenderReservationState,
    type EvolutionLineage,
    type StyleEvolutionArchiveCell,
    type TasteBoard,
    createStyleRenderReservation,
} from '@/domain/style-lab'
import { indexedDBStorage } from '@/lib/indexed-db'

interface StyleLabRepositoryDocument {
    schemaVersion: typeof STYLE_LAB_REPOSITORY_SCHEMA_VERSION
    contexts: StyleEvaluationContext[]
    events: StylePreferenceEvent[]
    projections: PreferenceProjection[]
    boards: TasteBoard[]
    assets: StylePreviewAsset[]
    budgets: StyleRenderBudget[]
    reservations: StyleRenderReservation[]
    lineages: EvolutionLineage[]
    archiveCells: StyleEvolutionArchiveCell[]
}

function emptyDocument(): StyleLabRepositoryDocument {
    return {
        schemaVersion: STYLE_LAB_REPOSITORY_SCHEMA_VERSION,
        contexts: [],
        events: [],
        projections: [],
        boards: [],
        assets: [],
        budgets: [],
        reservations: [],
        lineages: [],
        archiveCells: [],
    }
}

function parseDocument(serialized: string | null): StyleLabRepositoryDocument {
    if (serialized === null) return emptyDocument()
    const parsed = JSON.parse(serialized) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new TypeError('Invalid Style-Lab repository document')
    }
    // Persisted input is deliberately wider than the current document type: schema
    // v1 has events only and v2 adds projections; successful parsing returns v3.
    const document = parsed as {
        schemaVersion?: number
        contexts?: unknown
        events?: unknown
        projections?: unknown
        boards?: unknown
        assets?: unknown
        budgets?: unknown
        reservations?: unknown
        lineages?: unknown
        archiveCells?: unknown
    }
    if ((document.schemaVersion !== 1
            && document.schemaVersion !== 2
            && document.schemaVersion !== 3
            && document.schemaVersion !== 4
            && document.schemaVersion !== STYLE_LAB_REPOSITORY_SCHEMA_VERSION)
        || !Array.isArray(document.contexts)
        || !document.contexts.every(isStyleEvaluationContext)
        || !Array.isArray(document.events)
        || !document.events.every(isStylePreferenceEvent)) {
        throw new TypeError('Unsupported or invalid Style-Lab repository schema')
    }
    // Projection state is disposable acceleration data. Invalid or older model
    // output must never make the authoritative context/event log unreadable.
    const projections = document.schemaVersion >= 2
        && Array.isArray(document.projections)
        && document.projections.every(isPreferenceProjection)
        ? document.projections as PreferenceProjection[]
        : []
    const boards = document.schemaVersion >= 3
        && Array.isArray(document.boards)
        && document.boards.every(isTasteBoard)
        ? document.boards as TasteBoard[]
        : []
    if (document.schemaVersion >= 3
        && (!Array.isArray(document.boards)
            || boards.length !== document.boards.length
            || new Set(boards.map(board => board.id)).size !== boards.length)) {
        throw new TypeError('Invalid Style-Lab TasteBoard repository state')
    }
    const assets = document.schemaVersion >= 4
        && Array.isArray(document.assets)
        && document.assets.every(isStylePreviewAsset)
        ? document.assets as StylePreviewAsset[]
        : []
    const budgets = document.schemaVersion >= 4
        && Array.isArray(document.budgets)
        && document.budgets.every(isStyleRenderBudget)
        ? document.budgets as StyleRenderBudget[]
        : []
    const reservations = document.schemaVersion >= 4
        && Array.isArray(document.reservations)
        && document.reservations.every(isStyleRenderReservation)
        ? document.reservations as StyleRenderReservation[]
        : []
    if (document.schemaVersion >= 4
        && (assets.length !== (document.assets as unknown[]).length
            || budgets.length !== (document.budgets as unknown[]).length
            || reservations.length !== (document.reservations as unknown[]).length
            || new Set(assets.map(asset => asset.id)).size !== assets.length
            || new Set(budgets.map(budget => budget.id)).size !== budgets.length
            || new Set(reservations.map(reservation => reservation.id)).size !== reservations.length)) {
        throw new TypeError('Invalid Style-Lab asset or render-budget repository state')
    }
    const lineages = document.schemaVersion >= 5
        && Array.isArray(document.lineages)
        && document.lineages.every(isEvolutionLineage)
        ? document.lineages as EvolutionLineage[]
        : []
    const archiveCells = document.schemaVersion >= 5
        && Array.isArray(document.archiveCells)
        && document.archiveCells.every(isStyleEvolutionArchiveCell)
        ? document.archiveCells as StyleEvolutionArchiveCell[]
        : []
    if (document.schemaVersion >= 5
        && (lineages.length !== (document.lineages as unknown[]).length
            || archiveCells.length !== (document.archiveCells as unknown[]).length
            || new Set(lineages.map(lineage => lineage.id)).size !== lineages.length
            || new Set(lineages.map(lineage => lineage.childId)).size !== lineages.length
            || new Set(archiveCells.map(cell => cell.id)).size !== archiveCells.length)) {
        throw new TypeError('Invalid Style-Lab evolution repository state')
    }
    return {
        schemaVersion: STYLE_LAB_REPOSITORY_SCHEMA_VERSION,
        contexts: [...document.contexts] as StyleEvaluationContext[],
        events: [...document.events] as StylePreferenceEvent[],
        projections: [...projections],
        boards: [...boards],
        assets: [...assets],
        budgets: [...budgets],
        reservations: [...reservations],
        lineages: [...lineages],
        archiveCells: [...archiveCells],
    }
}

/**
 * Preference events use the shared IndexedDB key-value infrastructure so backup,
 * restore, diagnostics, and close-flush behavior remain unified. A per-instance
 * write tail serializes read-modify-write batches and preserves append order.
 */
export class IndexedDbStyleLabRepository implements StyleLabRepository {
    private writeTail: Promise<void> = Promise.resolve()

    constructor(
        private readonly storage: StateStorage = indexedDBStorage,
        private readonly storageKey = STYLE_LAB_REPOSITORY_STORE_KEY,
    ) {}

    private enqueueWrite(operation: () => Promise<void>): Promise<void> {
        const result = this.writeTail.then(operation, operation)
        this.writeTail = result.catch(() => undefined)
        return result
    }

    async putEvaluationContext(context: StyleEvaluationContext): Promise<void> {
        if (!isStyleEvaluationContext(context)) throw new TypeError('Invalid Style-Lab evaluation context')
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            const existing = document.contexts.find(item => item.id === context.id)
            if (existing !== undefined && canonicalSerialize(existing) !== canonicalSerialize(context)) {
                throw new Error(`Style-Lab context ID collision: ${context.id}`)
            }
            if (existing === undefined) document.contexts.push(context)
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    async listEvaluationContexts(): Promise<StyleEvaluationContext[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return [...document.contexts]
    }

    async appendPreferenceEvents(
        context: StyleEvaluationContext | null,
        events: readonly StylePreferenceEvent[],
    ): Promise<void> {
        if (events.length === 0) return
        if (context !== null && !isStyleEvaluationContext(context)) {
            throw new TypeError('Invalid Style-Lab evaluation context')
        }
        if (!events.every(isStylePreferenceEvent)) {
            throw new TypeError('Invalid Style-Lab preference event')
        }
        if (context !== null && events.some(event => event.contextId !== context.id)) {
            throw new TypeError('Preference event context does not match appended context')
        }

        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            if (context !== null && !document.contexts.some(existing => existing.id === context.id)) {
                document.contexts.push(context)
            }

            const existingById = new Map(document.events.map(event => [event.id, event]))
            for (const event of events) {
                const existing = existingById.get(event.id)
                if (existing !== undefined) {
                    if (canonicalSerialize(existing) !== canonicalSerialize(event)) {
                        throw new Error(`Style-Lab event ID collision: ${event.id}`)
                    }
                    continue
                }
                document.events.push(event)
                existingById.set(event.id, event)
            }
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    async listRecentPreferenceEvents(limit = 100): Promise<StylePreferenceEvent[]> {
        if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('limit must be a non-negative integer')
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return limit === 0 ? [] : document.events.slice(-limit)
    }

    async listPreferenceEvents(): Promise<StylePreferenceEvent[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return [...document.events]
    }

    async replacePreferenceProjections(
        projections: readonly PreferenceProjection[],
    ): Promise<void> {
        if (!projections.every(isPreferenceProjection)) {
            throw new TypeError('Invalid Style-Lab preference projection')
        }
        const unique = new Map(projections.map(projection => [projection.comboId, projection]))
        if (unique.size !== projections.length) {
            throw new TypeError('Duplicate Style-Lab preference projection comboId')
        }
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            document.projections = [...projections]
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    async listPreferenceProjections(): Promise<PreferenceProjection[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return [...document.projections]
    }

    async putTasteBoard(board: TasteBoard): Promise<void> {
        if (!isTasteBoard(board)) throw new TypeError('Invalid Style-Lab TasteBoard')
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            const index = document.boards.findIndex(existing => existing.id === board.id)
            if (index === -1) document.boards.push(board)
            else document.boards[index] = board
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    /** Board deletion preserves append-only collect events for audit and recovery. */
    async deleteTasteBoard(boardId: string): Promise<void> {
        const normalizedId = boardId.trim()
        if (!normalizedId) throw new TypeError('TasteBoard ID must not be empty')
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            document.boards = document.boards.filter(board => board.id !== normalizedId)
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    async listTasteBoards(): Promise<TasteBoard[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return [...document.boards].sort((left, right) => (
            left.createdAt - right.createdAt || left.id.localeCompare(right.id)
        ))
    }

    /** Assets are immutable and content-addressed; an equal ID may only replay the exact record. */
    async putPreviewAsset(asset: StylePreviewAsset): Promise<void> {
        if (!isStylePreviewAsset(asset)) throw new TypeError('Invalid Style-Lab preview asset')
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            const existing = document.assets.find(item => item.id === asset.id)
            if (existing !== undefined && canonicalSerialize(existing) !== canonicalSerialize(asset)) {
                throw new Error(`Style-Lab asset ID collision: ${asset.id}`)
            }
            if (existing === undefined) document.assets.push(asset)
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    async listPreviewAssets(comboId?: string): Promise<StylePreviewAsset[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return document.assets.filter(asset => comboId === undefined || asset.comboId === comboId)
    }

    async findPreviewAssetsBySha256(sha256: string): Promise<StylePreviewAsset[]> {
        const normalized = sha256.toLowerCase()
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return document.assets.filter(asset => asset.sha256 === normalized)
    }

    async putRenderBudget(budget: StyleRenderBudget): Promise<void> {
        if (!isStyleRenderBudget(budget)) throw new TypeError('Invalid Style-Lab render budget')
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            const index = document.budgets.findIndex(item => item.id === budget.id)
            if (index === -1) document.budgets.push(budget)
            else {
                const current = document.budgets[index]
                if (budget.reserved !== current.reserved || budget.spent !== current.spent) {
                    throw new Error('Render budget counters are managed by reservations')
                }
                document.budgets[index] = budget
            }
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    async getRenderBudget(budgetId: string): Promise<StyleRenderBudget | null> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return document.budgets.find(budget => budget.id === budgetId) ?? null
    }

    async listRenderBudgets(): Promise<StyleRenderBudget[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return [...document.budgets]
    }

    /** Reservation and budget counters share one serialized transaction boundary. */
    async reserveRenderBudget(input: {
        budgetId: string
        units: number
        idempotencyKey: string
        createdAt: number
    }): Promise<StyleRenderReservation | null> {
        let result: StyleRenderReservation | null = null
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            const candidate = createStyleRenderReservation(input)
            const existing = document.reservations.find(item => item.id === candidate.id)
            if (existing !== undefined) {
                result = existing
                return
            }
            const budgetIndex = document.budgets.findIndex(item => item.id === input.budgetId)
            if (budgetIndex === -1) throw new Error(`Unknown Style-Lab render budget: ${input.budgetId}`)
            const budget = document.budgets[budgetIndex]
            if (budget.reserved + budget.spent + input.units > budget.limit) return
            document.budgets[budgetIndex] = {
                ...budget,
                reserved: budget.reserved + input.units,
                updatedAt: Math.max(budget.updatedAt, input.createdAt),
            }
            document.reservations.push(candidate)
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
            result = candidate
        })
        return result
    }

    async bindRenderReservationJob(reservationId: string, jobId: string): Promise<StyleRenderReservation> {
        let result: StyleRenderReservation | null = null
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            const index = document.reservations.findIndex(item => item.id === reservationId)
            if (index === -1) throw new Error(`Unknown render reservation: ${reservationId}`)
            const current = document.reservations[index]
            if (current.jobId !== null && current.jobId !== jobId) {
                throw new Error(`Render reservation is already bound: ${reservationId}`)
            }
            const next = { ...current, jobId }
            document.reservations[index] = next
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
            result = next
        })
        if (result === null) throw new Error(`Failed to bind render reservation: ${reservationId}`)
        return result
    }

    async settleRenderReservation(
        reservationId: string,
        state: Exclude<StyleRenderReservationState, 'reserved'>,
        settledAt: number,
    ): Promise<StyleRenderReservation> {
        let result: StyleRenderReservation | null = null
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            const reservationIndex = document.reservations.findIndex(item => item.id === reservationId)
            if (reservationIndex === -1) throw new Error(`Unknown render reservation: ${reservationId}`)
            const current = document.reservations[reservationIndex]
            if (current.state !== 'reserved') {
                if (current.state !== state) throw new Error(`Render reservation is already ${current.state}`)
                result = current
                return
            }
            const budgetIndex = document.budgets.findIndex(item => item.id === current.budgetId)
            if (budgetIndex === -1) throw new Error(`Unknown Style-Lab render budget: ${current.budgetId}`)
            const budget = document.budgets[budgetIndex]
            document.budgets[budgetIndex] = {
                ...budget,
                reserved: Math.max(0, budget.reserved - current.units),
                spent: state === 'spent' ? budget.spent + current.units : budget.spent,
                updatedAt: Math.max(budget.updatedAt, settledAt),
            }
            const next: StyleRenderReservation = { ...current, state, settledAt }
            document.reservations[reservationIndex] = next
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
            result = next
        })
        if (result === null) throw new Error(`Failed to settle render reservation: ${reservationId}`)
        return result
    }

    async listRenderReservations(state?: StyleRenderReservationState): Promise<StyleRenderReservation[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return document.reservations.filter(reservation => state === undefined || reservation.state === state)
    }

    async putEvolutionLineages(lineages: readonly EvolutionLineage[]): Promise<void> {
        if (!lineages.every(isEvolutionLineage)) throw new TypeError('Invalid Style-Lab evolution lineage')
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            for (const lineage of lineages) {
                const byChild = document.lineages.find(item => item.childId === lineage.childId)
                if (byChild !== undefined && canonicalSerialize(byChild) !== canonicalSerialize(lineage)) {
                    throw new Error(`Style-Lab child already has different lineage: ${lineage.childId}`)
                }
                const byId = document.lineages.find(item => item.id === lineage.id)
                if (byId !== undefined && canonicalSerialize(byId) !== canonicalSerialize(lineage)) {
                    throw new Error(`Style-Lab lineage ID collision: ${lineage.id}`)
                }
                if (byChild === undefined && byId === undefined) document.lineages.push(lineage)
            }
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    async listEvolutionLineages(childId?: string): Promise<EvolutionLineage[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return document.lineages.filter(lineage => childId === undefined || lineage.childId === childId)
    }

    /** One board archive is replaced as a projection while other boards remain intact. */
    async replaceEvolutionArchive(
        boardId: string,
        cells: readonly StyleEvolutionArchiveCell[],
    ): Promise<void> {
        if (!boardId.trim() || !cells.every(isStyleEvolutionArchiveCell)
            || cells.some(cell => cell.boardId !== boardId)
            || new Set(cells.map(cell => cell.id)).size !== cells.length) {
            throw new TypeError('Invalid Style-Lab evolution archive replacement')
        }
        await this.enqueueWrite(async () => {
            const document = parseDocument(await this.storage.getItem(this.storageKey))
            document.archiveCells = [
                ...document.archiveCells.filter(cell => cell.boardId !== boardId),
                ...cells,
            ]
            await this.storage.setItem(this.storageKey, JSON.stringify(document))
        })
    }

    async listEvolutionArchive(boardId?: string): Promise<StyleEvolutionArchiveCell[]> {
        await this.writeTail
        const document = parseDocument(await this.storage.getItem(this.storageKey))
        return document.archiveCells
            .filter(cell => boardId === undefined || cell.boardId === boardId)
            .sort((left, right) => left.key.localeCompare(right.key))
    }
}

let styleLabRepository: IndexedDbStyleLabRepository | null = null

export function getStyleLabRepository(): IndexedDbStyleLabRepository {
    styleLabRepository ??= new IndexedDbStyleLabRepository()
    return styleLabRepository
}
