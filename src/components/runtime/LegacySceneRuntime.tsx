import { useSceneGeneration } from '@/hooks/useSceneGeneration'

/**
 * Bridges the legacy Scene worker into the feature-runtime boundary. Dynamic
 * import by FeatureRuntimeProviders keeps its stores, transport, and output
 * graph out of Main startup while preserving the existing hook behavior.
 */
export default function LegacySceneRuntime() {
    useSceneGeneration()
    return null
}
