/**
 * Transitional planning port. Its implementation may still read the legacy
 * draft store, but the use case depends only on an ordered preparation stream
 * and can later accept the standalone Main Draft repository unchanged.
 */
export interface MainBatchPlannerPort<TPrepared> {
    getRequestedCount(): number
    capturePrepared(collect: (prepared: TPrepared) => void | Promise<void>): Promise<void>
}

export interface PlannedMainBatch<TPlanned> {
    readonly requestedCount: number
    readonly items: readonly TPlanned[]
}

export interface PlanMainBatchOptions<TPrepared, TPlanned> {
    readonly planner: MainBatchPlannerPort<TPrepared>
    readonly materialize: (prepared: TPrepared, ordinal: number) => TPlanned | Promise<TPlanned>
}

/**
 * Materializes one immutable batch through an injected Planner and rejects
 * partial capture before Queue persistence. The callback is awaited in capture
 * order so Fragment sequence proposals keep the same deterministic ordinals.
 */
export async function planMainBatch<TPrepared, TPlanned>(
    options: PlanMainBatchOptions<TPrepared, TPlanned>,
): Promise<PlannedMainBatch<TPlanned> | null> {
    const requestedCount = options.planner.getRequestedCount()
    if (!Number.isSafeInteger(requestedCount) || requestedCount <= 0) return null

    const items: TPlanned[] = []
    await options.planner.capturePrepared(async prepared => {
        items.push(await options.materialize(prepared, items.length))
    })

    if (items.length !== requestedCount) return null
    return Object.freeze({
        requestedCount,
        items: Object.freeze([...items]),
    })
}
