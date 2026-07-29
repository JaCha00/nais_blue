import { useR2UploadRuntime } from '@/hooks/useR2UploadRuntime'

/**
 * Bridges foreground R2 recovery into the feature-runtime boundary. It loads
 * with the R2 workspace and then remains mounted so uploads continue across
 * navigation without adding native R2 adapters to Main startup.
 */
export default function R2FeatureRuntime() {
    useR2UploadRuntime()
    return null
}
