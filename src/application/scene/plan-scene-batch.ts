import { hashCanonicalValue } from '@/domain/composition/canonical-serialize'
import type { ActorRef } from '@/application/generation/generation-command-contract'
import type { SceneAuthoringRecord, SceneDocument } from './scene-repository'
import type { OutputReservationFolderBinding } from '@/domain/queue/types'

export type SceneSeedPolicy =
    | { readonly kind: 'random' }
    | { readonly kind: 'fixed'; readonly seed: number }
    | { readonly kind: 'increment'; readonly firstSeed: number }
    | { readonly kind: 'replay'; readonly traceId: string }

export interface SceneBatchRequest {
    readonly actor: ActorRef
    readonly preset: { readonly id: string; readonly expectedRevision: number }
    readonly items: readonly { readonly sceneId: string; readonly count: number }[]
    readonly seedPolicy: SceneSeedPolicy
    readonly execution: { readonly failurePolicy: 'continue' | 'stop' }
    readonly budget: { readonly maxImages: number; readonly maxAnlas: number }
}

export interface SceneGenerationBinding {
    readonly resourceType: 'scene-document'
    readonly resourceId: string
    readonly revision: number
    readonly contentHash: `sha256:${string}`
}

export interface PlannedSceneBatchJob<TPrepared> {
    readonly ordinal: number
    readonly presetId: string
    readonly sceneId: string
    readonly seed: number
    readonly fileName: string
    readonly sceneBinding: SceneGenerationBinding
    readonly estimatedAnlas: number
    readonly prepared: TPrepared
}

export interface SceneBatchPlan<TPrepared> {
    readonly schemaVersion: 1
    readonly planHash: `sha256:${string}`
    readonly folderBinding: OutputReservationFolderBinding
    readonly request: SceneBatchRequest
    readonly count: number
    readonly estimatedAnlas: number
    readonly jobs: readonly PlannedSceneBatchJob<TPrepared>[]
}

export interface PlanSceneBatchInput<TPrepared> {
    readonly folderBinding: OutputReservationFolderBinding
    readonly request: SceneBatchRequest
    readonly jobs: readonly Omit<PlannedSceneBatchJob<TPrepared>, 'ordinal'>[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedText(value: unknown, maximum: number): value is string {
    return typeof value === 'string'
        && value === value.trim()
        && value.length >= 1
        && value.length <= maximum
}

function isSafeSceneFileName(value: unknown): value is string {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= 255
        && !/[\\/\r\n]/.test(value)
}

/** Guards the public request shape before a decoder or planner reads nested fields. */
export function isSceneBatchRequest(value: unknown): value is SceneBatchRequest {
    if (!isRecord(value)
        || !isRecord(value.actor)
        || !['user', 'agent', 'system', 'service'].includes(value.actor.kind as string)
        || !isBoundedText(value.actor.id, 200)
        || (value.actor.displayName !== undefined && !isBoundedText(value.actor.displayName, 200))
        || !isRecord(value.preset)
        || !isBoundedText(value.preset.id, 200)
        || !Number.isSafeInteger(value.preset.expectedRevision)
        || (value.preset.expectedRevision as number) < 0
        || !Array.isArray(value.items)
        || value.items.length === 0
        || !value.items.every(item => isRecord(item)
            && isBoundedText(item.sceneId, 200)
            && Number.isSafeInteger(item.count)
            && (item.count as number) >= 1
            && (item.count as number) <= 999)
        || !isRecord(value.seedPolicy)
        || !['random', 'fixed', 'increment', 'replay'].includes(value.seedPolicy.kind as string)
        || (value.seedPolicy.kind === 'fixed'
            && (!Number.isSafeInteger(value.seedPolicy.seed)
                || (value.seedPolicy.seed as number) < 0
                || (value.seedPolicy.seed as number) > 0xffff_ffff))
        || (value.seedPolicy.kind === 'increment'
            && (!Number.isSafeInteger(value.seedPolicy.firstSeed)
                || (value.seedPolicy.firstSeed as number) < 0
                || (value.seedPolicy.firstSeed as number) > 0xffff_ffff))
        || (value.seedPolicy.kind === 'replay' && !isBoundedText(value.seedPolicy.traceId, 200))
        || !isRecord(value.execution)
        || (value.execution.failurePolicy !== 'continue' && value.execution.failurePolicy !== 'stop')
        || !isRecord(value.budget)
        || !Number.isSafeInteger(value.budget.maxImages)
        || (value.budget.maxImages as number) < 0
        || !Number.isSafeInteger(value.budget.maxAnlas)
        || (value.budget.maxAnlas as number) < 0) {
        return false
    }
    return true
}

function semanticSceneSource(scene: SceneAuthoringRecord): unknown {
    const { artifactRefs: _artifactRefs, generation: sourceGeneration, ...authoring } = scene
    const generation = sourceGeneration === undefined
        ? undefined
        : sourceGeneration.seedLocked === true
            ? sourceGeneration
            : (() => {
                const { seed: _seed, ...withoutSeed } = sourceGeneration
                return withoutSeed
            })()
    return {
        ...authoring,
        ...(generation === undefined ? {} : { generation }),
    }
}

export function createSceneGenerationBinding(
    document: SceneDocument,
    sceneId: string,
): SceneGenerationBinding | null {
    const scene = document.scenes.find(candidate => candidate.id === sceneId)
    if (scene === undefined) return null
    return Object.freeze({
        resourceType: 'scene-document',
        resourceId: `${document.presetId}:${sceneId}`,
        revision: document.revision,
        contentHash: `sha256:${hashCanonicalValue(semanticSceneSource(scene))}`,
    })
}

export function sceneGenerationBindingMatches(
    binding: SceneGenerationBinding,
    document: SceneDocument,
    sceneId: string,
): boolean {
    const current = createSceneGenerationBinding(document, sceneId)
    return current !== null
        && current.resourceId === binding.resourceId
        && current.revision === binding.revision
        && current.contentHash === binding.contentHash
}

/** Freezes expanded count, seeds, exact names, and source bindings into one reviewable batch. */
export function planSceneBatch<TPrepared>(input: PlanSceneBatchInput<TPrepared>): SceneBatchPlan<TPrepared> {
    if (input.jobs.length === 0) throw new TypeError('A Scene batch must contain at least one job')
    const jobs = input.jobs.map((job, ordinal) => Object.freeze({ ...job, ordinal }))
    const request = input.request
    if (!isSceneBatchRequest(request)
        || !['user', 'agent', 'system', 'service'].includes(request.actor.kind)
        || request.actor.id.length === 0
        || request.preset.id.length === 0
        || !Number.isSafeInteger(request.preset.expectedRevision)
        || request.preset.expectedRevision < 0
        || request.items.length === 0
        || request.items.some(item => !isBoundedText(item.sceneId, 200)
            || !Number.isSafeInteger(item.count)
            || item.count < 1
            || item.count > 999)
        || !['random', 'fixed', 'increment', 'replay'].includes(request.seedPolicy.kind)
        || (request.seedPolicy.kind === 'fixed'
            && (!Number.isSafeInteger(request.seedPolicy.seed)
                || request.seedPolicy.seed < 0 || request.seedPolicy.seed > 0xffff_ffff))
        || (request.seedPolicy.kind === 'increment'
            && (!Number.isSafeInteger(request.seedPolicy.firstSeed)
                || request.seedPolicy.firstSeed < 0 || request.seedPolicy.firstSeed > 0xffff_ffff))
        || (request.seedPolicy.kind === 'replay' && request.seedPolicy.traceId.length === 0)
        || (request.execution.failurePolicy !== 'continue' && request.execution.failurePolicy !== 'stop')
        || !Number.isSafeInteger(request.budget.maxImages)
        || request.budget.maxImages < 0
        || !Number.isSafeInteger(request.budget.maxAnlas)
        || request.budget.maxAnlas < 0
        || jobs.some(job => !Number.isSafeInteger(job.seed) || job.seed < 0 || job.seed > 0xffff_ffff
            || !isSafeSceneFileName(job.fileName)
            || !Number.isSafeInteger(job.estimatedAnlas) || job.estimatedAnlas < 0
            || job.presetId !== request.preset.id
            || !isBoundedText(job.sceneId, 200)
            || job.sceneBinding.resourceType !== 'scene-document'
            || !isBoundedText(job.sceneBinding.resourceId, 401)
            || !/^sha256:[a-f0-9]{64}$/.test(job.sceneBinding.contentHash)
            || job.sceneBinding.revision !== request.preset.expectedRevision
            || job.sceneBinding.resourceId !== `${request.preset.id}:${job.sceneId}`)) {
        throw new TypeError('Scene batch seeds and exact filenames are invalid')
    }
    const requestedCounts = new Map(request.items.map(item => [item.sceneId, item.count]))
    const actualCounts = new Map<string, number>()
    for (const job of jobs) actualCounts.set(job.sceneId, (actualCounts.get(job.sceneId) ?? 0) + 1)
    if (requestedCounts.size !== request.items.length
        || [...requestedCounts].some(([sceneId, count]) => actualCounts.get(sceneId) !== count)
        || actualCounts.size !== requestedCounts.size) {
        throw new TypeError('Scene batch request counts do not match materialized jobs')
    }
    if (request.seedPolicy.kind === 'fixed') {
        const fixedSeed = request.seedPolicy.seed
        if (jobs.some(job => job.seed !== fixedSeed)) {
            throw new TypeError('Scene batch fixed seed policy does not match materialized jobs')
        }
    }
    if (request.seedPolicy.kind === 'increment') {
        const firstSeed = request.seedPolicy.firstSeed
        if (jobs.some((job, ordinal) => job.seed !== ((firstSeed + ordinal) >>> 0))) {
            throw new TypeError('Scene batch increment seed policy does not match materialized jobs')
        }
    }
    const canonicalRequest: SceneBatchRequest = {
        ...request,
        actor: request.actor.displayName === undefined
            ? { kind: request.actor.kind, id: request.actor.id }
            : request.actor,
    }
    const count = jobs.length
    const estimatedAnlas = jobs.reduce((total, job) => total + job.estimatedAnlas, 0)
    if (!Number.isSafeInteger(estimatedAnlas)
        || count > request.budget.maxImages
        || estimatedAnlas > request.budget.maxAnlas) {
        throw new TypeError('Scene batch exceeds its image or Anlas budget')
    }
    const publicPlan = {
        schemaVersion: 1 as const,
        folderBinding: input.folderBinding,
        request: canonicalRequest,
        count,
        estimatedAnlas,
        jobs: jobs.map(({ prepared: _prepared, ...job }) => job),
    }
    return Object.freeze({
        ...publicPlan,
        planHash: `sha256:${hashCanonicalValue(publicPlan)}`,
        request: canonicalRequest,
        count,
        estimatedAnlas,
        jobs: Object.freeze(jobs),
    })
}
