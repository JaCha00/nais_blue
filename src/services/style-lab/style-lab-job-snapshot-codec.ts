import type { CompositionPlanHash } from '@/domain/composition/canonical-serialize'
import type { DeepReadonly } from '@/domain/composition/provenance'
import type { JsonValue, PortablePathRef } from '@/domain/composition/types'
import type { GenerationJobSnapshot } from '@/domain/queue/types'
import {
    isAnlasCostConsentSnapshot,
    type AnlasCostConsentSnapshot,
} from '@/domain/queue/anlas-cost-consent'
import {
    isStyleEvaluationContext,
    styleCombinationIdentity,
    type StyleEvaluationContext,
    type StyleIdentityTag,
} from '@/domain/style-lab'
import type { MetadataMode } from '@/lib/generation-metadata'
import type { GenerationParams } from '@/services/novelai-types'
import { QueueExecutionError } from '@/services/queue/durable-queue-coordinator'
import { createGenerationJobSnapshot } from '@/services/queue/job-snapshot'
import type {
    DehydratedGenerationParameters,
    DehydratedGenerationResult,
} from '@/services/queue/queue-resource-materializer'

export interface StyleLabQueueOutputSnapshot {
    readonly directory: string
    readonly useAbsolutePath: boolean
    readonly capabilityFallbackDirectory: string
    readonly portableDirectory?: PortablePathRef
    readonly fileName: string
    readonly collisionPolicy: 'unique' | 'overwrite' | 'error'
    readonly imageFormat: 'png' | 'webp'
    readonly metadataMode: MetadataMode
}

export interface StyleLabQueueWorkflowSnapshot {
    readonly comboId: string
    readonly tags: readonly StyleIdentityTag[]
    readonly semanticHash: string
    readonly renderHash: string
    readonly generation: number
    readonly context: StyleEvaluationContext
    readonly seed: number
    readonly requestedAt: number
    readonly reservationId: string
    readonly output: StyleLabQueueOutputSnapshot
    readonly costConsent?: AnlasCostConsentSnapshot
}

export interface StyleLabQueueSnapshotParameters extends DehydratedGenerationParameters {
    readonly queueExecution: { readonly streaming: false; readonly sourceEdit: boolean }
    readonly styleLabWorkflow: StyleLabQueueWorkflowSnapshot
}

export interface EncodeStyleLabJobSnapshotInput {
    readonly combination: {
        readonly id: string
        readonly tags: readonly StyleIdentityTag[]
        readonly semanticHash: string
        readonly renderHash: string
        readonly generation: number
    }
    readonly context: StyleEvaluationContext
    readonly params: GenerationParams
    readonly prompt: string
    readonly seed: number
    readonly requestedAt: number
    readonly reservationId: string
    readonly output: StyleLabQueueOutputSnapshot
    readonly planHash: DeepReadonly<CompositionPlanHash> | null
    readonly costConsent?: AnlasCostConsentSnapshot
}

export interface EncodedStyleLabJobSnapshot {
    readonly snapshot: GenerationJobSnapshot
    readonly compositionPlanHash: string | null
}

function asJson(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value)) as JsonValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStyleIdentityTags(value: unknown): value is StyleIdentityTag[] {
    return Array.isArray(value) && value.every(tag => (
        isRecord(tag)
        && typeof tag.tag === 'string'
        && (tag.kind === undefined || typeof tag.kind === 'string')
        && (tag.weight === undefined || typeof tag.weight === 'number')
    ))
}

function invalidSnapshot(): never {
    throw new QueueExecutionError('fatal', 'Style-Lab queue snapshot parameters are invalid')
}

/**
 * Depends on a reserved Style render, immutable Evaluation Context, resolved
 * generation params, and dehydrated resources. It owns the credential-free V1
 * wire shape so budget/idempotency orchestration cannot diverge from replay.
 */
export function encodeStyleLabJobSnapshot(
    input: EncodeStyleLabJobSnapshotInput,
    dehydrated: Pick<DehydratedGenerationResult, 'parameters' | 'resources'>,
): EncodedStyleLabJobSnapshot {
    const parameters: StyleLabQueueSnapshotParameters = {
        ...dehydrated.parameters,
        queueExecution: {
            streaming: false,
            sourceEdit: Boolean(input.params.sourceImage || input.params.mask),
        },
        styleLabWorkflow: {
            comboId: input.combination.id,
            tags: input.combination.tags,
            semanticHash: input.combination.semanticHash,
            renderHash: input.combination.renderHash,
            generation: input.combination.generation,
            context: input.context,
            seed: input.seed,
            requestedAt: input.requestedAt,
            reservationId: input.reservationId,
            output: input.output,
            ...(input.costConsent === undefined ? {} : { costConsent: input.costConsent }),
        },
    }
    return {
        snapshot: createGenerationJobSnapshot({
            prompt: { positive: input.prompt, negative: input.params.negative_prompt },
            parameters: asJson(parameters),
            outputPolicy: asJson({ workflow: 'style-lab', ...input.output }),
            resources: dehydrated.resources,
            resumability: 'resumable',
        }),
        compositionPlanHash: input.planHash === null ? null : `sha256:${input.planHash.digest}`,
    }
}

/**
 * Depends only on the persisted Job Snapshot and domain identity guards. Before
 * hydration it rejects malformed output fields and snapshots whose render hash
 * or seed no longer matches their immutable tags/Evaluation Context.
 */
export function decodeStyleLabJobSnapshot(snapshot: GenerationJobSnapshot): StyleLabQueueSnapshotParameters {
    const candidate = snapshot.parameters
    if (!isRecord(candidate)
        || candidate.generationParams === undefined
        || !Array.isArray(candidate.resourceBindings)
        || !isRecord(candidate.resourceArrayLengths)
        || !isRecord(candidate.queueExecution)
        || candidate.queueExecution.streaming !== false
        || typeof candidate.queueExecution.sourceEdit !== 'boolean'
        || !isRecord(candidate.styleLabWorkflow)) {
        return invalidSnapshot()
    }
    const workflow = candidate.styleLabWorkflow
    if (typeof workflow.comboId !== 'string'
        || typeof workflow.semanticHash !== 'string'
        || typeof workflow.renderHash !== 'string'
        || !isStyleIdentityTags(workflow.tags)
        || !isStyleEvaluationContext(workflow.context)
        || typeof workflow.generation !== 'number'
        || !Number.isSafeInteger(workflow.generation)
        || typeof workflow.seed !== 'number'
        || !Number.isSafeInteger(workflow.seed)
        || typeof workflow.requestedAt !== 'number'
        || !Number.isSafeInteger(workflow.requestedAt)
        || typeof workflow.reservationId !== 'string'
        || (workflow.costConsent !== undefined && !isAnlasCostConsentSnapshot(workflow.costConsent))
        || !isRecord(workflow.output)
        || typeof workflow.output.directory !== 'string'
        || typeof workflow.output.useAbsolutePath !== 'boolean'
        || typeof workflow.output.capabilityFallbackDirectory !== 'string'
        || typeof workflow.output.fileName !== 'string'
        || (workflow.output.imageFormat !== 'png' && workflow.output.imageFormat !== 'webp')
        || !['unique', 'overwrite', 'error'].includes(String(workflow.output.collisionPolicy))) {
        return invalidSnapshot()
    }
    if (styleCombinationIdentity(workflow.tags).renderHash !== workflow.renderHash
        || !workflow.context.seedPack.includes(workflow.seed)) {
        throw new QueueExecutionError('fatal', 'Style-Lab queue snapshot identity is inconsistent')
    }
    return candidate as unknown as StyleLabQueueSnapshotParameters
}
