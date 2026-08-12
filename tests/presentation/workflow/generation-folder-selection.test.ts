import { describe, expect, it } from 'vitest'

import { DEFAULT_R2_PROFILE_ID } from '@/domain/r2/types'
import { outputPatchFromGenerationFolder } from '@/presentation/workflow/generation-folder-selection'

describe('Guided generation-folder selection', () => {
    it('copies the exact local and R2 destination into the job-local output policy', () => {
        const patch = outputPatchFromGenerationFolder({
            r2Ready: true,
            folder: {
                id: 'folder-01',
                path: 'Prime / 01',
                directory: 'D:\\Images\\Prime\\01',
                useAbsolutePath: true,
                commonPrompt: 'blue hair',
                r2: {
                    autoUpload: true,
                    bucket: 'scene-bucket',
                    prefix: 'prime/bluehair/01',
                    prefixSource: 'ancestor',
                },
            },
        }, 'embedded')

        expect(patch).toMatchObject({
            generationFolderId: 'folder-01',
            generationFolderPath: 'Prime / 01',
            directory: 'D:\\Images\\Prime\\01',
            folderCommonPrompt: 'blue hair',
            metadataMode: 'strip-and-sidecar',
            autoR2UploadProfileId: DEFAULT_R2_PROFILE_ID,
            r2Bucket: 'scene-bucket',
            r2Prefix: 'prime/bluehair/01',
        })
    })

    it('keeps auto upload disabled when credentials are not ready', () => {
        const patch = outputPatchFromGenerationFolder({
            r2Ready: false,
            folder: {
                id: 'folder-01', path: '01', directory: '01', useAbsolutePath: false, commonPrompt: '',
                r2: { autoUpload: true, bucket: 'scene-bucket', prefix: '01', prefixSource: 'folder' },
            },
        }, 'embedded')
        expect(patch.autoR2UploadProfileId).toBeNull()
        expect(patch.metadataMode).toBe('embedded')
    })
})
