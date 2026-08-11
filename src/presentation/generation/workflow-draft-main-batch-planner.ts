import type { MainBatchPlannerPort } from '@/application/generation/plan-main-batch'
import { buildLegacyMainGenerationParameters } from '@/domain/generation/legacy-main-parameters'
import {
    isBatchImageDraftReady,
    isSingleImageDraftReady,
    type BatchImageDraft,
    type SingleImageDraft,
    type SingleImageMetadataMode,
} from '@/domain/workflow/single-image-draft'
import type {
    FragmentSequenceCommitProposal,
    FragmentSequenceSnapshot,
} from '@/domain/composition/fragment-resolver'
import type { DeepReadonly } from '@/domain/composition/provenance'
import { createWildcardResolutionSession } from '@/lib/fragment-processor'
import {
    prepareMainGeneration,
    type PreparedMainGeneration,
} from '@/services/generation/main-generation-plan'
import { removeComments } from '@/services/nai/presets'
import type { GenerationParams } from '@/services/novelai-types'
import type { FragmentLookupRepository } from '@/stores/fragment-store'
import { useFragmentStore } from '@/stores/fragment-store'

interface WorkflowDraftMainBatchPlannerOptions {
    readonly fragmentRepository?: FragmentLookupRepository
}

type MainWorkflowDraft = SingleImageDraft | BatchImageDraft

interface BatchPromptInput {
    readonly positive: string
    readonly negative: string
    readonly seed: number
    readonly ordinal: number
}

export class WorkflowDraftPromptModuleResolutionError extends Error {
    constructor() {
        super('A saved Guided prompt module could not be resolved')
        this.name = 'WorkflowDraftPromptModuleResolutionError'
    }
}

function requestedCount(draft: MainWorkflowDraft): number {
    if (draft.kind === 'single-image') return 1
    if (draft.payload.batchMode !== 'scenes') return draft.payload.count
    return draft.payload.scenes.reduce((sum, scene) => sum + scene.count, 0)
}

function batchPromptInputs(draft: MainWorkflowDraft): readonly BatchPromptInput[] {
    if (draft.kind === 'single-image') {
        return [{ ...draft.payload.prompt, seed: draft.payload.generation.seed, ordinal: 0 }]
    }
    const inputs: BatchPromptInput[] = []
    const append = (positive: string, negative: string, count: number) => {
        for (let index = 0; index < count; index += 1) {
            const ordinal = inputs.length
            inputs.push({
                positive,
                negative,
                seed: (draft.payload.generation.seed + ordinal) >>> 0,
                ordinal,
            })
        }
    }
    if (draft.payload.batchMode !== 'scenes') {
        append(draft.payload.prompt.positive, draft.payload.prompt.negative, draft.payload.count)
        return inputs
    }
    for (const scene of draft.payload.scenes) {
        append(
            [draft.payload.prompt.positive, scene.positive].filter(Boolean).join(', '),
            [draft.payload.prompt.negative, scene.negative].filter(Boolean).join(', '),
            scene.count,
        )
    }
    return inputs
}

/**
 * Projects successful sequential proposals into memory while planning. The
 * live fragment counters stay untouched until each durable job succeeds.
 */
function createStagedFragmentRepository(live: FragmentLookupRepository): {
    readonly repository: FragmentLookupRepository
    stage(proposal: DeepReadonly<FragmentSequenceCommitProposal> | null): boolean
} {
    const baseLiveRevision = live.getSequenceSnapshot().revision
    let snapshot: FragmentSequenceSnapshot = structuredClone(live.getSequenceSnapshot())
    const assertSourceUnchanged = () => {
        if (live.getSequenceSnapshot().revision !== baseLiveRevision) {
            throw new Error('Fragment store changed during Guided batch planning')
        }
    }
    return {
        repository: {
            findMetadataByPath: path => live.findMetadataByPath(path),
            loadDefinitionByPath: async path => {
                assertSourceUnchanged()
                return live.loadDefinitionByPath(path)
            },
            getSequenceSnapshot: () => structuredClone(snapshot),
            commitSequenceProposal: () => false,
        },
        stage: proposal => {
            if (proposal === null || proposal.changes.length === 0) return true
            if (proposal.expectedRevision !== snapshot.revision) return false
            const counters = { ...snapshot.counters }
            for (const change of proposal.changes) {
                if ((counters[change.fragmentId] ?? 0) !== change.expectedCounter) return false
                counters[change.fragmentId] = change.nextCounter
            }
            snapshot = { revision: snapshot.revision + 1, counters }
            return true
        },
    }
}

/**
 * Converts one detached Guided draft into the existing credential-free Main
 * plan. It deliberately disables preview streaming because Guided submissions
 * are background jobs and must not compete for the expert canvas stream.
 */
export function createWorkflowDraftMainBatchPlanner(
    draft: MainWorkflowDraft,
    options: WorkflowDraftMainBatchPlannerOptions = {},
): MainBatchPlannerPort<PreparedMainGeneration> {
    const captured = structuredClone(draft)
    return Object.freeze({
        getRequestedCount: () => requestedCount(captured),
        prepareBatch: async () => {
            if ((captured.kind === 'single-image'
                    ? !isSingleImageDraftReady(captured)
                    : !isBatchImageDraftReady(captured))
                || captured.payload.model === null
                || captured.payload.resolution === null
                // Queue credential affinity is a separate scheduling contract;
                // never silently run a pinned draft through today's auto slot.
                || captured.payload.credentialPolicy.kind !== 'auto') {
                return []
            }
            const { generation, output, resolution } = captured.payload
            const liveRepository = options.fragmentRepository
                ?? useFragmentStore.getState().getLookupRepository()
            const stagedFragments = createStagedFragmentRepository(liveRepository)
            const prepared: PreparedMainGeneration[] = []
            for (const input of batchPromptInputs(captured)) {
                const fragments = createWildcardResolutionSession({
                    seed: input.seed,
                    scope: `guided:${captured.id}:revision:${captured.revision}:item:${input.ordinal}`,
                    strictness: 'strict',
                    repository: stagedFragments.repository,
                })
                let positive: string
                let negative: string
                try {
                    positive = (await fragments.process(removeComments(input.positive))).trim()
                    negative = (await fragments.process(removeComments(input.negative))).trim()
                } catch (error) {
                    fragments.discard()
                    throw error
                }
                if (!fragments.success) {
                    fragments.discard()
                    throw new WorkflowDraftPromptModuleResolutionError()
                }
                const sequenceCommitProposal = fragments.sequenceCommitProposal
                if (!stagedFragments.stage(sequenceCommitProposal)) {
                    fragments.discard()
                    throw new WorkflowDraftPromptModuleResolutionError()
                }
                const params: GenerationParams = buildLegacyMainGenerationParameters<never, SingleImageMetadataMode>({
                prompt: positive,
                negativePrompt: negative,
                originalPrompts: {
                    base: input.positive,
                    additional: '',
                    detail: '',
                    negative: input.negative,
                    inpainting: '',
                },
                model: captured.payload.model,
                width: resolution.width,
                height: resolution.height,
                steps: generation.steps,
                cfgScale: generation.cfgScale,
                cfgRescale: generation.cfgRescale,
                sampler: generation.sampler,
                scheduler: generation.scheduler,
                smea: generation.smea,
                smeaDyn: generation.smeaDyn,
                variety: generation.variety,
                seed: input.seed,
                sourceImage: null,
                strength: 0.7,
                noise: 0,
                mask: null,
                characterImages: [],
                vibeImages: [],
                characterPrompts: [],
                characterPositionEnabled: false,
                modulePromptsActive: false,
                moduleCharacterPromptsPresent: false,
                imageFormat: output.imageFormat,
                metadataMode: output.metadataMode,
                assetModulePlan: null,
                qualityToggle: generation.qualityToggle,
                ucPreset: generation.ucPreset,
                })
                prepared.push(prepareMainGeneration({
                    params,
                    fallbackImageFormat: output.imageFormat,
                    fallbackMetadataMode: output.metadataMode,
                    streamingRequested: false,
                    sequenceCommitProposal,
                    output: {
                        autoSave: output.autoSave,
                        directory: output.directory,
                        useAbsolutePath: output.useAbsolutePath,
                        capabilityFallbackDirectory: output.capabilityFallbackDirectory,
                        collisionPolicy: output.collisionPolicy,
                    },
                }))
            }
            return Object.freeze(prepared)
        },
    })
}
