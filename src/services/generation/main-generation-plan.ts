import type { FragmentSequenceCommitProposal } from '@/domain/composition/fragment-resolver'
import type { DeepReadonly } from '@/domain/composition/provenance'
import { ensureImageFileExtension } from '@/services/output/filename-policy'
import type { GenerationParams } from '@/services/novelai-types'
import { DEFAULT_RIGHTS_OWNER } from '@/domain/workflow/bluehair-rights-policy'

/**
 * Credential-free Main plan consumed by both the transitional direct runner
 * and PlanMainBatch. Keeping it outside Zustand makes format, transport, CAS,
 * and output-policy decisions identical while the Draft repository is split.
 */
export interface PreparedMainGeneration {
    readonly params: GenerationParams
    readonly finalPrompt: string
    readonly imageFormat: 'png' | 'webp'
    readonly metadataMode: GenerationParams['metadataMode']
    readonly streaming: boolean
    readonly sourceEdit: boolean
    readonly sequenceCommitProposal: DeepReadonly<FragmentSequenceCommitProposal> | null
    readonly output: {
        readonly autoSave: boolean
        readonly directory: string
        readonly useAbsolutePath: boolean
        readonly capabilityFallbackDirectory: string
        readonly portableDirectory?: GenerationParams['portableOutputDirectory']
        readonly fileName?: string
        readonly collisionPolicy: 'unique' | 'overwrite' | 'error'
        readonly autoR2UploadProfileId: string | null
        readonly deleteOriginalAfterRelease: boolean
        readonly rightsXmpEnabled: boolean
        readonly rightsOwner: string
        readonly rightsEffectiveDate: string | null
    }
}

export interface PrepareMainGenerationOptions {
    readonly params: GenerationParams
    readonly fallbackImageFormat: 'png' | 'webp'
    readonly fallbackMetadataMode: GenerationParams['metadataMode']
    readonly streamingRequested: boolean
    readonly sequenceCommitProposal: DeepReadonly<FragmentSequenceCommitProposal> | null
    readonly output: {
        readonly autoSave: boolean
        readonly directory?: string | null
        readonly useAbsolutePath: boolean
        readonly capabilityFallbackDirectory?: string | null
        readonly portableDirectory?: GenerationParams['portableOutputDirectory']
        readonly fileName?: string | null
        readonly collisionPolicy: 'unique' | 'overwrite' | 'error'
        readonly autoR2UploadProfileId?: string | null
        readonly deleteOriginalAfterRelease?: boolean
        readonly rightsXmpEnabled?: boolean
        readonly rightsOwner?: string
        readonly rightsEffectiveDate?: string | null
    }
}

/**
 * Depends only on already-resolved generation/output facts. It normalizes the
 * explicit filename and source-edit transport gate once, producing the shared
 * plan without reading Stores, credentials, clocks, or platform APIs.
 */
export function prepareMainGeneration(
    options: PrepareMainGenerationOptions,
): PreparedMainGeneration {
    const imageFormat = options.params.imageFormat ?? options.fallbackImageFormat
    const sourceEdit = Boolean(options.params.sourceImage || options.params.mask)
    const fileName = ensureImageFileExtension(options.output.fileName, imageFormat)
    const output = Object.freeze({
        autoSave: options.output.autoSave,
        directory: options.output.directory || 'NAIS_Output',
        useAbsolutePath: options.output.useAbsolutePath,
        capabilityFallbackDirectory: options.output.capabilityFallbackDirectory || 'NAIS_Output',
        ...(options.output.portableDirectory === undefined
            ? {}
            : { portableDirectory: options.output.portableDirectory }),
        ...(fileName === null ? {} : { fileName }),
        collisionPolicy: options.output.collisionPolicy,
        autoR2UploadProfileId: options.output.autoR2UploadProfileId ?? null,
        deleteOriginalAfterRelease: options.output.deleteOriginalAfterRelease ?? false,
        rightsXmpEnabled: options.output.rightsXmpEnabled ?? false,
        rightsOwner: options.output.rightsOwner ?? DEFAULT_RIGHTS_OWNER,
        rightsEffectiveDate: options.output.rightsEffectiveDate ?? null,
    })
    return Object.freeze({
        params: options.params,
        finalPrompt: options.params.prompt,
        imageFormat,
        metadataMode: options.params.metadataMode ?? options.fallbackMetadataMode,
        streaming: options.streamingRequested && !sourceEdit,
        sourceEdit,
        sequenceCommitProposal: options.sequenceCommitProposal,
        output,
    })
}
