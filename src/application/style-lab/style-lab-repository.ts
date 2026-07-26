import type {
    PreferenceProjection,
    StyleEvaluationContext,
    StylePreferenceEvent,
    StylePreviewAsset,
    StyleRenderBudget,
    StyleRenderReservation,
    StyleRenderReservationState,
    EvolutionLineage,
    StyleEvolutionArchiveCell,
    TasteBoard,
} from '@/domain/style-lab'

/**
 * Application use cases depend on this port, while IndexedDB details remain in
 * services. Batching a context with its events prevents an exposure from pointing
 * at an evaluation contract that was never durably recorded.
 */
export interface StyleLabRepository {
    putEvaluationContext(context: StyleEvaluationContext): Promise<void>
    listEvaluationContexts(): Promise<StyleEvaluationContext[]>
    appendPreferenceEvents(
        context: StyleEvaluationContext | null,
        events: readonly StylePreferenceEvent[],
    ): Promise<void>
    listPreferenceEvents(): Promise<StylePreferenceEvent[]>
    listRecentPreferenceEvents(limit?: number): Promise<StylePreferenceEvent[]>
    replacePreferenceProjections(projections: readonly PreferenceProjection[]): Promise<void>
    listPreferenceProjections(): Promise<PreferenceProjection[]>
    putTasteBoard(board: TasteBoard): Promise<void>
    deleteTasteBoard(boardId: string): Promise<void>
    listTasteBoards(): Promise<TasteBoard[]>
    putPreviewAsset(asset: StylePreviewAsset): Promise<void>
    listPreviewAssets(comboId?: string): Promise<StylePreviewAsset[]>
    findPreviewAssetsBySha256(sha256: string): Promise<StylePreviewAsset[]>
    putRenderBudget(budget: StyleRenderBudget): Promise<void>
    getRenderBudget(budgetId: string): Promise<StyleRenderBudget | null>
    listRenderBudgets(): Promise<StyleRenderBudget[]>
    reserveRenderBudget(input: {
        budgetId: string
        units: number
        idempotencyKey: string
        createdAt: number
    }): Promise<StyleRenderReservation | null>
    bindRenderReservationJob(reservationId: string, jobId: string): Promise<StyleRenderReservation>
    settleRenderReservation(
        reservationId: string,
        state: Exclude<StyleRenderReservationState, 'reserved'>,
        settledAt: number,
    ): Promise<StyleRenderReservation>
    listRenderReservations(state?: StyleRenderReservationState): Promise<StyleRenderReservation[]>
    putEvolutionLineages(lineages: readonly EvolutionLineage[]): Promise<void>
    listEvolutionLineages(childId?: string): Promise<EvolutionLineage[]>
    replaceEvolutionArchive(boardId: string, cells: readonly StyleEvolutionArchiveCell[]): Promise<void>
    listEvolutionArchive(boardId?: string): Promise<StyleEvolutionArchiveCell[]>
}
