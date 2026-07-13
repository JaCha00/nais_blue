export const SCENE_GRID_VIRTUALIZATION_THRESHOLD = 120
export const SCENE_GRID_OVERSCAN_ROWS = 2

export interface SceneGridVirtualRange {
    startRow: number
    endRow: number
    startIndex: number
    endIndex: number
    paddingTop: number
    paddingBottom: number
}

/**
 * Calculates a row-aligned window so a responsive grid can keep DnD item
 * ordering stable while mounting only the nearby scene cards.
 */
export function calculateSceneGridVirtualRange({
    itemCount,
    columnCount,
    scrollTop,
    viewportHeight,
    rowHeight,
    overscanRows = SCENE_GRID_OVERSCAN_ROWS,
}: {
    itemCount: number
    columnCount: number
    scrollTop: number
    viewportHeight: number
    rowHeight: number
    overscanRows?: number
}): SceneGridVirtualRange {
    const count = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0
    const columns = Number.isFinite(columnCount) ? Math.max(1, Math.trunc(columnCount)) : 1
    const safeRowHeight = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 1
    const rowCount = Math.ceil(count / columns)
    if (rowCount === 0) {
        return { startRow: 0, endRow: 0, startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 }
    }
    const safeScrollTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
    const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0
    const overscan = Number.isFinite(overscanRows) ? Math.max(0, Math.trunc(overscanRows)) : 0
    const firstVisibleRow = Math.min(rowCount - 1, Math.floor(safeScrollTop / safeRowHeight))
    const visibleRows = Math.max(1, Math.ceil(safeViewportHeight / safeRowHeight))
    const startRow = Math.max(0, firstVisibleRow - overscan)
    const endRow = Math.min(rowCount, firstVisibleRow + visibleRows + overscan)
    return {
        startRow,
        endRow,
        startIndex: startRow * columns,
        endIndex: Math.min(count, endRow * columns),
        paddingTop: startRow * safeRowHeight,
        paddingBottom: Math.max(0, (rowCount - endRow) * safeRowHeight),
    }
}
