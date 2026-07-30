import { type ReactNode } from 'react'

import { useDurableQueueRuntime } from '@/hooks/useDurableQueueRuntime'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useWindowResizePerformanceMode } from '@/hooks/useWindowResizePerformanceMode'

interface CoreRuntimeProvidersProps {
    children: ReactNode
}

/**
 * Owns route-independent coordinators and listeners required by every screen.
 * App lifetime prevents duplicate queue workers, update checks, shortcuts, and
 * resize subscriptions while feature runtimes remain separately loadable.
 */
export function CoreRuntimeProviders({ children }: CoreRuntimeProvidersProps) {
    useDurableQueueRuntime()
    useUpdateChecker()
    useShortcuts()
    useWindowResizePerformanceMode()

    return children
}
