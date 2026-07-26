export const DEFAULT_AFTER_PAINT_FALLBACK_MS = 3_000

/**
 * Depends on the browser paint scheduler and is used by startup overlays after
 * React mounts. Hidden documents may suspend animation frames indefinitely, so
 * a bounded timer (or an immediate microtask while hidden) guarantees that the
 * blocking UI is released exactly once.
 */
export function scheduleAfterVisiblePaint(
    action: () => void,
    fallbackMs = DEFAULT_AFTER_PAINT_FALLBACK_MS,
): () => void {
    let completed = false
    let firstFrame: number | null = null
    let secondFrame: number | null = null
    let fallback: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
        if (completed) return
        completed = true
        if (fallback !== null) clearTimeout(fallback)
        if (firstFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(firstFrame)
        if (secondFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(secondFrame)
        action()
    }

    fallback = setTimeout(finish, fallbackMs)
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (hidden || typeof requestAnimationFrame !== 'function') {
        queueMicrotask(finish)
    } else {
        firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(finish)
        })
    }

    return () => {
        if (completed) return
        completed = true
        if (fallback !== null) clearTimeout(fallback)
        if (firstFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(firstFrame)
        if (secondFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(secondFrame)
    }
}
