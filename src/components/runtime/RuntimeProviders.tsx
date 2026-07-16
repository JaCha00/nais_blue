import { type ReactNode } from 'react'
import { useDurableQueueRuntime } from '@/hooks/useDurableQueueRuntime'
import { useR2UploadRuntime } from '@/hooks/useR2UploadRuntime'
import { useSceneGeneration } from '@/hooks/useSceneGeneration'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useUpdateChecker } from '@/hooks/useUpdateChecker'
import { useWindowResizePerformanceMode } from '@/hooks/useWindowResizePerformanceMode'

interface RuntimeProvidersProps {
    children: ReactNode
}

/**
 * Route-independent runtime owner. Queue/R2/scene executors and global input
 * listeners depend on App lifetime, so this boundary keeps them mounted while
 * page components can change without restarting work or duplicating listeners.
 */
export function RuntimeProviders({ children }: RuntimeProvidersProps) {
    // Scene remains the observed rollback executor until its durable coordinator
    // reaches parity; keeping it here preserves generation across navigation.
    useSceneGeneration()
    useDurableQueueRuntime()
    useR2UploadRuntime()
    useUpdateChecker()
    useShortcuts()
    useWindowResizePerformanceMode()

    return children
}
