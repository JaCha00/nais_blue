import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router'

import { useQueueStore } from '@/stores/queue-store'

const LegacySceneRuntime = lazy(() => import('./LegacySceneRuntime'))
const R2FeatureRuntime = lazy(() => import('./R2FeatureRuntime'))

function isSceneRoute(pathname: string): boolean {
    return pathname === '/scenes' || pathname.startsWith('/scenes/')
}

function isR2Route(pathname: string): boolean {
    return pathname === '/r2'
        || pathname.startsWith('/r2/')
        || /^\/guided-preview\/(?:guide|task|work)\/library\/r2(?:\/|$)/.test(pathname)
}

/**
 * Activates optional runtime chunks from router state and the queue authority.
 * Each latch stays true for the App lifetime so navigation cannot unmount an
 * active Scene worker or R2 upload after its feature has first been requested.
 */
export function FeatureRuntimeProviders() {
    const { pathname } = useLocation()
    const executionAuthority = useQueueStore(state => state.executionAuthority)
    const sceneRequested = executionAuthority === 'legacy' || isSceneRoute(pathname)
    const r2Requested = isR2Route(pathname)
    const [sceneActivated, setSceneActivated] = useState(sceneRequested)
    const [r2Activated, setR2Activated] = useState(r2Requested)

    useEffect(() => {
        if (sceneRequested) setSceneActivated(true)
    }, [sceneRequested])

    useEffect(() => {
        if (r2Requested) setR2Activated(true)
    }, [r2Requested])

    return (
        <>
            {sceneActivated && (
                <Suspense fallback={null}>
                    <LegacySceneRuntime />
                </Suspense>
            )}
            {r2Activated && (
                <Suspense fallback={null}>
                    <R2FeatureRuntime />
                </Suspense>
            )}
        </>
    )
}
