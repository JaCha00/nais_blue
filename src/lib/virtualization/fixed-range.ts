export interface FixedVirtualRange {
    start: number
    end: number
}

export interface FixedVirtualGridRange extends FixedVirtualRange {
    columnCount: number
    rowStart: number
    rowEnd: number
}

/** DOM-free, end-exclusive fixed-row window shared by large list shells. */
export function calculateFixedVirtualRange({
    itemCount,
    scrollTop,
    viewportHeight,
    rowHeight = 68,
    overscan = 5,
}: {
    itemCount: number
    scrollTop: number
    viewportHeight: number
    rowHeight?: number
    overscan?: number
}): FixedVirtualRange {
    const count = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0
    if (count === 0) return { start: 0, end: 0 }

    const height = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 68
    const padding = Number.isFinite(overscan) ? Math.max(0, Math.trunc(overscan)) : 0
    const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
    const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0
    const firstVisible = Math.min(count - 1, Math.floor(top / height))
    const visibleCount = Math.max(1, Math.ceil(viewport / height))

    return {
        start: Math.max(0, firstVisible - padding),
        end: Math.min(count, firstVisible + visibleCount + padding),
    }
}

/**
 * DOM-free, end-exclusive fixed-grid window.  The caller owns actual DOM
 * measurement; this helper only bounds rendering work for large collections.
 */
export function calculateFixedGridVirtualRange({
    itemCount,
    scrollTop,
    viewportHeight,
    viewportWidth,
    itemWidth,
    itemHeight,
    overscanRows = 2,
}: {
    itemCount: number
    scrollTop: number
    viewportHeight: number
    viewportWidth: number
    itemWidth: number
    itemHeight: number
    overscanRows?: number
}): FixedVirtualGridRange {
    const count = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0
    const width = Number.isFinite(itemWidth) && itemWidth > 0 ? itemWidth : 160
    const height = Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : 180
    const availableWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : width
    const columns = Math.max(1, Math.floor(availableWidth / width))
    const rowCount = Math.ceil(count / columns)
    if (rowCount === 0) return { start: 0, end: 0, columnCount: columns, rowStart: 0, rowEnd: 0 }

    const padding = Number.isFinite(overscanRows) ? Math.max(0, Math.trunc(overscanRows)) : 0
    const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
    const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0
    const firstVisible = Math.min(rowCount - 1, Math.floor(top / height))
    const visibleRows = Math.max(1, Math.ceil(viewport / height))
    const rowStart = Math.max(0, firstVisible - padding)
    const rowEnd = Math.min(rowCount, firstVisible + visibleRows + padding)

    return {
        start: rowStart * columns,
        end: Math.min(count, rowEnd * columns),
        columnCount: columns,
        rowStart,
        rowEnd,
    }
}
