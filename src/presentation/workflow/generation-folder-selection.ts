import type { GenerationFolderSelection } from '@/domain/generation-folders'
import { DEFAULT_R2_PROFILE_ID } from '@/domain/r2/types'
import type { SingleImageMetadataMode, SingleImageOutputSettings } from '@/domain/workflow/single-image-draft'

export function outputPatchFromGenerationFolder(
    selection: GenerationFolderSelection | null,
    currentMetadataMode: SingleImageMetadataMode,
): Partial<SingleImageOutputSettings> {
    if (selection === null) {
        return {
            generationFolderId: null,
            generationFolderPath: null,
            folderCommonPrompt: '',
            autoR2UploadProfileId: null,
            r2Bucket: null,
            r2Prefix: null,
        }
    }
    const { folder, r2Ready } = selection
    const autoUpload = folder.r2.autoUpload && r2Ready
    return {
        directory: folder.directory,
        useAbsolutePath: folder.useAbsolutePath,
        capabilityFallbackDirectory: folder.useAbsolutePath ? 'NAIS_Output' : folder.directory,
        generationFolderId: folder.id,
        generationFolderPath: folder.path,
        folderCommonPrompt: folder.commonPrompt,
        metadataMode: autoUpload ? 'strip-and-sidecar' : currentMetadataMode,
        autoR2UploadProfileId: autoUpload ? DEFAULT_R2_PROFILE_ID : null,
        r2Bucket: folder.r2.bucket,
        r2Prefix: folder.r2.prefix,
    }
}
