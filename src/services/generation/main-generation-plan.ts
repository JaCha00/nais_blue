import type { FragmentSequenceCommitProposal } from '@/domain/composition/fragment-resolver'
import type { DeepReadonly } from '@/domain/composition/provenance'
import { ensureImageFileExtension } from '@/services/output/filename-policy'
import type { GenerationParams } from '@/services/novelai-types'

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
