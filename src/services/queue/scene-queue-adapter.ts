import type {
    OutputReservation,
    QueueBatchOrigin,
    QueueResourceRecord,
} from '@/domain/queue/types'
import { canonicalSerialize } from '@/domain/composition/canonical-serialize'
import { calculateAnlasCost, resolveAnlasPricingBasis } from '@/lib/anlas-calculator'
import { createAnlasCostConsentSnapshot } from '@/domain/queue/anlas-cost-consent'
import { selectActiveCredentialsAreOpus, useAuthStore } from '@/stores/auth-store'
import { createGenerationFolderDocumentBinding } from '@/application/folder/generation-folder-binding'
import type { SceneDocument } from '@/application/scene/scene-repository'
import {
    createSceneGenerationBinding,
    planSceneBatch,
    sceneGenerationBindingMatches,
    type SceneBatchRequest,
    type PlannedSceneBatchJob,
} from '@/application/scene/plan-scene-batch'
import { getRuntimeSceneRepository } from '@/lib/scene-migration-startup'
import { resolveGenerationFolderAuthority } from '@/lib/generation-folder-authority-runtime'
import { DEFAULT_R2_PROFILE_ID } from '@/domain/r2/types'
import { buildSceneGenerationParams } from '@/lib/scene-generation/build-scene-params'
import { selectSceneGenerationSeed } from '@/lib/scene-generation/legacy-build-scene-params'
import type { SaveSceneResultContext } from '@/lib/scene-generation/save-scene-result'
import { getRotationCharacterFolderName } from '@/lib/scene-output-path'
import { useCharacterStore } from '@/stores/character-store'
import { useQueueStore } from '@/stores/queue-store'
import { useRotationStore } from '@/stores/character-rotation-store'
import {
    getScenePresetPathSegments,
    resolveSceneGeneration,
    useSceneStore,
    type SceneCard,
    type ScenePreset,
} from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import { QueueExecutionError } from './durable-queue-coordinator'
import {
    getRuntimeQueueRepository,
    type CreateBatchAndEnqueueResult,
    type EnqueueGenerationJobInput,
} from './indexeddb-queue-repository'
import {
    encodeSceneJobSnapshot,
    type SceneQueueWorkflowSnapshot,
} from './scene-job-snapshot-codec'
import {
    dehydrateGenerationParams,
    getRuntimeQueueResourceMaterializer,
    type DehydratedGenerationResult,
    type MaterializedQueueResource,
} from './queue-resource-materializer'
import { gateGenerationFolderAutoUpload, getDefaultR2Readiness } from '@/services/r2/readiness'
import { ensureImageFileExtension, renderFilenameTemplate } from '@/services/output/filename-policy'
import { getRuntimeMainQueueDependencies } from './main-queue-runtime-dependencies'
import { bindOutputReservationSnapshot } from './job-snapshot'
import type { OutputWriterDestination } from '@/services/output/output-writer'

let sceneEnqueueInFlight: Promise<CreateBatchAndEnqueueResult | null> | null = null

// Queue Center passes explicit folder/scene/count tuples; this boundary keeps
// selection UI concerns out of snapshot creation and makes each job retain the
// correct output folder even when that folder is not currently active.
export interface SceneQueueTarget {
    readonly presetId: string
    readonly sceneId: string
    readonly count: number
    readonly fileNames?: readonly string[]
}

interface ResolvedSceneQueueTarget {
    readonly target: SceneQueueTarget
    readonly preset: ScenePreset
    readonly scene: SceneCard
}

interface PreparedSceneQueueJob {
    readonly scene: { readonly id: string; readonly name: string }
    readonly params: import('@/services/novelai-types').GenerationParams
    readonly finalPrompt: string
    readonly mimeType: string
    readonly saveContext: SaveSceneResultContext
    readonly outputContext: SceneQueueWorkflowSnapshot['outputContext']
    readonly sequenceCommitProposal: Parameters<typeof encodeSceneJobSnapshot>[0]['sequenceCommitProposal']
    readonly planHash: Parameters<typeof encodeSceneJobSnapshot>[0]['planHash']
    readonly sceneBinding: import('@/application/scene/plan-scene-batch').SceneGenerationBinding
    readonly costConsent: import('@/domain/queue/anlas-cost-consent').AnlasCostConsentSnapshot
    readonly dehydrated: Pick<DehydratedGenerationResult, 'parameters' | 'resources'>
    readonly imageFormat: 'png' | 'webp'
    readonly destination: OutputWriterDestination
}

function exactSceneFileName(value: string, extension: 'png' | 'webp'): string {
    const fileName = ensureImageFileExtension(value.trim(), extension)
    if (fileName === null
        || fileName.length === 0
        || fileName.length > 255
        || /[\\/\r\n]/.test(fileName)) {
        throw new QueueExecutionError('fatal', 'Scene output filename is not a safe exact destination')
    }
    return fileName
}

function planSceneFileName(input: {
    readonly targetFileName?: string
    readonly scene: SceneCard
    readonly preset: ScenePreset
    readonly params: { readonly imageFormat?: string; readonly seed: number; readonly assetModulePlan?: { readonly output: { readonly fileName?: string } } }
    readonly ordinal: number
    readonly now: Date
}): string {
    const extension = input.params.imageFormat === 'webp' ? 'webp' : 'png'
    const requested = input.targetFileName?.trim()
    if (requested) return exactSceneFileName(requested, extension)
    const fallback = `NAI_Blue_SCENE_${input.preset.id}_${input.scene.id}_${input.ordinal}`
    const template = input.scene.filenameTemplate?.trim()
    const rendered = template
        ? renderFilenameTemplate({
            template,
            context: {
                seed: input.params.seed,
                scene: { id: input.scene.id, name: input.scene.name },
                preset: { id: input.preset.id, name: input.preset.name },
            },
            now: input.now,
            fallback,
        })
        : input.params.assetModulePlan?.output.fileName ?? fallback
    return exactSceneFileName(rendered, extension)
}

function normalizeSceneQueueTargets(targets: readonly SceneQueueTarget[]): SceneQueueTarget[] {
    const normalized = new Map<string, SceneQueueTarget>()
    for (const target of targets) {
        if (!Number.isFinite(target.count) || target.count <= 0) continue
        const count = Math.max(1, Math.floor(target.count))
        const key = `${target.presetId}:${target.sceneId}`
        const previous = normalized.get(key)
        const fileNames = [
            ...(previous?.fileNames ?? []),
            ...Array.from({ length: count }, (_, index) => target.fileNames?.[index]?.trim() ?? ''),
        ]
        normalized.set(key, {
            presetId: target.presetId,
            sceneId: target.sceneId,
            count: Math.min(999, (previous?.count ?? 0) + count),
            ...(fileNames.some(Boolean) ? { fileNames: fileNames.slice(0, 999) } : {}),
        })
    }
    return [...normalized.values()]
}

export function enqueueCurrentSceneQueue(): Promise<CreateBatchAndEnqueueResult | null> {
    const sceneState = useSceneStore.getState()
    const presetId = sceneState.activePresetId
    const preset = sceneState.presets.find(candidate => candidate.id === presetId)
    if (presetId === null || preset === undefined) return Promise.resolve(null)
    const targets = sceneState.getQueuedScenes(presetId).map(scene => ({
        presetId,
        sceneId: scene.id,
        count: scene.queueCount,
        ...(scene.queuedFileNames === undefined
            ? {}
            : { fileNames: scene.queuedFileNames.slice(0, scene.queueCount) }),
    }))
    return enqueueSceneQueueTargets(targets, {
        origin: 'legacy-conversion',
        consumePendingEntries: true,
    })
}

export function enqueueSceneQueueTargets(
    targets: readonly SceneQueueTarget[],
    options: { origin?: QueueBatchOrigin; consumePendingEntries?: boolean } = {},
): Promise<CreateBatchAndEnqueueResult | null> {
    const normalizedTargets = normalizeSceneQueueTargets(targets)
    if (normalizedTargets.length === 0) return Promise.resolve(null)
    sceneEnqueueInFlight ??= enqueueSceneQueueTargetsOnce(
        normalizedTargets,
        options.origin ?? 'fresh',
        options.consumePendingEntries === true,
    ).finally(() => {
        sceneEnqueueInFlight = null
    })
    return sceneEnqueueInFlight
}

async function enqueueSceneQueueTargetsOnce(
    targets: readonly SceneQueueTarget[],
    origin: QueueBatchOrigin,
    consumePendingEntries: boolean,
): Promise<CreateBatchAndEnqueueResult | null> {
    const sceneState = useSceneStore.getState()
    const selected: ResolvedSceneQueueTarget[] = targets.flatMap(target => {
        const preset = sceneState.presets.find(candidate => candidate.id === target.presetId)
        const scene = preset?.scenes.find(candidate => candidate.id === target.sceneId)
        return preset === undefined || scene === undefined ? [] : [{ target, preset, scene }]
    })
    if (selected.length === 0) return null
    const operationId = useQueueStore.getState().beginEnqueueOperation('scene')
    try {
        const settings = useSettingsStore.getState()
        if (settings.generationFolderDocument === null) {
            throw new QueueExecutionError('fatal', 'Generation folder authority is not ready')
        }
        const folderBinding = createGenerationFolderDocumentBinding(settings.generationFolderDocument)
        const sceneRepository = getRuntimeSceneRepository()
        const authorityByPreset = new Map<string, SceneDocument>()
        for (const { preset } of selected) {
            if (authorityByPreset.has(preset.id)) continue
            const document = await sceneRepository.getDocument(preset.id)
            if (document === null) {
                throw new QueueExecutionError('fatal', `Scene authority is unavailable for preset ${preset.id}`)
            }
            authorityByPreset.set(preset.id, document)
        }
        const r2ReadinessByProfile = new Map<string, ReturnType<typeof getDefaultR2Readiness>>()
        const readR2Profile = (profileId: string) => {
            let pending = r2ReadinessByProfile.get(profileId)
            if (pending === undefined) {
                pending = getDefaultR2Readiness(profileId)
                r2ReadinessByProfile.set(profileId, pending)
            }
            return pending
        }
        const rotation = useRotationStore.getState()
        const rotationCharacterId = rotation.active && rotation.snapshot
            ? rotation.characterIds[rotation.currentIndex]
            : undefined
        const materializer = getRuntimeQueueResourceMaterializer()
        const resourceCache = new Map<string, Promise<MaterializedQueueResource>>()
        const resources = new Map<string, QueueResourceRecord>()
        // One enqueue operation must use one credential-tier pricing authority;
        // reading auth per image could otherwise mix consent bases mid-batch.
        const activeCredentialsAreOpus = selectActiveCredentialsAreOpus(useAuthStore.getState())
        const prepared: Array<Omit<PlannedSceneBatchJob<PreparedSceneQueueJob>, 'ordinal'>> = []

        for (const { target, preset, scene } of selected) {
            const document = authorityByPreset.get(preset.id)
            const sceneBinding = document === undefined
                ? null
                : createSceneGenerationBinding(document, scene.id)
            if (sceneBinding === null) {
                throw new QueueExecutionError('fatal', `Scene authority is missing ${preset.id}:${scene.id}`)
            }
            const preliminaryFolder = resolveGenerationFolderAuthority(
                settings.generationFolderDocument,
                settings.generationFolders,
                scene.generationFolderId,
                {
                    directory: settings.sceneSavePath,
                    useAbsolutePath: settings.useAbsoluteScenePath,
                },
            )
            const requestedProfileId = preliminaryFolder?.r2.profileId ?? DEFAULT_R2_PROFILE_ID
            const r2Readiness = preliminaryFolder?.r2.autoUpload
                ? await readR2Profile(requestedProfileId)
                : null
            const baseR2Profile = r2Readiness?.status === 'ready' ? r2Readiness.profile : null
            const resolvedFolder = resolveGenerationFolderAuthority(
                settings.generationFolderDocument,
                settings.generationFolders,
                scene.generationFolderId,
                {
                    directory: settings.sceneSavePath,
                    useAbsolutePath: settings.useAbsoluteScenePath,
                    r2ProfileId: baseR2Profile?.id,
                    r2Bucket: baseR2Profile?.bucket,
                    r2Prefix: baseR2Profile?.prefix,
                },
            )
            const generationFolder = gateGenerationFolderAutoUpload(
                resolvedFolder,
                r2Readiness?.status === 'ready',
            )
            const saveContext: SaveSceneResultContext = {
                activePresetId: preset.id,
                sceneSavePath: settings.sceneSavePath,
                ...(rotationCharacterId === undefined ? {} : { rotationCharacterId }),
                ...(rotationCharacterId === undefined
                    ? {}
                    : {
                        rotationCharacterFolderName: getRotationCharacterFolderName(
                            rotationCharacterId,
                            rotation.currentIndex,
                        ) ?? undefined,
                    }),
            }
            const directory = generationFolder?.directory ?? settings.sceneSavePath
            const capabilityFallbackDirectory = generationFolder?.useAbsolutePath
                ? 'NAI_Blue_Scene'
                : generationFolder?.directory ?? settings.sceneSavePath
            const outputContextBase: SceneQueueWorkflowSnapshot['outputContext'] = {
                useAbsoluteScenePath: generationFolder?.useAbsolutePath ?? settings.useAbsoluteScenePath,
                metadataMode: generationFolder?.r2.autoUpload
                    ? 'strip-and-sidecar'
                    : scene.metadataMode ?? settings.metadataMode,
                presetName: preset.name || 'Default',
                presetPathSegments: getScenePresetPathSegments(sceneState.presets, preset.id),
                sceneName: scene.name,
                sceneSubfoldersEnabled: settings.sceneSubfoldersEnabled,
                directory,
                capabilityFallbackDirectory,
                ...(generationFolder === null
                    ? {}
                    : {
                        generationFolderId: generationFolder.id,
                        generationFolderPath: generationFolder.path,
                        autoR2UploadProfileId: generationFolder.r2.autoUpload
                            ? generationFolder.r2.profileId ?? DEFAULT_R2_PROFILE_ID
                            : null,
                        r2Bucket: generationFolder.r2.bucket,
                        r2Prefix: generationFolder.r2.prefix,
                    }),
            }
            for (let count = 0; count < target.count; count += 1) {
                const ordinal = prepared.length
                const now = new Date()
                const generation = resolveSceneGeneration(scene)
                // Seed selection is pure here; the Zustand seed is consumed only after
                // the repository commits the complete batch and its reservations.
                const seed = selectSceneGenerationSeed(generation.seedLocked, generation.seed)
                const built = await buildSceneGenerationParams(scene, {
                    requestId: `durable-enqueue:${operationId}:${preset.id}:${scene.id}:${count}`,
                    now,
                    presetId: preset.id,
                    generationFolder,
                    seed,
                })
                sceneState.recordSceneCompositionResult(scene.id, {
                    mode: built.mode,
                    ...(built.planHash === null ? {} : { planHash: built.planHash }),
                    warnings: built.warnings,
                    errors: built.errors,
                })
                if (!built.success) {
                    throw new QueueExecutionError('fatal', 'Scene composition plan is invalid')
                }
                const fileName = planSceneFileName({
                    targetFileName: target.fileNames?.[count],
                    scene,
                    preset,
                    params: built.params,
                    ordinal,
                    now,
                })
                const outputContext = { ...outputContextBase, fileName }
                const dehydrated = await dehydrateGenerationParams(built.params, materializer, resourceCache)
                for (const record of dehydrated.records) resources.set(record.id, record)
                const pricingBasis = resolveAnlasPricingBasis({
                    model: built.params.model,
                    activeCredentialsAreOpus,
                })
                const estimatedAnlas = calculateAnlasCost({
                    model: built.params.model,
                    width: built.params.width,
                    height: built.params.height,
                    steps: built.params.steps,
                    imageCount: 1,
                    pricingBasis,
                })
                const costConsent = createAnlasCostConsentSnapshot({
                    pricingBasis,
                    estimatedAnlas,
                    maxAnlas: estimatedAnlas,
                    estimatedAt: now.toISOString(),
                    approvedAt: now.toISOString(),
                })
                prepared.push({
                    presetId: preset.id,
                    sceneId: scene.id,
                    seed,
                    fileName,
                    sceneBinding,
                    estimatedAnlas,
                    prepared: {
                        scene: { id: scene.id, name: scene.name },
                        params: built.params,
                        finalPrompt: built.finalPrompt,
                        mimeType: built.mimeType,
                        saveContext,
                        outputContext,
                        sequenceCommitProposal: built.sequenceCommitProposal,
                        planHash: built.planHash,
                        sceneBinding,
                        costConsent,
                        dehydrated: {
                            parameters: dehydrated.parameters,
                            resources: dehydrated.resources,
                        },
                        imageFormat: built.mimeType === 'image/webp' ? 'webp' : 'png',
                        destination: {
                            directory,
                            useAbsolutePath: outputContext.useAbsoluteScenePath,
                            capabilityFallbackDirectory,
                            workflowDefaultDirectory: 'NAI_Blue_Scene',
                            extension: built.mimeType === 'image/webp' ? 'webp' : 'png',
                            fileName,
                            collisionPolicy: 'error',
                        },
                    },
                })
            }
        }

        // Re-read the authoritative documents after composition/resource work so
        // a Scene edit that lands during enqueue cannot be paired with old output.
        const currentAuthorityByPreset = new Map<string, SceneDocument>()
        for (const presetId of authorityByPreset.keys()) {
            const document = await sceneRepository.getDocument(presetId)
            if (document === null) {
                throw new QueueExecutionError('fatal', `Scene authority disappeared for preset ${presetId}`)
            }
            currentAuthorityByPreset.set(presetId, document)
        }
        if (prepared.some(item => {
            const current = currentAuthorityByPreset.get(item.presetId)
            return current === undefined
                || !sceneGenerationBindingMatches(item.sceneBinding, current, item.sceneId)
        })) {
            throw new QueueExecutionError('fatal', 'Scene document changed before Queue reservation')
        }
        const plans = new Map<string, ReturnType<typeof planSceneBatch<PreparedSceneQueueJob>>>()
        for (const [presetId, authority] of authorityByPreset) {
            const presetPrepared = prepared.filter(item => item.presetId === presetId)
            if (presetPrepared.length === 0) continue
            const request: SceneBatchRequest = {
                actor: { kind: 'user', id: 'scene-queue' },
                preset: { id: presetId, expectedRevision: authority.revision },
                items: selected
                    .filter(item => item.preset.id === presetId)
                    .map(({ target }) => ({ sceneId: target.sceneId, count: target.count })),
                seedPolicy: { kind: 'replay', traceId: `scene-seeds:${operationId}:${presetId}` },
                execution: { failurePolicy: 'continue' },
                budget: {
                    maxImages: presetPrepared.length,
                    maxAnlas: presetPrepared.reduce((total, item) => total + item.estimatedAnlas, 0),
                },
            }
            plans.set(presetId, planSceneBatch({ folderBinding, request, jobs: presetPrepared }))
        }
        const batchId = `scene-batch-${operationId}`
        const createdAt = new Date().toISOString()
        const jobs: EnqueueGenerationJobInput[] = []
        const reservations: OutputReservation[] = []
        const destinations = new Set<string>()
        const dependencies = getRuntimeMainQueueDependencies()
        const assertCurrentFolderBinding = (): void => {
            const current = dependencies.outputReservations.getCurrentFolderBinding()
            if (current === null || canonicalSerialize(current) !== canonicalSerialize(folderBinding)) {
                throw new QueueExecutionError('fatal', 'Generation folder changed before Queue reservation')
            }
        }
        assertCurrentFolderBinding()
        let queueOrdinal = 0
        // Keep the caller's target order while attaching each job to its
        // preset-local durable sub-plan.
        for (const item of prepared) {
            const plan = plans.get(item.presetId)
            if (plan === undefined) {
                throw new QueueExecutionError('fatal', `Scene sub-plan is missing for preset ${item.presetId}`)
            }
            // Sub-plan ordinals are local to each preset; Queue IDs and ordering
            // must remain unique across the one atomic batch.
            const ordinal = queueOrdinal++
            const jobId = `scene-job-${operationId}-${ordinal}`
            const encoded = encodeSceneJobSnapshot({
                scene: item.prepared.scene,
                params: item.prepared.params,
                finalPrompt: item.prepared.finalPrompt,
                mimeType: item.prepared.mimeType,
                saveContext: item.prepared.saveContext,
                outputContext: item.prepared.outputContext,
                streaming: settings.useStreaming,
                sequenceCommitProposal: item.prepared.sequenceCommitProposal,
                planHash: item.prepared.planHash,
                sceneBinding: item.sceneBinding,
                batch: {
                    request: plan.request,
                    count: plan.count,
                    estimatedAnlas: plan.estimatedAnlas,
                    planHash: plan.planHash,
                },
                costConsent: item.prepared.costConsent,
            }, item.prepared.dehydrated)
            const preflight = await dependencies.outputReservations.preflight({
                destination: item.prepared.destination,
                fileName: item.fileName,
                collisionPolicy: 'fail',
                probeWrite: true,
            })
            if (preflight.fileName !== item.fileName) {
                throw new QueueExecutionError('fatal', 'Scene output preflight changed the exact filename')
            }
            const destinationKey = `${preflight.directoryIdentity}/${item.fileName.normalize('NFC').toLowerCase()}`
            if (destinations.has(destinationKey)) {
                throw new QueueExecutionError('fatal', `Scene batch output is duplicated: ${item.fileName}`)
            }
            destinations.add(destinationKey)
            const reservationId = `output-reservation:${jobId}`
            const reservation: OutputReservation = {
                reservationId,
                batchId,
                jobId,
                folderBinding: plan.folderBinding,
                directoryIdentity: preflight.directoryIdentity,
                relativePath: item.fileName,
                collisionPolicy: 'fail',
                expectedExistingDigest: null,
                state: 'storage-pending',
            }
            const { batchId: _batchId, jobId: _jobId, state: _state, ...reservationSnapshot } = reservation
            const snapshot = bindOutputReservationSnapshot(encoded.snapshot, reservationSnapshot)
            jobs.push({
                id: jobId,
                batchId,
                workflow: 'scene',
                sceneId: item.sceneId,
                createdAt,
                priority: 0,
                ordinal,
                snapshot,
                compositionPlanHash: encoded.compositionPlanHash,
                maxAttempts: 3,
                idempotencyKey: `scene-enqueue-${operationId}-${ordinal}`,
            })
            reservations.push(reservation)
        }
        assertCurrentFolderBinding()
        const finalAuthorityByPreset = new Map<string, SceneDocument>()
        for (const presetId of authorityByPreset.keys()) {
            const document = await sceneRepository.getDocument(presetId)
            if (document === null) {
                throw new QueueExecutionError('fatal', `Scene authority disappeared for preset ${presetId}`)
            }
            finalAuthorityByPreset.set(presetId, document)
        }
        if (prepared.some(item => {
            const current = finalAuthorityByPreset.get(item.presetId)
            return current === undefined
                || !sceneGenerationBindingMatches(item.sceneBinding, current, item.sceneId)
        })) {
            throw new QueueExecutionError('fatal', 'Scene document changed before atomic Queue enqueue')
        }
        const result = await getRuntimeQueueRepository().createBatchAndEnqueue({
            batch: {
                id: batchId,
                workflow: 'scene',
                createdAt,
                failurePolicy: 'continue',
                origin,
                idempotencyKey: `scene-enqueue-${operationId}`,
            },
            jobs,
            resources: [...resources.values()],
            reservations,
        })
        // Queue pending entries and seed advancement are presentation side effects;
        // both happen only after the atomic repository transaction succeeds.
        if (consumePendingEntries) {
            for (const { target } of selected) {
                useSceneStore.getState().consumeSceneQueueEntries(target.presetId, target.sceneId, target.count)
            }
        }
        for (const { preset, scene } of selected) {
            for (let count = 0; count < (targets.find(target => target.presetId === preset.id && target.sceneId === scene.id)?.count ?? 0); count += 1) {
                useSceneStore.getState().consumeSceneGenerationSeed(preset.id, scene.id)
            }
        }
        return result
    } finally {
        useCharacterStore.getState().releaseImageData()
        useQueueStore.getState().completeEnqueueOperation('scene', operationId)
    }
}
