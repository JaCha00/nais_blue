import { type ReactNode } from 'react'

import { CoreRuntimeProviders } from './CoreRuntimeProviders'
import { FeatureRuntimeProviders } from './FeatureRuntimeProviders'

interface RuntimeProvidersProps {
    children: ReactNode
}

/**
 * Composes the always-on core with route-activated feature runtimes. App owns
 * this boundary, so both layers survive page changes without placing Scene or
 * R2 implementation imports in the Main startup graph.
 */
export function RuntimeProviders({ children }: RuntimeProvidersProps) {
    return (
        <CoreRuntimeProviders>
            <FeatureRuntimeProviders />
            {children}
        </CoreRuntimeProviders>
    )
}
