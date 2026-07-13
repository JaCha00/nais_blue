import type { CompositionEnginePlan } from '@/domain/composition/engine'
import type { DeepReadonly } from '@/domain/composition/provenance'
import { materializeCharacterResourcesForNai } from '@/lib/composition/character-resource-adapter'
import type { CharacterResourceRepository } from '@/lib/composition/character-resource-repository'
import { cloneCompositionRandomTrace } from '@/lib/generation-metadata'
import type { GenerationParams } from '@/services/novelai-api'
import { runtimeCapabilities } from '@/platform/capabilities'
import { assessPortableCompositionPlan } from '@/platform/portable-resources'

export interface MaterializeStyleLabPlanInput {
    plan: DeepReadonly<CompositionEnginePlan>
    sourceImage: string | null
    mask: string | null
    imageFormat: 'png' | 'webp'
    metadataMode: GenerationParams['metadataMode']
    useAbsolutePath: boolean
    enforcePortability?: boolean
    repository: CharacterResourceRepository
}

function uniqueEnabledBindings(plan: DeepReadonly<CompositionEnginePlan>) {
    return [
        ...plan.resourceBindings,
        ...plan.characters
            .filter(character => character.enabled)
            .flatMap(character => character.resourceBindings),
    ].filter((binding, index, bindings) => binding.enabled && bindings.findIndex(candidate => (
        candidate.resourceId === binding.resourceId
        && candidate.referenceType === binding.referenceType
        && candidate.strength === binding.strength
        && candidate.fidelity === binding.fidelity
        && candidate.informationExtracted === binding.informationExtracted
    )) === index)
}

/** Materializes resource bytes/cache keys only at the NAI transport edge. */
export async function materializeStyleLabPlanForNai(
    input: MaterializeStyleLabPlanInput,
): Promise<GenerationParams> {
    if (input.enforcePortability) {
        const portability = assessPortableCompositionPlan(input.plan, runtimeCapabilities)
        if (!portability.readyForGeneration) {
            throw new Error(portability.issues
                .map(issue => `${issue.code}:${issue.resourceId ?? 'output'}:${issue.repairAction.label}`)
                .join(', '))
        }
    }
    const materialized = await materializeCharacterResourcesForNai({
        resources: input.plan.resources,
        bindings: uniqueEnabledBindings(input.plan),
        repository: input.repository,
    })
    if (!materialized.success) {
        throw new Error(materialized.errors.map(error => `${error.code}:${error.resourceId}`).join(', '))
    }
    const references = materialized.value
    const plan = input.plan

    return {
        prompt: plan.positivePrompt,
        negative_prompt: plan.negativePrompt,
        model: plan.params.model,
        width: plan.params.width,
        height: plan.params.height,
        steps: plan.params.steps,
        cfg_scale: plan.params.cfgScale,
        cfg_rescale: plan.params.cfgRescale,
        sampler: plan.params.sampler,
        scheduler: plan.params.scheduler,
        smea: plan.params.smea,
        smea_dyn: plan.params.smeaDyn,
        variety: plan.params.variety,
        seed: plan.params.seed,
        ...(input.sourceImage === null ? {} : { sourceImage: input.sourceImage }),
        strength: plan.params.strength,
        noise: plan.params.noise,
        ...(input.mask === null ? {} : { mask: input.mask }),
        charImages: references.charImages,
        charStrength: references.charStrength,
        charFidelity: references.charFidelity,
        charReferenceType: references.charReferenceType,
        charCacheKeys: references.charCacheKeys,
        charInfo: references.charInfo,
        vibeImages: references.vibeImages,
        vibeInfo: references.vibeInfo,
        vibeStrength: references.vibeStrength,
        preEncodedVibes: references.preEncodedVibes,
        characterPrompts: plan.characters.filter(character => character.enabled).map(character => ({
            stableId: character.characterId,
            prompt: character.positive,
            negative: character.negative,
            enabled: true,
            position: character.position.mode === 'manual'
                ? { x: character.position.x, y: character.position.y }
                : { x: 0.5, y: 0.5 },
        })),
        characterPositionEnabled: plan.params.characterPositionEnabled,
        imageFormat: input.imageFormat,
        metadataMode: input.metadataMode,
        qualityToggle: plan.params.qualityToggle,
        ucPreset: plan.params.ucPreset,
        promptParts: {
            base: plan.promptParts.base,
            inpainting: plan.promptParts.inpainting,
            additional: plan.promptParts.additional,
            workflow: plan.promptParts.workflow,
            detail: plan.promptParts.detail,
            negative: plan.promptParts.negative,
        },
        compositionMode: 'v2',
        engineVersion: plan.engineVersion,
        sourceRevision: plan.documentRevision,
        compositionPlanHash: { ...plan.planHash },
        compositionPlanId: plan.planId,
        compositionRecipeId: plan.recipeId,
        compositionProvenanceSummary: {
            sourceCount: plan.provenance.length,
            promptContributionCount: plan.provenanceDetails.prompts.length,
            randomSelectionCount: plan.provenanceDetails.randomSelections.length,
        },
        compositionRandomTrace: cloneCompositionRandomTrace(plan.randomTrace),
        outputPolicySummary: {
            imageFormat: input.imageFormat,
            metadataMode: input.metadataMode ?? 'embedded',
            destinationKind: input.useAbsolutePath ? 'custom' : 'default',
            writesSidecar: input.metadataMode !== 'embedded' || input.imageFormat === 'webp',
            writesThumbnail: true,
            filenameTemplateId: plan.outputPolicy.filenameTemplate,
            collisionPolicy: plan.outputPolicy.collisionPolicy,
        },
        ...(plan.outputPolicy.destination.kind === 'filesystem'
            ? {
                portableOutputDirectory: plan.outputPolicy.destination.directory.kind === 'standard'
                    ? {
                        kind: 'standard' as const,
                        root: plan.outputPolicy.destination.directory.root,
                        segments: [...plan.outputPolicy.destination.directory.segments],
                    }
                    : {
                        kind: 'bookmark' as const,
                        bookmarkId: plan.outputPolicy.destination.directory.bookmarkId,
                        segments: [...plan.outputPolicy.destination.directory.segments],
                    },
            }
            : {}),
    }
}
