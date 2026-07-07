import { useEffect } from 'react'

const RESIZE_SETTLE_MS = 180

export function useWindowResizePerformanceMode() {
    useEffect(() => {
        let settleTimer: ReturnType<typeof setTimeout> | null = null

        const markResizing = () => {
            document.documentElement.classList.add('is-window-resizing')
            if (settleTimer) {
                clearTimeout(settleTimer)
            }
            settleTimer = setTimeout(() => {
                document.documentElement.classList.remove('is-window-resizing')
                settleTimer = null
            }, RESIZE_SETTLE_MS)
        }

        window.addEventListener('resize', markResizing)
        return () => {
            window.removeEventListener('resize', markResizing)
            if (settleTimer) {
                clearTimeout(settleTimer)
            }
            document.documentElement.classList.remove('is-window-resizing')
        }
    }, [])
}
