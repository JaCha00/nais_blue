import { beforeEach, describe, expect, it } from 'vitest'
import {
    publishGeneratedArtifact,
    useArtifactLifecycleStore,
} from '@/stores/artifact-lifecycle-store'

describe('artifact lifecycle store', () => {
    beforeEach(() => {
        useArtifactLifecycleStore.setState({ latestGeneratedArtifact: null })
    })

    it('publishes typed transient notices with a monotonic sequence', () => {
        publishGeneratedArtifact({ path: 'memory://first.png', data: 'data:image/png;base64,AA==' })
        expect(useArtifactLifecycleStore.getState().latestGeneratedArtifact).toEqual({
            sequence: 1,
            path: 'memory://first.png',
            data: 'data:image/png;base64,AA==',
        })

        publishGeneratedArtifact({ path: 'C:/Pictures/second.webp' })
        expect(useArtifactLifecycleStore.getState().latestGeneratedArtifact).toEqual({
            sequence: 2,
            path: 'C:/Pictures/second.webp',
        })
    })
})
