import type { ApiSlot } from '@/stores/auth-store'

export interface SceneRequestIdentity {
    sessionId: number
    slot: ApiSlot
    requestId: string
}

export interface SceneRequestControllerLease {
    signal: AbortSignal
    abort: () => void
    release: () => void
}

interface ActiveSceneRequest extends SceneRequestIdentity {
    controller: AbortController
}

const activeRequests = new Map<string, ActiveSceneRequest>()

function requestKey(identity: SceneRequestIdentity): string {
    return `${identity.sessionId}:slot-${identity.slot}:${identity.requestId}`
}

export function acquireSceneRequestController(identity: SceneRequestIdentity): SceneRequestControllerLease {
    const key = requestKey(identity)
    if (activeRequests.has(key)) {
        throw new Error('Scene request controller already exists for this request')
    }

    const controller = new AbortController()
    activeRequests.set(key, { ...identity, controller })
    let released = false

    return {
        signal: controller.signal,
        abort: () => controller.abort(),
        release: () => {
            if (released) return
            released = true
            const active = activeRequests.get(key)
            if (active?.controller === controller) activeRequests.delete(key)
        },
    }
}

export function abortSceneSessionRequests(sessionId: number): number {
    let aborted = 0
    for (const request of activeRequests.values()) {
        if (request.sessionId !== sessionId || request.controller.signal.aborted) continue
        request.controller.abort()
        aborted++
    }
    return aborted
}

export function activeSceneRequestCount(): number {
    return activeRequests.size
}

export function resetSceneRequestControllersForTests(): void {
    for (const request of activeRequests.values()) request.controller.abort()
    activeRequests.clear()
}
