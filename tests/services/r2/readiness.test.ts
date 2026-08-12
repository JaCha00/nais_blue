import { describe, expect, it } from 'vitest'

import type { ResolvedGenerationFolder } from '@/domain/generation-folders'
import { gateGenerationFolderAutoUpload } from '@/services/r2/readiness'

const folder: ResolvedGenerationFolder = {
    id: 'folder-01',
    path: 'Prime / 01',
    directory: 'Prime/01',
    useAbsolutePath: false,
    commonPrompt: '',
    r2: {
        autoUpload: true,
        bucket: 'scene-bucket',
        prefix: 'prime/01',
        prefixSource: 'ancestor',
    },
}

describe('generation folder R2 readiness gate', () => {
    it('disables stale auto-upload preferences without mutating the saved folder snapshot', () => {
        const gated = gateGenerationFolderAutoUpload(folder, false)

        expect(gated?.r2.autoUpload).toBe(false)
        expect(folder.r2.autoUpload).toBe(true)
    })

    it('keeps auto upload enabled only after readiness is proven', () => {
        expect(gateGenerationFolderAutoUpload(folder, true)).toBe(folder)
        expect(gateGenerationFolderAutoUpload(null, false)).toBeNull()
    })
})
