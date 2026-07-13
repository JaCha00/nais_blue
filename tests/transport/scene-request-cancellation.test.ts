import { afterEach, describe, expect, it } from 'vitest'

import {
    abortSceneSessionRequests,
    acquireSceneRequestController,
    activeSceneRequestCount,
    resetSceneRequestControllersForTests,
} from '@/lib/scene-generation/request-cancellation'

describe('Scene request cancellation ownership', () => {
    afterEach(() => resetSceneRequestControllersForTests())

    it('owns controllers by session, slot, and request and aborts only the cancelled session', () => {
        const first = acquireSceneRequestController({ sessionId: 11, slot: 1, requestId: 'request-a' })
        const second = acquireSceneRequestController({ sessionId: 11, slot: 2, requestId: 'request-b' })
        const nextSession = acquireSceneRequestController({ sessionId: 12, slot: 1, requestId: 'request-c' })

        expect(activeSceneRequestCount()).toBe(3)
        expect(abortSceneSessionRequests(11)).toBe(2)
        expect(first.signal.aborted).toBe(true)
        expect(second.signal.aborted).toBe(true)
        expect(nextSession.signal.aborted).toBe(false)

        first.release()
        second.release()
        nextSession.release()
        expect(activeSceneRequestCount()).toBe(0)
    })
})
