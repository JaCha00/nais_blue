import { describe, expect, it } from 'vitest'
import { selectStylePreviewAssets } from '@/stores/style-lab-read-store'

describe('Style Lab read selectors', () => {
    it('returns the same empty snapshot for combinations without preview assets', () => {
        const state = { previewAssetsByCombo: {} }

        expect(selectStylePreviewAssets(state, 'missing')).toBe(selectStylePreviewAssets(state, 'missing'))
    })
})
