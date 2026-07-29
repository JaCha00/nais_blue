import type { FragmentSequenceCommitProposal } from '@/domain/composition/fragment-resolver'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type { GenerationParams } from '@/services/novelai-types'

/**
 * Credential-free handoff emitted by Main preparation and consumed by
 * PlanMainBatch. Keeping the DTO outside Zustand prevents Queue from invoking
 * the execution action while a standalone Draft repository is introduced.
 */
export interface CapturedMainGeneration {
    readonly params: GenerationParams
    readonly finalPrompt: string
    readonly imageFormat: 'png' | 'webp'
    readonly metadataMode: GenerationParams['metadataMode']
    readonly streaming: boolean
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
