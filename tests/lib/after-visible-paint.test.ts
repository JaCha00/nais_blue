import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleAfterVisiblePaint } from '@/lib/after-visible-paint'

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})
describe('visible paint scheduler', () => {
    it('finishes without waiting for animation frames when the document is hidden', async () => {
        const action = vi.fn()
        const frame = vi.fn(() => 1)
        vi.stubGlobal('document', { visibilityState: 'hidden' })
        vi.stubGlobal('requestAnimationFrame', frame)

        scheduleAfterVisiblePaint(action)
        await Promise.resolve()

        expect(action).toHaveBeenCalledOnce()
        expect(frame).not.toHaveBeenCalled()
    })

    it('uses the bounded fallback if a visible document never paints', () => {
        vi.useFakeTimers()
        const action = vi.fn()
        vi.stubGlobal('document', { visibilityState: 'visible' })
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
        vi.stubGlobal('cancelAnimationFrame', vi.fn())

        scheduleAfterVisiblePaint(action, 3_000)
        vi.advanceTimersByTime(2_999)
        expect(action).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)

        expect(action).toHaveBeenCalledOnce()
    })
})
