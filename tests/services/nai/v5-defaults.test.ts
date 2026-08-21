import { describe, expect, it } from 'vitest'

import { createDefaultGenerationPreset } from '@/lib/composition/preset-store-migration'
import { DEFAULT_NAI_IMAGE_MODEL } from '@/services/nai/model-catalog'
import { DEFAULT_GENERATION_MODEL } from '@/stores/generation-store'
import { DEFAULT_SCENE_GENERATION } from '@/stores/scene-store'

describe('V5 default model selection', () => {
    it('uses V5 Full for new Main, Scene, and Preset defaults', () => {
        expect(DEFAULT_GENERATION_MODEL).toBe(DEFAULT_NAI_IMAGE_MODEL)
        expect(DEFAULT_SCENE_GENERATION.model).toBe(DEFAULT_NAI_IMAGE_MODEL)
        expect(createDefaultGenerationPreset().model).toBe(DEFAULT_NAI_IMAGE_MODEL)
        expect(createDefaultGenerationPreset().transparentBackground).toBe(false)
    })
})
