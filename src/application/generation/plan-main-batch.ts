/**
 * Transitional planning port. Its implementation may still read the legacy
 * draft store, but the use case receives one complete preparation result and
 * can later accept the standalone Main Draft repository unchanged.
 */
export interface MainBatchPlannerPort<TPrepared> {
    getRequestedCount(): number
    prepareBatch(): Promise<readonly TPrepared[]>
}

export interface PlannedMainBatch<TPlanned> {
    readonly requestedCount: number
    readonly items: readonly TPlanned[]
}

export interface PlanMainBatchOptions<TPrepared, TPlanned> {
    readonly planner: MainBatchPlannerPort<TPrepared>
    /** Runs after complete preparation and before any materialization side effects. */
    readonly preflight?: (prepared: readonly TPrepared[]) => void | Promise<void>
    readonly materialize: (prepared: TPrepared, ordinal: number) => TPlanned | Promise<TPlanned>
}

/**
 * Materializes one immutable batch through an injected Planner and rejects
 * partial preparation before Queue persistence. Sequential awaiting preserves
 * the deterministic ordinals of Fragment sequence proposals and resources.
 */
export async function planMainBatch<TPrepared, TPlanned>(
    options: PlanMainBatchOptions<TPrepared, TPlanned>,
): Promise<PlannedMainBatch<TPlanned> | null> {
    const requestedCount = options.planner.getRequestedCount()
    if (!Number.isSafeInteger(requestedCount) || requestedCount <= 0) return null

    const prepared = await options.planner.prepareBatch()
    if (prepared.length !== requestedCount) return null
    await options.preflight?.(prepared)

    const items: TPlanned[] = []
    for (const value of prepared) {
        items.push(await options.materialize(value, items.length))
    }
    return Object.freeze({
        requestedCount,
        items: Object.freeze([...items]),
    })
}
